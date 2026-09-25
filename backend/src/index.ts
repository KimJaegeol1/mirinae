import {
  calculateSummary,
  fixedCostObligations,
  setFixedCostStatus,
} from "./budget";
import {
  decryptJson,
  encryptJson,
  hash,
  randomToken,
  sameSecret,
} from "./crypto";
import {
  fetchBalance as fetchPopbillBalance,
  ProviderError,
  registerAccount,
  removeAccount,
  type PopbillRegistration,
} from "./popbill";
import type {
  Balance,
  Budget,
  ConnectionPayload,
  Env,
  FixedCost,
  FixedCostResolution,
  StoredConnection,
} from "./types";

const BANKS: Readonly<Record<string, string>> = {
  "0002": "산업은행",
  "0003": "기업은행",
  "0004": "국민은행",
  "0007": "수협은행",
  "0011": "NH농협은행",
  "0020": "우리은행",
  "0023": "SC제일은행",
  "0027": "한국씨티은행",
  "0031": "iM뱅크",
  "0032": "부산은행",
  "0034": "광주은행",
  "0035": "제주은행",
  "0037": "전북은행",
  "0039": "경남은행",
  "0045": "새마을금고",
  "0048": "신협",
  "0071": "우체국",
  "0081": "하나은행",
  "0088": "신한은행",
};

const CATEGORIES = new Set([
  "rent",
  "maintenance",
  "mobile",
  "electricity",
  "gas",
  "water",
  "insurance",
  "other",
]);
const DAY_MS = 86_400_000;
const PUBLIC_ASSET_PATHS = new Set([
  "/Mirinae-Android-Pilot.apk",
  "/Mirinae-Android-Pilot.sha256.txt",
  "/Mirinae-iPhone-Test.zip",
  "/mirinae-android-qr.png",
  "/mirinae-iphone-qr.png",
]);

class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, string>,
  ) {
    super(message);
  }
}

interface Authenticated {
  record: StoredConnection;
  payload: ConnectionPayload;
  scope: "app" | "widget";
  tokenHash: string;
}

interface SyncResult {
  balance: Balance;
  cached: boolean;
  warning?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return withHeaders(await route(request, env));
    } catch (error) {
      return withHeaders(errorResponse(error));
    }
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await syncActiveConnections(env);
    await cleanupExpired(env);
  },
};

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") return new Response(null, { status: 204 });
  if (method === "GET" && url.pathname === "/") {
    return json({
      service: "미리내 팝빌 계좌조회",
      channel: env.POPBILL_MODE === "test" ? "test" : "production",
      guide: "https://sseudon-demo-2026.boogieee.chatgpt.site/guide",
    });
  }
  if (method === "GET" && url.pathname === "/iphone-install") {
    return env.ASSETS.fetch(new Request(new URL("/iphone-install.html", url), request));
  }
  if (method === "GET" && url.pathname === "/android-install") {
    return env.ASSETS.fetch(new Request(new URL("/android-install.html", url), request));
  }
  if (method === "GET" && PUBLIC_ASSET_PATHS.has(url.pathname)) {
    return env.ASSETS.fetch(request);
  }
  if (method === "GET" && url.pathname === "/health") return health(env);
  if (method === "GET" && url.pathname === "/api/providers") return providers();
  if (method === "GET" && url.pathname === "/admin/status") {
    return adminStatus(request, env);
  }
  if (method === "POST" && url.pathname === "/auth/popbill/connect") {
    return connect(request, env);
  }

  if (url.pathname.startsWith("/api/")) {
    const authenticated = await authenticate(request, env);
    if (method === "GET" && url.pathname === "/api/accounts") {
      return json({ accounts: [publicAccount(authenticated.record.id, authenticated.payload)] });
    }
    if (method === "GET" && url.pathname === "/api/balance") {
      assertScope(authenticated, ["app"]);
      const result = await syncBalance(
        authenticated.record,
        authenticated.payload,
        env,
        url.searchParams.get("force") === "true",
      );
      return json({
        balance: result.balance,
        cached: result.cached,
        displayAmount: !hideAmounts(env),
        ...(result.warning ? { warning: result.warning } : {}),
      });
    }
    if (method === "GET" && url.pathname === "/api/budget") {
      assertScope(authenticated, ["app"]);
      if (!authenticated.payload.budget) {
        throw new ApiError("VALIDATION_ERROR", "예산 정보를 먼저 입력해 주세요.", 404);
      }
      return json({ budget: validateBudget(authenticated.payload.budget) });
    }
    if (method === "PUT" && url.pathname === "/api/budget") {
      assertScope(authenticated, ["app"]);
      const budget = validateBudget(await body(request));
      const payload = await mutatePayload(authenticated.record.id, env, (current) => ({
        ...current,
        budget,
      }));
      return json({
        budget,
        ...(payload.balance
          ? { summary: calculateSummary(payload.balance, budget, hideAmounts(env)) }
          : {}),
      });
    }
    if (method === "POST" && url.pathname === "/api/fixed-cost-status") {
      assertScope(authenticated, ["app"]);
      if (!authenticated.payload.budget) {
        throw new ApiError("VALIDATION_ERROR", "예산 정보를 먼저 입력해 주세요.", 409);
      }
      const input = object(await body(request));
      const fixedCostId = requiredText(input.fixedCostId, 1, 100);
      const period = requiredText(input.period, 7, 10);
      const status = requiredText(input.status, 4, 10);
      if (!["paid", "waived", "unpaid"].includes(status)) {
        throw new ApiError("VALIDATION_ERROR", "납부 상태가 올바르지 않습니다.", 400);
      }
      const currentBudget = validateBudget(authenticated.payload.budget);
      if (
        status !== "unpaid"
        && !fixedCostObligations(currentBudget).some((item) =>
          item.fixedCostId === fixedCostId && item.period === period)
      ) {
        throw new ApiError(
          "VALIDATION_ERROR",
          "현재 납부 대상인 고정비 회차를 찾을 수 없습니다.",
          400,
        );
      }
      if (status === "paid") {
        const synced = await syncBalance(
          authenticated.record,
          authenticated.payload,
          env,
          true,
        );
        if (synced.cached) {
          throw new ApiError(
            "BALANCE_NOT_REFRESHED",
            "최신 잔액이 확인되지 않아 납부완료로 바꾸지 않았습니다.",
            409,
          );
        }
      }
      let updatedBudget: Budget;
      try {
        updatedBudget = setFixedCostStatus(
          currentBudget,
          fixedCostId,
          period,
          status as "paid" | "waived" | "unpaid",
          new Date().toISOString(),
        );
      } catch (error) {
        throw new ApiError(
          "VALIDATION_ERROR",
          error instanceof Error ? error.message : "고정비 상태를 바꾸지 못했습니다.",
          400,
        );
      }
      const payload = await mutatePayload(authenticated.record.id, env, (current) => ({
        ...current,
        budget: updatedBudget,
      }));
      return json({
        budget: updatedBudget,
        ...(payload.balance
          ? { summary: calculateSummary(payload.balance, updatedBudget, hideAmounts(env)) }
          : {}),
      });
    }
    if (method === "POST" && url.pathname === "/api/widget-session") {
      assertScope(authenticated, ["app"]);
      const sessionToken = await issueSession(
        authenticated.record.id,
        "widget",
        (retentionDays(env) + 5) * DAY_MS,
        env,
      );
      return json({
        sessionToken,
        tokenType: "Bearer",
        scope: "widget",
        expiresIn: (retentionDays(env) + 5) * 24 * 60 * 60,
      }, 201);
    }
    if (method === "GET" && url.pathname === "/api/widget-summary") {
      assertScope(authenticated, ["app", "widget"]);
      if (!authenticated.payload.budget) {
        throw new ApiError("VALIDATION_ERROR", "예산 정보를 먼저 입력해 주세요.", 409);
      }
      const result = await syncBalance(
        authenticated.record,
        authenticated.payload,
        env,
        false,
      );
      const summary = calculateSummary(
        result.balance,
        authenticated.payload.budget,
        hideAmounts(env),
      );
      return json({
        summary: result.cached
          ? {
              ...summary,
              needsUpdate: true,
              status: summary.status === "stale" ? "stale" : "delayed",
            }
          : summary,
        ...(result.warning ? { warning: result.warning } : {}),
      });
    }
    if (method === "POST" && url.pathname === "/api/connection/disconnect") {
      assertScope(authenticated, ["app"]);
      await removeAccount(
        env,
        authenticated.payload.bankCode,
        authenticated.payload.accountNumber,
      );
      await env.DB.batch([
        env.DB.prepare("DELETE FROM sessions WHERE connection_id = ?")
          .bind(authenticated.record.id),
        env.DB.prepare("DELETE FROM connections WHERE id = ?")
          .bind(authenticated.record.id),
      ]);
      return new Response(null, { status: 204 });
    }
  }

  throw new ApiError("NOT_FOUND", "요청 경로가 없습니다.", 404);
}

function health(env: Env): Response {
  const required = [
    env.POPBILL_LINK_ID,
    env.POPBILL_SECRET_KEY,
    env.POPBILL_CORP_NUM,
    env.POPBILL_USER_ID,
    env.DATA_ENCRYPTION_KEY,
    env.PILOT_INVITE_CODE,
  ].every(Boolean);
  const testReady = required && env.POPBILL_MODE === "test" && !hideAmounts(env);
  const pilotReady = required
    && env.POPBILL_MODE === "production"
    && Boolean(env.POPBILL_CLOSE_TYPE)
    && !hideAmounts(env);
  return json({
    status: "ok",
    providers: {
      kftc: "disabled",
      popbill: env.POPBILL_MODE,
    },
    channel: env.POPBILL_MODE === "test" ? "test" : "production",
    persistentStore: true,
    encryptedApplicationData: true,
    emergencyHideAmounts: hideAmounts(env),
    popbillUsePeriodMonths: popbillUsePeriod(env),
    testReady,
    pilotReady,
  });
}

function providers(): Response {
  return json({
    generalBanks: Object.entries(BANKS).map(([bankCode, bankName]) => ({
      provider: "popbill",
      bankCode,
      bankName,
    })),
    internetBanks: [],
  });
}

async function connect(request: Request, env: Env): Promise<Response> {
  if (hideAmounts(env)) {
    throw new ApiError(
      "PROVIDER_DISABLED",
      "안전 점검 중이라 새 계좌 연결을 잠시 중단했습니다.",
      503,
    );
  }
  assertConfigured(env);
  const input = validateRegistration(await body(request));
  await checkRateLimit(request, input.accountNumber, env);
  if (!await sameSecret(input.inviteCode, env.PILOT_INVITE_CODE)) {
    throw new ApiError(
      "INVITE_CODE_INVALID",
      "파일럿 초대코드가 올바르지 않습니다.",
      403,
    );
  }
  const bankName = BANKS[input.bankCode];
  if (!bankName) {
    throw new ApiError("BANK_NOT_SUPPORTED", "팝빌 연결 대상 은행이 아닙니다.", 400);
  }

  const registration: PopbillRegistration = {
    bankCode: input.bankCode,
    accountNumber: input.accountNumber,
    accountPassword: input.accountPassword,
    identityNumber: input.identityNumber,
    accountName: input.accountName,
    ...(input.bankId ? { bankId: input.bankId } : {}),
    ...(input.fastId ? { fastId: input.fastId } : {}),
    ...(input.fastPassword ? { fastPassword: input.fastPassword } : {}),
  };
  await registerAccount(env, registration);

  const connectionId = randomToken(18);
  const now = Date.now();
  const payload: ConnectionPayload = {
    bankCode: input.bankCode,
    bankName,
    accountNumber: input.accountNumber,
    accountName: input.accountName,
    maskedAccountNumber: maskAccountNumber(input.accountNumber),
  };
  const encrypted = await encryptJson(payload, env.DATA_ENCRYPTION_KEY);
  await env.DB.prepare(`
    INSERT INTO connections (
      id, provider, encrypted_payload, payload_iv,
      created_at, expires_at, sync_status
    ) VALUES (?, 'popbill', ?, ?, ?, ?, 'pending')
  `).bind(
    connectionId,
    encrypted.ciphertext,
    encrypted.iv,
    now,
    now + retentionDays(env) * DAY_MS,
  ).run();
  const sessionToken = await issueSession(
    connectionId,
    "app",
    (retentionDays(env) + 5) * DAY_MS,
    env,
  );
  const record = await findConnection(connectionId, env);

  try {
    const synced = await syncBalance(record, payload, env, true);
    return json({
      sessionToken,
      tokenType: "Bearer",
      account: publicAccount(connectionId, payload),
      balance: synced.balance,
      cached: synced.cached,
      displayAmount: !hideAmounts(env),
      channel: env.POPBILL_MODE,
      ...(synced.warning ? { warning: synced.warning } : {}),
    }, 201);
  } catch {
    return json({
      sessionToken,
      tokenType: "Bearer",
      account: publicAccount(connectionId, payload),
      pending: true,
      channel: env.POPBILL_MODE,
      warning: "계좌 연결은 완료됐고 첫 잔액을 확인하고 있습니다. 확인 전에는 금액을 표시하지 않습니다.",
    }, 202);
  }
}

async function syncBalance(
  record: StoredConnection,
  payload: ConnectionPayload,
  env: Env,
  force: boolean,
): Promise<SyncResult> {
  const cacheMs = cacheMinutes(env) * 60_000;
  if (
    !force
    && payload.balance
    && Date.now() - new Date(payload.balance.syncedAt).getTime() < cacheMs
  ) {
    return { balance: payload.balance, cached: false };
  }

  const leaseName = `connection-sync:${record.id}`;
  const leaseUntil = Date.now() + 60_000;
  const lease = await env.DB.prepare(`
    INSERT INTO scheduler_leases (name, lease_until)
    VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET lease_until = excluded.lease_until
    WHERE scheduler_leases.lease_until <= ?
  `).bind(leaseName, leaseUntil, Date.now()).run();
  if (lease.meta.changes !== 1) {
    const latestRecord = await findConnection(record.id, env);
    const latestPayload = await decryptJson<ConnectionPayload>(
      latestRecord.encrypted_payload,
      latestRecord.payload_iv,
      env.DATA_ENCRYPTION_KEY,
    );
    if (!latestPayload.balance) {
      throw new ApiError(
        "BALANCE_REFRESH_IN_PROGRESS",
        "은행 잔액을 확인하고 있습니다. 잠시 후 다시 확인해 주세요.",
        409,
      );
    }
    return {
      balance: latestPayload.balance,
      cached: true,
      warning: "다른 갱신이 진행 중이어서 마지막 정상 잔액을 유지합니다.",
    };
  }
  try {
    try {
      const balance = await fetchPopbillBalance(
        env,
        payload.bankCode,
        payload.accountNumber,
        payload.bankName,
      );
      await mutatePayload(record.id, env, (current) => ({ ...current, balance }));
      await env.DB.prepare(`
        UPDATE connections
        SET last_sync_at = ?, sync_status = 'fresh'
        WHERE id = ?
      `).bind(Date.now(), record.id).run();
      return { balance, cached: false };
    } catch (error) {
      await env.DB.prepare(`
        UPDATE connections
        SET sync_status = ?
        WHERE id = ?
      `).bind(payload.balance ? "delayed" : "pending", record.id).run();
      if (!payload.balance) throw error;
      return {
        balance: payload.balance,
        cached: true,
        warning: `마지막 정상 잔액을 유지합니다: ${safeError(error).message}`,
      };
    }
  } finally {
    await env.DB.prepare(`
      UPDATE scheduler_leases
      SET lease_until = 0
      WHERE name = ? AND lease_until = ?
    `).bind(leaseName, leaseUntil).run();
  }
}

async function authenticate(request: Request, env: Env): Promise<Authenticated> {
  const value = request.headers.get("Authorization");
  if (!value?.startsWith("Bearer ")) {
    throw new ApiError("UNAUTHORIZED", "앱 세션 토큰이 필요합니다.", 401);
  }
  const tokenHash = await hash(value.slice("Bearer ".length));
  const session = await env.DB.prepare(`
    SELECT connection_id, scope, expires_at
    FROM sessions
    WHERE token_hash = ?
  `).bind(tokenHash).first<{
    connection_id: string;
    scope: "app" | "widget";
    expires_at: number;
  }>();
  if (!session || session.expires_at <= Date.now()) {
    throw new ApiError("UNAUTHORIZED", "앱 세션이 유효하지 않습니다.", 401);
  }
  const record = await findConnection(session.connection_id, env);
  if (record.expires_at <= Date.now()) {
    throw new ApiError(
      "UNAUTHORIZED",
      "파일럿 보유기간이 끝나 연결이 만료되었습니다.",
      401,
    );
  }
  const payload = await decryptJson<ConnectionPayload>(
    record.encrypted_payload,
    record.payload_iv,
    env.DATA_ENCRYPTION_KEY,
  );
  return { record, payload, scope: session.scope, tokenHash };
}

function assertScope(
  authenticated: Authenticated,
  allowed: ReadonlyArray<"app" | "widget">,
): void {
  if (!allowed.includes(authenticated.scope)) {
    throw new ApiError(
      "UNAUTHORIZED",
      "이 세션에는 해당 기능을 사용할 권한이 없습니다.",
      401,
    );
  }
}

async function findConnection(id: string, env: Env): Promise<StoredConnection> {
  const record = await env.DB.prepare(`
    SELECT id, encrypted_payload, payload_iv, created_at, expires_at,
           last_sync_at, sync_status, disconnected_at
    FROM connections
    WHERE id = ? AND disconnected_at IS NULL
  `).bind(id).first<StoredConnection>();
  if (!record) {
    throw new ApiError("UNAUTHORIZED", "연결 정보가 없습니다.", 401);
  }
  return record;
}

async function mutatePayload(
  connectionId: string,
  env: Env,
  mutate: (payload: ConnectionPayload) => ConnectionPayload,
): Promise<ConnectionPayload> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const record = await findConnection(connectionId, env);
    const current = await decryptJson<ConnectionPayload>(
      record.encrypted_payload,
      record.payload_iv,
      env.DATA_ENCRYPTION_KEY,
    );
    const next = mutate(current);
    const encrypted = await encryptJson(next, env.DATA_ENCRYPTION_KEY);
    const result = await env.DB.prepare(`
      UPDATE connections
      SET encrypted_payload = ?, payload_iv = ?
      WHERE id = ? AND encrypted_payload = ?
    `).bind(
      encrypted.ciphertext,
      encrypted.iv,
      connectionId,
      record.encrypted_payload,
    ).run();
    if (result.meta.changes === 1) return next;
  }
  throw new ApiError(
    "CONCURRENT_UPDATE",
    "동시에 설정이 변경되어 저장하지 못했습니다. 다시 시도해 주세요.",
    409,
  );
}

async function issueSession(
  connectionId: string,
  scope: "app" | "widget",
  durationMs: number,
  env: Env,
): Promise<string> {
  const token = randomToken();
  await env.DB.prepare(`
    INSERT INTO sessions (
      token_hash, connection_id, scope, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?)
  `).bind(
    await hash(token),
    connectionId,
    scope,
    Date.now() + durationMs,
    Date.now(),
  ).run();
  return token;
}

async function checkRateLimit(
  request: Request,
  accountNumber: string,
  env: Env,
): Promise<void> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const ipHash = await hash(`ip:${ip}`);
  const accountHash = await hash(`account:${ip}:${accountNumber}`);
  const cutoff = Date.now() - 15 * 60_000;
  const [ipCount, accountCount] = await Promise.all([
    env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM rate_limit_attempts
      WHERE actor_hash = ? AND attempted_at >= ?
    `).bind(ipHash, cutoff).first<{ count: number }>(),
    env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM rate_limit_attempts
      WHERE actor_hash = ? AND attempted_at >= ?
    `).bind(accountHash, cutoff).first<{ count: number }>(),
  ]);
  if ((ipCount?.count ?? 0) >= 60 || (accountCount?.count ?? 0) >= 5) {
    throw new ApiError("RATE_LIMITED", "잠시 후 다시 시도해 주세요.", 429);
  }
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO rate_limit_attempts (actor_hash, attempted_at)
      VALUES (?, ?)
    `).bind(ipHash, Date.now()),
    env.DB.prepare(`
      INSERT INTO rate_limit_attempts (actor_hash, attempted_at)
      VALUES (?, ?)
    `).bind(accountHash, Date.now()),
    env.DB.prepare("DELETE FROM rate_limit_attempts WHERE attempted_at < ?")
      .bind(cutoff),
  ]);
}

async function adminStatus(request: Request, env: Env): Promise<Response> {
  if (!env.PILOT_ADMIN_TOKEN) {
    throw new ApiError("NOT_FOUND", "요청 경로가 없습니다.", 404);
  }
  const value = request.headers.get("Authorization");
  if (
    !value?.startsWith("Bearer ")
    || !await sameSecret(value.slice("Bearer ".length), env.PILOT_ADMIN_TOKEN)
  ) {
    throw new ApiError("UNAUTHORIZED", "운영 상태 확인 권한이 없습니다.", 401);
  }
  const totals = await env.DB.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN sync_status = 'fresh' THEN 1 ELSE 0 END) AS fresh,
      SUM(CASE WHEN sync_status = 'delayed' THEN 1 ELSE 0 END) AS delayed,
      SUM(CASE WHEN sync_status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN last_sync_at IS NULL OR last_sync_at < ? THEN 1 ELSE 0 END) AS stale,
      MIN(last_sync_at) AS oldest_sync_at,
      MAX(last_sync_at) AS latest_sync_at
    FROM connections
    WHERE disconnected_at IS NULL AND expires_at > ?
  `).bind(Date.now() - 40 * 60_000, Date.now()).first<{
    total: number;
    fresh: number | null;
    delayed: number | null;
    pending: number | null;
    stale: number | null;
    oldest_sync_at: number | null;
    latest_sync_at: number | null;
  }>();
  const connectionHealth = await env.DB.prepare(`
    SELECT
      SUBSTR(id, 1, 8) AS anonymous_id,
      sync_status,
      last_sync_at,
      created_at,
      expires_at
    FROM connections
    WHERE disconnected_at IS NULL AND expires_at > ?
    ORDER BY
      CASE sync_status
        WHEN 'pending' THEN 0
        WHEN 'delayed' THEN 1
        ELSE 2
      END,
      last_sync_at ASC
    LIMIT 50
  `).bind(Date.now()).all<{
    anonymous_id: string;
    sync_status: string;
    last_sync_at: number | null;
    created_at: number;
    expires_at: number;
  }>();
  return json({
    generatedAt: new Date().toISOString(),
    channel: env.POPBILL_MODE,
    collectionMinutes: 20,
    participants: totals?.total ?? 0,
    sync: {
      fresh: totals?.fresh ?? 0,
      delayed: totals?.delayed ?? 0,
      pending: totals?.pending ?? 0,
      stale: totals?.stale ?? 0,
      oldestAt: totals?.oldest_sync_at
        ? new Date(totals.oldest_sync_at).toISOString()
        : null,
      latestAt: totals?.latest_sync_at
        ? new Date(totals.latest_sync_at).toISOString()
        : null,
    },
    connections: connectionHealth.results.map((item) => ({
      anonymousId: item.anonymous_id,
      status: item.sync_status,
      lastSyncedAt: item.last_sync_at
        ? new Date(item.last_sync_at).toISOString()
        : null,
      connectedAt: new Date(item.created_at).toISOString(),
      expiresAt: new Date(item.expires_at).toISOString(),
    })),
  });
}

async function syncActiveConnections(env: Env): Promise<void> {
  const now = Date.now();
  const leaseUntil = now + 15 * 60_000;
  const lease = await env.DB.prepare(`
    INSERT INTO scheduler_leases (name, lease_until)
    VALUES ('balance-sync', ?)
    ON CONFLICT(name) DO UPDATE SET lease_until = excluded.lease_until
    WHERE scheduler_leases.lease_until <= ?
  `).bind(leaseUntil, now).run();
  if (lease.meta.changes !== 1) return;

  try {
    const due = await env.DB.prepare(`
      SELECT id, encrypted_payload, payload_iv, created_at, expires_at,
             last_sync_at, sync_status, disconnected_at
      FROM connections
      WHERE disconnected_at IS NULL
        AND expires_at > ?
        AND (
          last_sync_at IS NULL
          OR last_sync_at <= ?
          OR sync_status != 'fresh'
        )
      ORDER BY
        CASE WHEN last_sync_at IS NULL THEN 0 ELSE 1 END,
        last_sync_at ASC
      LIMIT 50
    `).bind(now, now - cacheMinutes(env) * 60_000).all<StoredConnection>();

    for (let offset = 0; offset < due.results.length; offset += 3) {
      const batch = due.results.slice(offset, offset + 3);
      await Promise.all(batch.map(async (record) => {
        try {
          const payload = await decryptJson<ConnectionPayload>(
            record.encrypted_payload,
            record.payload_iv,
            env.DATA_ENCRYPTION_KEY,
          );
          await syncBalance(record, payload, env, true);
        } catch {
          await env.DB.prepare(`
            UPDATE connections
            SET sync_status = CASE
              WHEN last_sync_at IS NULL THEN 'pending'
              ELSE 'delayed'
            END
            WHERE id = ?
          `).bind(record.id).run();
        }
      }));
    }
  } finally {
    await env.DB.prepare(`
      UPDATE scheduler_leases
      SET lease_until = 0
      WHERE name = 'balance-sync' AND lease_until = ?
    `).bind(leaseUntil).run();
  }
}

async function cleanupExpired(env: Env): Promise<void> {
  const expired = await env.DB.prepare(`
    SELECT id, encrypted_payload, payload_iv, created_at, expires_at,
           last_sync_at, sync_status, disconnected_at
    FROM connections
    WHERE expires_at <= ? AND disconnected_at IS NULL
    LIMIT 20
  `).bind(Date.now()).all<StoredConnection>();
  for (const record of expired.results) {
    try {
      const payload = await decryptJson<ConnectionPayload>(
        record.encrypted_payload,
        record.payload_iv,
        env.DATA_ENCRYPTION_KEY,
      );
      await removeAccount(env, payload.bankCode, payload.accountNumber);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM sessions WHERE connection_id = ?").bind(record.id),
        env.DB.prepare("DELETE FROM connections WHERE id = ?").bind(record.id),
      ]);
    } catch {
      // Provider revocation must succeed before local encrypted data is deleted.
    }
  }
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(Date.now()).run();
  await env.DB.prepare("DELETE FROM rate_limit_attempts WHERE attempted_at < ?")
    .bind(Date.now() - 15 * 60_000)
    .run();
}

function validateRegistration(value: unknown): PopbillRegistration & {
  inviteCode: string;
} {
  const input = object(value);
  const accountName = optionalText(input.accountName, 40) || "생활비 계좌";
  const result = {
    inviteCode: requiredText(input.inviteCode, 4, 100),
    bankCode: digits(input.bankCode, 4, 4),
    accountNumber: digits(input.accountNumber, 6, 30),
    accountPassword: digits(input.accountPassword, 4, 4),
    identityNumber: digits(input.identityNumber, 6, 6),
    accountName,
    bankId: optionalText(input.bankId, 200),
    fastId: optionalText(input.fastId, 50),
    fastPassword: optionalText(input.fastPassword, 50),
  };
  if (input.consent !== true) {
    throw new ApiError("VALIDATION_ERROR", "개인정보 처리 동의가 필요합니다.", 400);
  }
  return {
    inviteCode: result.inviteCode,
    bankCode: result.bankCode,
    accountNumber: result.accountNumber,
    accountPassword: result.accountPassword,
    identityNumber: result.identityNumber,
    accountName: result.accountName,
    ...(result.bankId ? { bankId: result.bankId } : {}),
    ...(result.fastId ? { fastId: result.fastId } : {}),
    ...(result.fastPassword ? { fastPassword: result.fastPassword } : {}),
  };
}

function validateBudget(value: unknown): Budget {
  const input = object(value);
  const nextIncomeDate = date(input.nextIncomeDate);
  const incomeMode = input.incomeMode === undefined
    ? "monthly"
    : requiredText(input.incomeMode, 7, 9);
  if (!["monthly", "irregular"].includes(incomeMode)) {
    throw new ApiError("VALIDATION_ERROR", "소득 방식이 올바르지 않습니다.", 400);
  }
  const incomeDay = input.incomeDay === undefined
    ? Number(nextIncomeDate.slice(-2))
    : integer(input.incomeDay, 1, 31);
  const incomeGraceDays = input.incomeGraceDays === undefined
    ? 3
    : integer(input.incomeGraceDays, 0, 7);
  const safetyBuffer = money(input.safetyBuffer);
  if (!Array.isArray(input.fixedCosts) || input.fixedCosts.length > 100) {
    throw new ApiError("VALIDATION_ERROR", "고정비 입력값이 올바르지 않습니다.", 400);
  }
  const fixedCosts = input.fixedCosts.map((item): FixedCost => {
    const cost = object(item);
    const category = requiredText(cost.category, 1, 30);
    if (!CATEGORIES.has(category)) {
      throw new ApiError("VALIDATION_ERROR", "고정비 분류가 올바르지 않습니다.", 400);
    }
    const dueDate = date(cost.dueDate);
    const recurrence = cost.recurrence === undefined
      ? "monthly"
      : requiredText(cost.recurrence, 4, 7);
    if (!["monthly", "once"].includes(recurrence)) {
      throw new ApiError("VALIDATION_ERROR", "고정비 반복방식이 올바르지 않습니다.", 400);
    }
    if (
      cost.resolutions !== undefined
      && (!Array.isArray(cost.resolutions) || cost.resolutions.length > 120)
    ) {
      throw new ApiError("VALIDATION_ERROR", "고정비 납부기록이 올바르지 않습니다.", 400);
    }
    const resolutions = (cost.resolutions as unknown[] | undefined ?? [])
      .map((value): FixedCostResolution => {
        const resolution = object(value);
        const status = requiredText(resolution.status, 4, 7);
        if (!["paid", "waived"].includes(status)) {
          throw new ApiError("VALIDATION_ERROR", "고정비 납부기록이 올바르지 않습니다.", 400);
        }
        const period = recurrence === "once"
          ? date(resolution.period)
          : month(resolution.period);
        return {
          period,
          status: status as FixedCostResolution["status"],
          resolvedAt: isoDateTime(resolution.resolvedAt),
        };
      });
    if (new Set(resolutions.map((resolution) => resolution.period)).size !== resolutions.length) {
      throw new ApiError("VALIDATION_ERROR", "같은 고정비 회차가 중복되어 있습니다.", 400);
    }
    if (cost.paidAt !== undefined) {
      const legacyPeriod = recurrence === "once" ? dueDate : dueDate.slice(0, 7);
      if (!resolutions.some((resolution) => resolution.period === legacyPeriod)) {
        resolutions.push({
          period: legacyPeriod,
          status: "paid",
          resolvedAt: isoDateTime(cost.paidAt),
        });
      }
    }
    return {
      id: requiredText(cost.id, 1, 100),
      category: category as FixedCost["category"],
      name: requiredText(cost.name, 1, 40),
      amount: money(cost.amount),
      dueDate,
      recurrence: recurrence as FixedCost["recurrence"],
      resolutions,
    };
  });
  if (new Set(fixedCosts.map((cost) => cost.id)).size !== fixedCosts.length) {
    throw new ApiError("VALIDATION_ERROR", "고정비 항목이 중복되어 있습니다.", 400);
  }
  return {
    nextIncomeDate,
    incomeMode: incomeMode as Budget["incomeMode"],
    incomeDay,
    incomeGraceDays,
    safetyBuffer,
    fixedCosts,
  };
}

async function body(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > 64 * 1024) {
    throw new ApiError("PAYLOAD_TOO_LARGE", "요청 내용이 너무 큽니다.", 413);
  }
  try {
    return await request.json();
  } catch {
    throw new ApiError("VALIDATION_ERROR", "입력값이 올바르지 않습니다.", 400);
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("VALIDATION_ERROR", "입력값이 올바르지 않습니다.", 400);
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, min: number, max: number): string {
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", "입력값이 올바르지 않습니다.", 400);
  }
  const text = value.trim();
  if (text.length < min || text.length > max) {
    throw new ApiError("VALIDATION_ERROR", "입력값이 올바르지 않습니다.", 400);
  }
  return text;
}

function optionalText(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredText(value, 1, max);
}

function digits(value: unknown, min: number, max: number): string {
  const text = requiredText(value, min, max);
  if (!new RegExp(`^\\d{${min},${max}}$`).test(text)) {
    throw new ApiError("VALIDATION_ERROR", "숫자 입력값이 올바르지 않습니다.", 400);
  }
  return text;
}

function date(value: unknown): string {
  const text = requiredText(value, 10, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const parsed = new Date(`${text}T00:00:00Z`);
  if (
    !match
    || Number.isNaN(parsed.getTime())
    || parsed.getUTCFullYear() !== Number(match[1])
    || parsed.getUTCMonth() + 1 !== Number(match[2])
    || parsed.getUTCDate() !== Number(match[3])
  ) {
    throw new ApiError("VALIDATION_ERROR", "날짜 형식이 올바르지 않습니다.", 400);
  }
  return text;
}

function month(value: unknown): string {
  const text = requiredText(value, 7, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) {
    throw new ApiError("VALIDATION_ERROR", "월 형식이 올바르지 않습니다.", 400);
  }
  return text;
}

function integer(value: unknown, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) {
    throw new ApiError("VALIDATION_ERROR", "숫자 입력값이 올바르지 않습니다.", 400);
  }
  return Number(value);
}

function isoDateTime(value: unknown): string {
  const text = requiredText(value, 20, 40);
  if (Number.isNaN(new Date(text).getTime())) {
    throw new ApiError("VALIDATION_ERROR", "날짜 형식이 올바르지 않습니다.", 400);
  }
  return text;
}

function money(value: unknown): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 0
    || value > 10_000_000_000
  ) {
    throw new ApiError("VALIDATION_ERROR", "금액 입력값이 올바르지 않습니다.", 400);
  }
  return value;
}

function publicAccount(connectionId: string, payload: ConnectionPayload): {
  id: string;
  provider: "popbill";
  bankCode: string;
  bankName: string;
  alias: string;
  maskedAccountNumber: string;
  selected: true;
} {
  return {
    id: connectionId.slice(0, 16),
    provider: "popbill",
    bankCode: payload.bankCode,
    bankName: payload.bankName,
    alias: payload.accountName,
    maskedAccountNumber: payload.maskedAccountNumber,
    selected: true,
  };
}

function maskAccountNumber(accountNumber: string): string {
  if (accountNumber.length <= 4) return "*".repeat(accountNumber.length);
  return `${"*".repeat(accountNumber.length - 4)}${accountNumber.slice(-4)}`;
}

function hideAmounts(env: Env): boolean {
  return env.EMERGENCY_HIDE_AMOUNTS === "true";
}

function retentionDays(env: Env): number {
  const value = Number.parseInt(env.RETENTION_DAYS, 10);
  return Number.isFinite(value) && value >= 1 && value <= 90 ? value : 70;
}

function cacheMinutes(env: Env): number {
  const value = Number.parseInt(env.BALANCE_CACHE_MINUTES, 10);
  return Number.isFinite(value) && value >= 5 && value <= 120 ? value : 15;
}

function popbillUsePeriod(env: Env): number {
  const value = Number.parseInt(env.POPBILL_USE_PERIOD ?? "1", 10);
  return Number.isFinite(value) && value >= 1 && value <= 12 ? value : 1;
}

function assertConfigured(env: Env): void {
  if (
    !env.POPBILL_LINK_ID
    || !env.POPBILL_SECRET_KEY
    || !env.POPBILL_CORP_NUM
    || !env.POPBILL_USER_ID
    || !env.DATA_ENCRYPTION_KEY
    || !env.PILOT_INVITE_CODE
  ) {
    throw new ApiError(
      "CONFIG_ERROR",
      "팝빌 테스트 서버의 비밀 설정이 완료되지 않았습니다.",
      503,
    );
  }
}

function safeError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof ProviderError) {
    return new ApiError(
      "POPBILL_ERROR",
      error.message,
      error.status,
      { providerCode: error.providerCode },
    );
  }
  return new ApiError("INTERNAL_ERROR", "서버 요청을 처리하지 못했습니다.", 500);
}

function errorResponse(error: unknown): Response {
  const safe = safeError(error);
  return json({
    error: {
      code: safe.code,
      message: safe.message,
      ...(safe.details ? { details: safe.details } : {}),
    },
  }, safe.status);
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function withHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Pragma", "no-cache");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
