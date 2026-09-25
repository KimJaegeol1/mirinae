// 미리내 파일럿 — Scriptable iPhone 위젯
// 신규 참가자용 파일 이름은 "Mirinae"를 사용합니다.

const SCRIPT_NAME = Script.name();
const INSTANCE_SUFFIX = ["Mirinae", "SseuldonPilot"].includes(SCRIPT_NAME)
  ? ""
  : `-${SCRIPT_NAME.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase()}`;
const SESSION_KEY = `sseuldon-pilot-session-v1${INSTANCE_SUFFIX}`;
const API_URL_KEY = "sseuldon-pilot-api-url-v1";
const DEFAULT_API_BASE_URL = "__SSEULDON_API_BASE_URL__";
const BUILD_CHANNEL = "__SSEULDON_BUILD_CHANNEL__";
const GUIDE_URL = "https://sseudon-demo-2026.boogieee.chatgpt.site/guide";
const fileManager = FileManager.local();
const cachePath = fileManager.joinPath(
  fileManager.documentsDirectory(),
  `sseuldon-pilot-cache${INSTANCE_SUFFIX}.json`,
);
const draftPath = fileManager.joinPath(
  fileManager.documentsDirectory(),
  `sseuldon-pilot-budget${INSTANCE_SUFFIX}.json`,
);
const manualPath = fileManager.joinPath(
  fileManager.documentsDirectory(),
  `mirinae-manual-state${INSTANCE_SUFFIX}.json`,
);
const refreshMinutes = 20;

function readJSON(path, fallback = null) {
  try {
    if (!fileManager.fileExists(path)) return fallback;
    return JSON.parse(fileManager.readString(path));
  } catch (_) {
    return fallback;
  }
}

function writeJSON(path, value) {
  fileManager.writeString(path, JSON.stringify(value, null, 2));
}

function session() {
  if (!Keychain.contains(SESSION_KEY)) return null;
  try {
    const value = JSON.parse(Keychain.get(SESSION_KEY));
    if (!value.apiBaseUrl || !value.sessionToken) return null;
    return value;
  } catch (_) {
    return null;
  }
}

function saveSession(value) {
  Keychain.set(SESSION_KEY, JSON.stringify(value));
  Keychain.set(API_URL_KEY, value.apiBaseUrl);
}

function removeSession() {
  if (Keychain.contains(SESSION_KEY)) Keychain.remove(SESSION_KEY);
}

function cleanApiUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function configuredApiUrl() {
  if (session()) return session().apiBaseUrl;
  if (Keychain.contains(API_URL_KEY)) return cleanApiUrl(Keychain.get(API_URL_KEY));
  return validApiUrl(DEFAULT_API_BASE_URL) ? cleanApiUrl(DEFAULT_API_BASE_URL) : "";
}

function validApiUrl(value) {
  return /^https:\/\/[^/\s]+(?:\/.*)?$/i.test(value);
}

async function verifyApiUrl(value) {
  const health = await api("/health", { baseUrl: value, timeout: 15 });
  const ready = BUILD_CHANNEL === "test" ? health.testReady : health.pilotReady;
  if (health.status !== "ok" || !health.persistentStore || !ready) {
    throw new Error("아직 참가자 연결을 받을 준비가 끝나지 않은 서버예요.");
  }
}

async function ensureApiUrl() {
  const current = configuredApiUrl();
  if (validApiUrl(current)) {
    try {
      await verifyApiUrl(current);
      return current;
    } catch (error) {
      await message(
        "서버를 확인하지 못했어요",
        "운영진에게 준비 상태를 확인해 달라고 알려 주세요.\n\n" + String(error.message || error),
      );
      return null;
    }
  }
  const values = await input("미리내 서버 연결", [
    { placeholder: "운영진이 알려준 https:// 서버 주소", value: current },
  ]);
  if (!values) return null;
  const value = cleanApiUrl(values[0]);
  if (!validApiUrl(value)) {
    await message("주소를 확인해 주세요", "보안을 위해 https://로 시작하는 미리내 서버 주소만 사용할 수 있어요.");
    return null;
  }
  try {
    await verifyApiUrl(value);
    Keychain.set(API_URL_KEY, value);
    return value;
  } catch (error) {
    await message(
      "서버를 확인하지 못했어요",
      "운영진에게 서버 주소와 준비 상태를 확인해 달라고 알려 주세요.\n\n" + String(error.message || error),
    );
    return null;
  }
}

async function api(path, options = {}) {
  const base = options.baseUrl || configuredApiUrl();
  if (!validApiUrl(base)) throw new Error("미리내 서버 주소를 먼저 설정해 주세요.");
  const request = new Request(`${base}${path}`);
  request.method = options.method || "GET";
  request.timeoutInterval = options.timeout || 35;
  const headers = { Accept: "application/json" };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    request.body = JSON.stringify(options.body);
  }
  request.headers = headers;
  const text = await request.loadString();
  const status = request.response ? request.response.statusCode : 200;
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (_) {
      throw new Error("서버 응답을 읽지 못했어요.");
    }
  }
  if (status < 200 || status >= 300) {
    const error = payload && payload.error;
    throw new Error((error && error.message) || `서버 요청에 실패했어요. (${status})`);
  }
  return payload;
}

async function message(title, body) {
  const alert = new Alert();
  alert.title = title;
  alert.message = body;
  alert.addAction("확인");
  await alert.presentAlert();
}

async function input(title, fields, body = "") {
  const alert = new Alert();
  alert.title = title;
  alert.message = body;
  fields.forEach((field) => {
    if (field.secure) alert.addSecureTextField(field.placeholder, field.value || "");
    else alert.addTextField(field.placeholder, field.value || "");
  });
  alert.addAction("다음");
  alert.addCancelAction("취소");
  const result = await alert.presentAlert();
  if (result < 0) return null;
  return fields.map((_, index) => alert.textFieldValue(index));
}

async function choose(title, items, destructive = false) {
  const alert = new Alert();
  alert.title = title;
  items.forEach((item) => {
    if (destructive) alert.addDestructiveAction(item);
    else alert.addAction(item);
  });
  alert.addCancelAction("취소");
  const result = await alert.presentSheet();
  return result >= 0 && result < items.length ? result : -1;
}

function amount(value) {
  const parsed = Number(String(value || "").replace(/[^0-9-]/g, ""));
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function validDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return parsed.getUTCFullYear() === Number(match[1])
    && parsed.getUTCMonth() + 1 === Number(match[2])
    && parsed.getUTCDate() === Number(match[3]);
}

function dateAfter(days) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type) => parts.find((item) => item.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function nextDateForDay(day) {
  const value = Math.max(1, Math.min(31, Number(day) || 1));
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const part = (type) => Number(parts.find((item) => item.type === type).value);
  const candidate = (year, month) => {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(value, last)).padStart(2, "0")}`;
  };
  const today = dateAfter(0);
  const current = candidate(part("year"), part("month"));
  if (current >= today) return current;
  const nextMonth = part("month") === 12 ? 1 : part("month") + 1;
  const nextYear = part("month") === 12 ? part("year") + 1 : part("year");
  return candidate(nextYear, nextMonth);
}

function periodLabel(value) {
  if (/^\d{4}-\d{2}$/.test(value || "")) {
    const [year, month] = value.split("-");
    return `${year}년 ${Number(month)}월`;
  }
  return value || "이번 회차";
}

function manualState() {
  const value = readJSON(manualPath);
  if (!value || value.mode !== "manual" || !Number.isFinite(Number(value.currentBalance))) return null;
  return {
    ...value,
    currentBalance: Math.max(0, Math.round(Number(value.currentBalance))),
    history: Array.isArray(value.history) ? value.history : [],
    budget: value.budget || {
      nextIncomeDate: dateAfter(30),
      incomeMode: "monthly",
      incomeDay: Number(dateAfter(30).slice(-2)),
      incomeGraceDays: 3,
      safetyBuffer: 100000,
      fixedCosts: [],
    },
  };
}

function saveManualState(value) {
  writeJSON(manualPath, { ...value, mode: "manual" });
}

function monthIndex(period) {
  const [year, month] = String(period).split("-").map(Number);
  return year * 12 + month - 1;
}

function periodFromIndex(value) {
  return `${Math.floor(value / 12)}-${String(value % 12 + 1).padStart(2, "0")}`;
}

function dateForMonth(period, day) {
  const [year, month] = String(period).split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${period}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function daysBetween(from, to) {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.ceil((end - start) / 86400000));
}

function manualObligations(costs, today = dateAfter(0)) {
  const result = [];
  const unique = new Set();
  (costs || []).forEach((cost) => {
    const resolved = new Set((cost.resolutions || []).map((item) => item.period));
    if (cost.recurrence === "once") {
      const key = `${cost.id}:${cost.dueDate}`;
      if (!resolved.has(cost.dueDate) && !unique.has(key)) {
        unique.add(key);
        result.push({
          fixedCostId: cost.id,
          name: cost.name,
          amount: amount(cost.amount),
          period: cost.dueDate,
          dueDate: cost.dueDate,
          state: cost.dueDate < today ? "overdue" : "upcoming",
        });
      }
      return;
    }
    const seedPeriod = String(cost.dueDate).slice(0, 7);
    const dueDay = Number(String(cost.dueDate).slice(-2));
    if (!/^\d{4}-\d{2}$/.test(seedPeriod) || !dueDay) return;
    const currentPeriod = today.slice(0, 7);
    const currentDue = dateForMonth(currentPeriod, dueDay);
    let targetPeriod = currentDue >= today
      ? currentPeriod
      : periodFromIndex(monthIndex(currentPeriod) + 1);
    if (monthIndex(targetPeriod) < monthIndex(seedPeriod)) targetPeriod = seedPeriod;
    const start = monthIndex(seedPeriod);
    const end = monthIndex(targetPeriod);
    if (end - start < 0 || end - start > 240) return;
    for (let index = start; index <= end; index += 1) {
      const period = periodFromIndex(index);
      const key = `${cost.id}:${period}`;
      if (resolved.has(period) || unique.has(key)) continue;
      unique.add(key);
      const dueDate = dateForMonth(period, dueDay);
      result.push({
        fixedCostId: cost.id,
        name: cost.name,
        amount: amount(cost.amount),
        period,
        dueDate,
        state: dueDate < today ? "overdue" : "upcoming",
      });
    }
  });
  return result.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name));
}

function manualSummary(state) {
  const budget = state.budget || {};
  const today = dateAfter(0);
  const items = manualObligations(budget.fixedCosts || [], today);
  const overdue = items.filter((item) => item.state === "overdue");
  const upcoming = items.filter((item) => item.state !== "overdue");
  const overdueFixedCosts = overdue.reduce((sum, item) => sum + amount(item.amount), 0);
  const upcomingFixedCosts = upcoming.reduce((sum, item) => sum + amount(item.amount), 0);
  const reservedFixedCosts = overdueFixedCosts + upcomingFixedCosts;
  const spendableAmount = state.currentBalance - reservedFixedCosts - amount(budget.safetyBuffer);
  let incomeDateKnown = true;
  let nextIncomeDate = "";
  if (budget.incomeMode === "irregular") {
    nextIncomeDate = budget.nextIncomeDate || "";
    const graceEnd = nextIncomeDate
      ? new Date(new Date(`${nextIncomeDate}T00:00:00Z`).getTime() + (budget.incomeGraceDays || 3) * 86400000)
          .toISOString().slice(0, 10)
      : "";
    incomeDateKnown = Boolean(nextIncomeDate && graceEnd >= today);
  } else {
    nextIncomeDate = nextDateForDay(budget.incomeDay || Number((budget.nextIncomeDate || dateAfter(30)).slice(-2)));
  }
  const daysUntilIncome = incomeDateKnown ? daysBetween(today, nextIncomeDate) : 0;
  const nextFixedCostDate = upcoming[0] && upcoming[0].dueDate;
  const daysUntilNextFixedCost = nextFixedCostDate ? daysBetween(today, nextFixedCostDate) : undefined;
  const planningDays = incomeDateKnown && daysUntilIncome > 0
    ? daysUntilIncome
    : daysUntilNextFixedCost || 0;
  const cautionLine = Math.max(100000, reservedFixedCosts / 4);
  const dailySpendable = planningDays > 0 ? spendableAmount / planningDays : spendableAmount;
  const riskLevel = spendableAmount < 0
    ? "critical"
    : spendableAmount < 50000
      ? "danger"
      : spendableAmount <= cautionLine || (planningDays > 0 && dailySpendable < 20000)
        ? "caution"
        : "safe";
  return {
    spendableAmount,
    shortageAmount: Math.max(0, -spendableAmount),
    availableAmount: state.currentBalance,
    reservedFixedCosts,
    upcomingFixedCosts,
    overdueFixedCosts,
    overdueCount: overdue.length,
    fixedCostItems: items,
    safetyBuffer: amount(budget.safetyBuffer),
    nextIncomeDate,
    daysUntilIncome,
    incomeDateKnown,
    ...(nextFixedCostDate ? { nextFixedCostDate } : {}),
    ...(daysUntilNextFixedCost === undefined ? {} : { daysUntilNextFixedCost }),
    syncedAt: state.syncedAt,
    needsUpdate: false,
    displayAmount: true,
    provider: "manual",
    riskScore: Math.max(0, Math.min(1, (300000 - spendableAmount) / 300000)),
    riskLevel,
    shakeLevel: 0,
    status: "fresh",
  };
}

function appendManualEvent(state, type, changeAmount = null, memo = "", extra = {}) {
  const summary = manualSummary(state);
  const event = {
    at: new Date().toISOString(),
    type,
    changeAmount,
    memo: String(memo || "").trim(),
    balanceAmount: state.currentBalance,
    reservedFixedCosts: summary.reservedFixedCosts,
    safetyBuffer: summary.safetyBuffer,
    spendableAmount: summary.spendableAmount,
    ...extra,
  };
  return { ...state, history: [...(state.history || []), event].slice(-500) };
}

async function privacyConsent() {
  const alert = new Alert();
  alert.title = "자동 잔액조회 동의";
  alert.message =
    "입력한 계좌 로그인 정보는 계좌 등록을 위해 팝빌로 전달되며, 미리내 서버에는 계좌 비밀번호·생년월일·인터넷뱅킹 비밀번호를 저장하지 않아요.\n\n" +
    "미리내 서버의 암호화된 연결정보(일반은행은 조회에 필요한 계좌번호 포함), 마지막 정상 잔액·갱신시각, 고정비 설정은 연구 파일럿과 종료 정리를 위해 최대 70일 보관한 뒤 만료 처리에 들어가요. 팝빌 해지가 실패하면 안전한 해지를 다시 시도하기 위해 암호화 상태로 남을 수 있어 운영진이 확인해야 해요. 운영진 상태 화면에는 개인별 잔액과 전체 계좌번호를 표시하지 않아요.\n\n" +
    "연결 해제 시 현재 운영 저장본에서 지우고 팝빌 계좌조회 해지를 요청해요. 팝빌이 보관하는 정보와 삭제 시점은 참가자 안내문에서 별도로 확인해 주세요.";
  alert.addAction("동의하고 계속");
  alert.addCancelAction("취소");
  return await alert.presentAlert() === 0;
}

async function startManualMode() {
  if (session() || manualState()) {
    await message("이미 설정되어 있어요", "현재 연결 또는 직접 입력 설정을 먼저 삭제해 주세요.");
    return;
  }
  const values = await input("초기 잔액 직접 입력", [
    { placeholder: "참여자 코드 (예: P03)" },
    { placeholder: "은행 앱에 표시된 현재 잔액" },
  ], "자동 연결이 안 되는 계좌용입니다. 계좌번호·비밀번호 없이 잔액과 입출금 기록을 이 iPhone에만 저장해요.");
  if (!values) return;
  const participantCode = values[0].trim();
  const currentBalance = amount(values[1]);
  if (!participantCode || !String(values[1]).replace(/\D/g, "")) {
    await message("입력값을 확인해 주세요", "참여자 코드와 현재 잔액을 입력해 주세요.");
    return;
  }
  let state = {
    mode: "manual",
    participantCode,
    currentBalance,
    syncedAt: new Date().toISOString(),
    budget: {
      nextIncomeDate: dateAfter(30),
      incomeMode: "monthly",
      incomeDay: Number(dateAfter(30).slice(-2)),
      incomeGraceDays: 3,
      safetyBuffer: 100000,
      fixedCosts: [],
    },
    history: [],
  };
  state = appendManualEvent(state, "initial_balance", currentBalance, "직접 입력 시작");
  saveManualState(state);
  await configureBudget(true);
  await message("직접 입력 시작", "이제 결제할 때는 ‘지출 입력’, 돈이 들어오면 ‘입금 입력’을 눌러 주세요. 위젯 금액도 바로 바뀝니다.");
}

async function recordManualTransaction(type) {
  const state = manualState();
  if (!state) return;
  const isIncome = type === "income";
  const values = await input(isIncome ? "입금 입력" : "지출 입력", [
    { placeholder: isIncome ? "입금액" : "지출액" },
    { placeholder: isIncome ? "메모 (선택, 예: 급여)" : "메모 (선택, 예: 식비)" },
  ], `현재 잔액 ${won(state.currentBalance)}원에서 ${isIncome ? "입금액을 더해요." : "지출액을 빼요."}`);
  if (!values) return;
  const value = amount(values[0]);
  if (value <= 0) {
    await message("금액을 확인해 주세요", "0원보다 큰 금액을 입력해 주세요.");
    return;
  }
  const change = isIncome ? value : -value;
  const nextBalance = state.currentBalance + change;
  if (nextBalance < 0) {
    await message("지출액을 확인해 주세요", "현재 잔액보다 큰 지출은 입력할 수 없어요. 빠뜨린 기록이 있다면 ‘은행 잔액과 맞추기’를 이용해 주세요.");
    return;
  }
  const updated = appendManualEvent(
    { ...state, currentBalance: nextBalance, syncedAt: new Date().toISOString() },
    type,
    change,
    values[1],
  );
  saveManualState(updated);
  const summary = manualSummary(updated);
  await message(
    isIncome ? "입금 반영 완료" : "지출 반영 완료",
    `현재 잔액 ${won(nextBalance)}원\n지금 써도 되는 돈 ${summary.spendableAmount < 0 ? `${won(summary.shortageAmount)}원 부족` : `${won(summary.spendableAmount)}원`}`,
  );
}

async function correctManualBalance() {
  const state = manualState();
  if (!state) return;
  const values = await input("은행 잔액과 맞추기", [
    { placeholder: "은행 앱의 실제 현재 잔액", value: String(state.currentBalance) },
    { placeholder: "메모 (선택, 예: 입력 누락 정정)" },
  ], "빠뜨린 입력이 있을 때만 사용해 주세요. 차액과 메모가 기록에 남습니다.");
  if (!values) return;
  const digits = String(values[0]).replace(/\D/g, "");
  if (!digits) {
    await message("잔액을 확인해 주세요", "은행 앱에 표시된 현재 잔액을 입력해 주세요.");
    return;
  }
  const nextBalance = amount(values[0]);
  const updated = appendManualEvent(
    { ...state, currentBalance: nextBalance, syncedAt: new Date().toISOString() },
    "balance_correction",
    nextBalance - state.currentBalance,
    values[1],
  );
  saveManualState(updated);
  await message("잔액 맞춤 완료", "실제 잔액과 위젯을 맞췄어요.");
}

function manualEventLabel(type) {
  return ({
    initial_balance: "초기 잔액",
    income: "입금",
    expense: "지출",
    balance_correction: "잔액 맞춤",
    budget_update: "고정비 설정",
    fixed_cost_paid: "고정비 납부",
    fixed_cost_waived: "고정비 면제",
    fixed_cost_unpaid: "미납 되돌림",
  })[type] || type;
}

async function showManualHistory() {
  const state = manualState();
  if (!state || !state.history.length) {
    await message("수동 기록이 없어요", "입금이나 지출을 입력하면 이곳에 기록됩니다.");
    return;
  }
  const body = state.history.slice(-25).reverse().map((entry) => {
    const change = entry.changeAmount !== null
      && entry.changeAmount !== undefined
      && Number.isFinite(Number(entry.changeAmount))
      ? ` · ${Number(entry.changeAmount) >= 0 ? "+" : "-"}${won(entry.changeAmount) }원`
      : "";
    const memo = entry.memo ? ` · ${entry.memo}` : "";
    return `${timeLabel(entry.at)} · ${manualEventLabel(entry.type)}${change}${memo}\n잔액 ${won(entry.balanceAmount)}원 · 사용가능 ${entry.spendableAmount < 0 ? `${won(-entry.spendableAmount)}원 부족` : `${won(entry.spendableAmount)}원`}`;
  }).join("\n\n");
  await message(`최근 수동 기록 ${state.history.length}건`, body);
}

function csvCell(value) {
  return `"${String(value === undefined || value === null ? "" : value).replace(/"/g, '""')}"`;
}

async function shareManualHistory() {
  const state = manualState();
  if (!state || !state.history.length) {
    await message("보낼 기록이 없어요", "입금이나 지출을 입력한 뒤 다시 시도해 주세요.");
    return;
  }
  const alert = new Alert();
  alert.title = "수동 입력 기록 공유";
  alert.message = "참여자 코드, 입력시각, 입금·지출 금액, 잔액, 메모, 남겨둔 고정비와 사용가능액이 포함됩니다. 계좌번호·비밀번호·거래 상대방은 포함되지 않아요. 받을 사람을 직접 확인해 주세요.";
  alert.addAction("내용 확인 후 공유");
  alert.addCancelAction("취소");
  if (await alert.presentAlert() !== 0) return;
  const header = [
    "참여자코드", "입력시각", "기록유형", "금액변화", "현재잔액", "메모",
    "남겨둔고정비", "안전완충액", "사용가능액", "고정비명", "회차",
  ];
  const rows = state.history.map((entry) => [
    state.participantCode,
    entry.at,
    manualEventLabel(entry.type),
    entry.changeAmount,
    entry.balanceAmount,
    entry.memo,
    entry.reservedFixedCosts,
    entry.safetyBuffer,
    entry.spendableAmount,
    entry.fixedCostName,
    entry.period,
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  await ShareSheet.present([`미리내 직접 입력 기록 · ${state.participantCode}\n\n${csv}`]);
}

async function deleteManualState() {
  const state = manualState();
  if (!state) return;
  const alert = new Alert();
  alert.title = "직접 입력 설정 삭제";
  alert.message = "이 iPhone에 저장된 잔액·고정비·입력 기록을 모두 삭제할까요? 삭제한 기록은 복구할 수 없어요.";
  alert.addDestructiveAction("모두 삭제");
  alert.addCancelAction("취소");
  if (await alert.presentAlert() !== 0) return;
  fileManager.remove(manualPath);
  await message("삭제 완료", "이 iPhone의 직접 입력 잔액·설정·기록을 삭제했어요.");
}

async function connectPopbill() {
  if (session()) {
    await message("이미 연결되어 있어요", "현재 계좌를 먼저 연결 해제한 뒤 다른 계좌를 연결해 주세요.");
    return;
  }
  const baseUrl = await ensureApiUrl();
  if (!baseUrl) return;
  let providers;
  try {
    providers = await api("/api/providers", { baseUrl });
  } catch (error) {
    await message("은행 목록을 불러오지 못했어요", String(error.message || error));
    return;
  }
  const banks = providers.generalBanks || [];
  if (!banks.length) {
    await message("연결 가능한 은행이 없어요", "운영진에게 팝빌 서버 상태를 확인해 달라고 알려 주세요.");
    return;
  }
  const selected = await choose("일반은행 선택", banks.map((item) => item.bankName));
  if (selected < 0) return;
  const bank = banks[selected];
  const first = await input(`${bank.bankName} 연결`, [
    { placeholder: "워크숍 참여코드" },
    { placeholder: "계좌 별칭 (예: 생활비 통장)", value: "생활비 통장" },
    { placeholder: "계좌번호 (- 없이)" },
    { placeholder: "계좌 비밀번호 4자리", secure: true },
    { placeholder: "생년월일 6자리", secure: true },
  ]);
  if (!first) return;
  const accountNumber = first[2].replace(/\D/g, "");
  const accountPassword = first[3].replace(/\D/g, "");
  const identityNumber = first[4].replace(/\D/g, "");
  if (accountNumber.length < 6 || accountPassword.length !== 4 || identityNumber.length !== 6) {
    await message("입력값을 확인해 주세요", "계좌번호, 계좌 비밀번호 4자리, 생년월일 6자리를 정확히 입력해 주세요.");
    return;
  }
  const optional = await input("은행별 추가 정보", [
    { placeholder: "인터넷뱅킹 ID (필요한 은행만)" },
    { placeholder: "조회전용·간편 ID (필요한 은행만)" },
    { placeholder: "조회전용·간편 비밀번호 (필요한 은행만)", secure: true },
  ], "은행에 따라 필요할 수 있어요. 해당하지 않으면 모두 비워 두고 다음을 누르세요.");
  if (!optional || !await privacyConsent()) return;

  try {
    const response = await api("/auth/popbill/connect", {
      baseUrl,
      method: "POST",
      timeout: 45,
      body: {
        inviteCode: first[0].trim(),
        bankCode: bank.bankCode,
        accountNumber,
        accountPassword,
        identityNumber,
        accountName: first[1].trim() || "생활비 통장",
        ...(optional[0].trim() ? { bankId: optional[0].trim() } : {}),
        ...(optional[1].trim() ? { fastId: optional[1].trim() } : {}),
        ...(optional[2] ? { fastPassword: optional[2] } : {}),
        consent: true,
      },
    });
    saveSession({
      apiBaseUrl: baseUrl,
      sessionToken: response.sessionToken,
      provider: "popbill",
      bankName: response.account.bankName,
      maskedAccountNumber: response.account.maskedAccountNumber,
    });
    await configureBudget(true);
    await refresh(true, false);
    await message(
      "계좌 연결 완료",
      response.pending
        ? "계좌는 등록됐어요. 첫 잔액이 확인될 때까지 위젯에는 금액을 표시하지 않아요."
        : "이제 잔액을 직접 입력하지 않아도 미리내 위젯이 자동으로 갱신돼요.",
    );
  } catch (error) {
    await message("계좌를 연결하지 못했어요", String(error.message || error));
  }
}

async function configureBudget(firstSetup = false) {
  const connected = session();
  const local = manualState();
  if (!connected && !local) {
    await message("잔액 설정이 필요해요", "일반은행을 연결하거나 초기 잔액을 직접 입력해 주세요.");
    return;
  }
  let draft = local ? local.budget : readJSON(draftPath, {
    nextIncomeDate: dateAfter(30),
    incomeMode: "monthly",
    incomeDay: Number(dateAfter(30).slice(-2)),
    incomeGraceDays: 3,
    safetyBuffer: 100000,
    fixedCosts: [],
  });
  if (connected) {
    try {
      const remote = await api("/api/budget", { token: connected.sessionToken });
      if (remote.budget) draft = remote.budget;
    } catch (_) {
      // 첫 설정에서는 서버에 예산이 아직 없는 것이 정상입니다.
    }
  }
  const incomeChoice = await choose("소득 방식", [
    "매월 비슷한 날 들어와요",
    "날짜가 불규칙하거나 아직 몰라요",
  ]);
  if (incomeChoice < 0) return;
  const incomeMode = incomeChoice === 0 ? "monthly" : "irregular";
  const income = await input("소득 예상 설정", incomeMode === "monthly"
    ? [{
        placeholder: "매월 예상 소득일 (1~31)",
        value: String(draft.incomeDay || Number((draft.nextIncomeDate || dateAfter(30)).slice(-2))),
      }]
    : [{
        placeholder: "예상일 YYYY-MM-DD (모르면 비워두기)",
        value: draft.incomeMode === "irregular" && draft.nextIncomeDate !== "2000-01-01"
          ? draft.nextIncomeDate || ""
          : "",
      }],
  local
    ? "실제 소득이 들어오면 ‘입금 입력’에서 직접 반영해 주세요. 이 날짜는 위젯 안내에 사용합니다."
    : "실제 소득은 계좌 잔액에 자동 반영돼요. 이 날짜는 위젯 안내에만 사용합니다.");
  if (!income) return;
  const incomeDay = incomeMode === "monthly" ? amount(income[0]) : undefined;
  if (incomeMode === "monthly" && (incomeDay < 1 || incomeDay > 31)) {
    await message("소득일을 확인해 주세요", "매월 1일부터 31일 사이의 날짜를 입력해 주세요.");
    return;
  }
  if (incomeMode === "irregular" && income[0].trim() && !validDate(income[0].trim())) {
    await message("예상일을 확인해 주세요", "2026-08-25처럼 입력하거나 모르면 비워 주세요.");
    return;
  }
  const nextIncomeDate = incomeMode === "monthly"
    ? nextDateForDay(incomeDay)
    : income[0].trim() || "2000-01-01";
  const base = await input(firstSetup ? "미리내 기준 설정" : "미리내 설정 수정", [
    { placeholder: "안전완충액", value: String(draft.safetyBuffer || 100000) },
    { placeholder: "고정비 개수", value: String((draft.fixedCosts || []).length || 2) },
  ], "고정비는 소득일과 별개로 매달 새 회차가 생기며, 미납액은 다음 회차와 함께 남겨둬요.");
  if (!base) return;
  const count = Math.min(20, amount(base[1]));
  const fixedCosts = [];
  for (let index = 0; index < count; index += 1) {
    const previous = (draft.fixedCosts || [])[index] || {};
    const recurrenceChoice = await choose(`고정비 ${index + 1}/${count} 반복`, [
      "매월 반복",
      "한 번만 납부",
    ]);
    if (recurrenceChoice < 0) return;
    const recurrence = recurrenceChoice === 0 ? "monthly" : "once";
    const value = await input(`고정비 ${index + 1}/${count}`, [
      { placeholder: "이름 (예: 월세)", value: previous.name || "" },
      { placeholder: "금액", value: previous.amount ? String(previous.amount) : "" },
      {
        placeholder: recurrence === "monthly"
          ? "첫 납부일 (YYYY-MM-DD)"
          : "납부일 (YYYY-MM-DD)",
        value: previous.dueDate || dateAfter(7),
      },
    ], recurrence === "monthly"
      ? "입력한 날짜를 시작으로 같은 날짜에 매월 새 고정비 회차가 생겨요."
      : "이번 한 번만 남겨둘 고정비예요.");
    if (!value) return;
    if (!value[0].trim() || amount(value[1]) <= 0) {
      await message("고정비를 확인해 주세요", "고정비 이름과 0원보다 큰 금액을 입력해 주세요.");
      return;
    }
    if (!validDate(value[2].trim())) {
      await message("납부일을 확인해 주세요", "고정비 납부일도 YYYY-MM-DD 형식으로 입력해 주세요.");
      return;
    }
    fixedCosts.push({
      id: previous.id || `cost-${Date.now()}-${index}`,
      category: "other",
      name: value[0].trim(),
      amount: amount(value[1]),
      dueDate: value[2].trim(),
      recurrence,
      resolutions: Array.isArray(previous.resolutions) ? previous.resolutions : [],
    });
  }
  const budget = {
    nextIncomeDate,
    incomeMode,
    ...(incomeDay ? { incomeDay } : {}),
    incomeGraceDays: 3,
    safetyBuffer: amount(base[0]),
    fixedCosts,
  };
  if (local) {
    const updated = appendManualEvent(
      { ...local, budget, syncedAt: new Date().toISOString() },
      "budget_update",
    );
    saveManualState(updated);
    if (!firstSetup) await message("설정 저장 완료", "위젯에도 같은 계산 기준이 반영됐어요.");
    return;
  }
  try {
    await api("/api/budget", {
      method: "PUT",
      token: connected.sessionToken,
      body: budget,
    });
    writeJSON(draftPath, budget);
    if (!firstSetup) {
      await refresh(false, false);
      await message("설정 저장 완료", "위젯에도 같은 계산 기준이 반영됐어요.");
    }
  } catch (error) {
    await message("설정을 저장하지 못했어요", String(error.message || error));
  }
}

async function toggleManualFixedCostPaid() {
  const state = manualState();
  if (!state) return;
  const summary = manualSummary(state);
  const items = summary.fixedCostItems || [];
  const resolved = (state.budget.fixedCosts || []).flatMap((cost) =>
    (cost.resolutions || []).map((resolution) => ({
      fixedCostId: cost.id,
      name: cost.name,
      amount: cost.amount,
      ...resolution,
    })));
  if (!items.length && !resolved.length) {
    await message("등록된 고정비가 없어요", "먼저 고정비·소득일 설정에서 고정비를 추가해 주세요.");
    return;
  }
  const action = await choose("고정비 납부상태", [
    "납부 완료로 바꾸기",
    "이번 회차 면제하기",
    "납부·면제 기록 되돌리기",
  ]);
  if (action < 0) return;
  const candidates = action === 2 ? resolved : items;
  if (!candidates.length) {
    await message("바꿀 회차가 없어요", action === 2
      ? "아직 납부완료나 면제로 처리한 회차가 없어요."
      : "현재 처리할 고정비 회차가 없어요.");
    return;
  }
  const selected = await choose("회차 선택", candidates.map((item) =>
    `${item.state === "overdue" ? "⚠ 미납 · " : ""}${periodLabel(item.period)} ${item.name} ${won(item.amount)}원`
  ));
  if (selected < 0) return;
  const target = candidates[selected];
  const status = action === 0 ? "paid" : action === 1 ? "waived" : "unpaid";
  let nextBalance = state.currentBalance;
  let changeAmount = null;
  if (status === "paid") {
    const values = await input("납부 후 현재 잔액", [
      { placeholder: "은행 앱의 실제 현재 잔액", value: String(state.currentBalance) },
    ], "고정비 납부가 반영된 실제 잔액을 입력해야 이중 차감을 막을 수 있어요. 이미 지출 입력을 했다면 현재와 같은 잔액을 입력하세요.");
    if (!values) return;
    const digits = String(values[0]).replace(/\D/g, "");
    if (!digits) {
      await message("잔액을 확인해 주세요", "납부 후 은행 앱의 현재 잔액을 입력해 주세요.");
      return;
    }
    nextBalance = amount(values[0]);
    changeAmount = nextBalance - state.currentBalance;
  }
  const fixedCosts = (state.budget.fixedCosts || []).map((cost) => {
    if (cost.id !== target.fixedCostId) return cost;
    const resolutions = (cost.resolutions || []).filter((item) => item.period !== target.period);
    if (status !== "unpaid") resolutions.push({
      period: target.period,
      status,
      resolvedAt: new Date().toISOString(),
    });
    return { ...cost, resolutions };
  });
  const updated = appendManualEvent(
    {
      ...state,
      currentBalance: nextBalance,
      syncedAt: status === "paid" ? new Date().toISOString() : state.syncedAt,
      budget: { ...state.budget, fixedCosts },
    },
    `fixed_cost_${status}`,
    changeAmount,
    status === "paid" ? "납부 후 잔액 반영" : "",
    { fixedCostName: target.name, period: target.period },
  );
  saveManualState(updated);
  await message(
    "납부 상태를 바꿨어요",
    status === "paid"
      ? "납부 후 실제 잔액과 납부완료를 함께 반영했어요."
      : status === "waived"
        ? "이번 회차만 면제로 처리했어요."
        : "다시 미납 상태로 바꿔 금액을 남겨뒀어요.",
  );
}

async function toggleFixedCostPaid() {
  const connected = session();
  if (!connected) {
    await toggleManualFixedCostPaid();
    return;
  }
  try {
    const [budgetResponse, summaryResponse] = await Promise.all([
      api("/api/budget", { token: connected.sessionToken }),
      api("/api/widget-summary", { token: connected.sessionToken }),
    ]);
    const budget = budgetResponse.budget;
    const items = summaryResponse.summary && Array.isArray(summaryResponse.summary.fixedCostItems)
      ? summaryResponse.summary.fixedCostItems
      : [];
    const resolved = (budget.fixedCosts || []).flatMap((cost) =>
      (cost.resolutions || []).map((resolution) => ({
        fixedCostId: cost.id,
        name: cost.name,
        amount: cost.amount,
        ...resolution,
      })));
    if (!items.length && !resolved.length) {
      await message("등록된 고정비가 없어요", "먼저 고정비·소득일 설정에서 고정비를 추가해 주세요.");
      return;
    }
    const action = await choose("고정비 납부상태", [
      "납부 완료로 바꾸기",
      "이번 회차 면제하기",
      "납부·면제 기록 되돌리기",
    ]);
    if (action < 0) return;
    const candidates = action === 2 ? resolved : items;
    if (!candidates.length) {
      await message("바꿀 회차가 없어요", action === 2
        ? "아직 납부완료나 면제로 처리한 회차가 없어요."
        : "현재 남겨둘 고정비 회차가 없어요.");
      return;
    }
    const selected = await choose("회차 선택", candidates.map((item) =>
      `${item.state === "overdue" ? "⚠ 미납 · " : ""}${periodLabel(item.period)} ${item.name} ${won(item.amount)}원`
    ));
    if (selected < 0) return;
    const target = candidates[selected];
    const status = action === 0 ? "paid" : action === 1 ? "waived" : "unpaid";
    const response = await api("/api/fixed-cost-status", {
      method: "POST",
      token: connected.sessionToken,
      timeout: 60,
      body: {
        fixedCostId: target.fixedCostId,
        period: target.period,
        status,
      },
    });
    writeJSON(draftPath, response.budget);
    await refresh(false, false);
    await message(
      "납부 상태를 바꿨어요",
      status === "paid"
        ? "최신 잔액을 확인한 뒤 납부완료로 반영했어요."
        : status === "waived"
          ? "이번 회차만 면제로 처리했어요."
          : "다시 미납 상태로 바꿔 금액을 남겨뒀어요.",
    );
  } catch (error) {
    await message("납부 상태를 바꾸지 못했어요", String(error.message || error));
  }
}

function cachedSummary() {
  const cache = readJSON(cachePath);
  if (!cache || !cache.summary) return null;
  const age = Date.now() - new Date(cache.savedAt || cache.summary.syncedAt).getTime();
  return {
    ...cache.summary,
    status: age > 24 * 60 * 60 * 1000 ? "stale" : "delayed",
    needsUpdate: true,
    displayAmount: age <= 24 * 60 * 60 * 1000 && cache.summary.displayAmount !== false,
    localWarning: "자동 갱신이 지연되어 마지막 정상 잔액을 표시하고 있어요.",
  };
}

async function fetchSummary(force = false) {
  const connected = session();
  if (!connected) throw new Error("계좌 연결이 필요해요.");
  if (force) {
    await api("/api/balance?force=true", {
      token: connected.sessionToken,
      timeout: 45,
    });
  }
  const response = await api("/api/widget-summary", {
    token: connected.sessionToken,
    timeout: 8,
  });
  const summary = response.summary;
  writeJSON(cachePath, {
    savedAt: new Date().toISOString(),
    summary,
    warning: response.warning || "",
  });
  return summary;
}

async function refresh(force = true, showResult = true) {
  try {
    const summary = await fetchSummary(force);
    if (showResult) {
      await message(
        "잔액 갱신 완료",
        summary.displayAmount
          ? `지금 써도 되는 돈 ${won(summary.spendableAmount)}원`
          : "정상 잔액을 확인하기 전까지 금액을 숨기고 있어요.",
      );
    }
    return summary;
  } catch (error) {
    const cached = cachedSummary();
    if (showResult) {
      await message(
        "자동 갱신이 지연되고 있어요",
        cached
          ? "잘못된 0원으로 바꾸지 않고 마지막 정상 잔액을 유지했어요.\n\n" + String(error.message || error)
          : String(error.message || error),
      );
    }
    return cached;
  }
}

async function disconnect() {
  const connected = session();
  if (!connected) {
    await message("연결된 계좌가 없어요", "기기에 저장된 연결정보가 없습니다.");
    return;
  }
  const alert = new Alert();
  alert.title = "계좌 연결 해제";
  alert.message = "팝빌 또는 금융결제원 연결을 해지하고, 서버와 이 iPhone에 저장된 미리내 연결정보를 삭제해요.";
  alert.addDestructiveAction("연결 해제");
  alert.addCancelAction("취소");
  if (await alert.presentAlert() !== 0) return;
  try {
    await api("/api/connection/disconnect", {
      method: "POST",
      token: connected.sessionToken,
      body: {},
    });
    removeSession();
    if (fileManager.fileExists(cachePath)) fileManager.remove(cachePath);
    if (fileManager.fileExists(draftPath)) fileManager.remove(draftPath);
    await message("연결 해제 완료", "계좌 자동조회와 이 기기의 설정을 삭제했어요.");
  } catch (error) {
    await message("연결 해제를 마치지 못했어요", "자료가 남지 않도록 운영진에게 확인해 주세요.\n\n" + String(error.message || error));
  }
}

function won(value) {
  return Math.round(Math.abs(Number(value) || 0)).toLocaleString("ko-KR");
}

function gaugeColor(summary) {
  if (["danger", "critical"].includes(summary.riskLevel)) return new Color("#FE5836");
  if (summary.riskLevel === "caution") return new Color("#F28210");
  return new Color("#00B176");
}

function syncLabel(summary) {
  if (summary.provider === "manual") return "직접 입력";
  if (summary.status === "stale") return "잔액 확인 필요";
  if (summary.status === "delayed") return "마지막 정상 잔액";
  return "자동 갱신됨";
}

function timeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function placeholderWidget(title, detail) {
  const widget = new ListWidget();
  widget.backgroundColor = new Color("#FFFFFF");
  widget.setPadding(18, 18, 18, 18);
  const header = widget.addText("지금 써도 되는 돈");
  header.font = Font.systemFont(12);
  header.textColor = new Color("#767676");
  widget.addSpacer(8);
  const titleText = widget.addText(title);
  titleText.font = Font.boldSystemFont(25);
  titleText.textColor = new Color("#2D2D2D");
  widget.addSpacer(6);
  const detailText = widget.addText(detail);
  detailText.font = Font.systemFont(12);
  detailText.textColor = new Color("#767676");
  widget.url = `scriptable:///run?scriptName=${encodeURIComponent(SCRIPT_NAME)}`;
  widget.refreshAfterDate = new Date(Date.now() + refreshMinutes * 60 * 1000);
  return widget;
}

function summaryWidget(summary) {
  if (!summary) return placeholderWidget("잔액 확인 필요", "미리내를 눌러 연결 상태를 확인해 주세요.");
  const widget = new ListWidget();
  const meterColor = gaugeColor(summary);
  widget.backgroundColor = new Color("#FFFFFF");
  widget.setPadding(16, 17, 16, 15);
  widget.url = `scriptable:///run?scriptName=${encodeURIComponent(SCRIPT_NAME)}`;
  widget.refreshAfterDate = new Date(Date.now() + refreshMinutes * 60 * 1000);

  const header = widget.addStack();
  header.layoutHorizontally();
  const headerTitle = header.addText("지금 써도 되는 돈");
  headerTitle.font = Font.systemFont(12);
  headerTitle.textColor = new Color("#767676");
  header.addSpacer();
  const updated = header.addText(`${syncLabel(summary)} ${timeLabel(summary.syncedAt)}`);
  updated.font = Font.systemFont(9);
  updated.textColor = new Color("#8A8A8A");
  updated.minimumScaleFactor = 0.7;
  updated.lineLimit = 1;
  widget.addSpacer(4);

  const amountRow = widget.addStack();
  amountRow.layoutHorizontally();
  const amountText = !summary.displayAmount
    ? "잔액 확인 필요"
    : summary.spendableAmount < 0
      ? `${won(summary.shortageAmount)}원 부족`
      : `${won(summary.spendableAmount)}원`;
  const value = amountRow.addText(amountText);
  value.font = Font.boldSystemFont(amountText.length > 12 ? 27 : 34);
  value.textColor = new Color("#2D2D2D");
  value.minimumScaleFactor = 0.65;
  value.lineLimit = 1;

  widget.addSpacer(4);
  const meter = widget.addStack();
  meter.layoutHorizontally();
  const remainingRatio = 1 - Math.max(0, Math.min(1, Number(summary.riskScore) || 0));
  const meterValue = summary.displayAmount ? Math.max(1, Math.round(remainingRatio * 10)) : 0;
  for (let index = 0; index < 10; index += 1) {
    const segment = meter.addText("━");
    segment.font = Font.boldSystemFont(13);
    segment.textColor = index < meterValue ? meterColor : new Color("#E7E7E7");
  }

  widget.addSpacer(6);
  const firstOverdue = (summary.fixedCostItems || []).find((item) => item.state === "overdue");
  const fixedCostDay = summary.daysUntilNextFixedCost === undefined
    ? "예정 고정비 없음"
    : summary.daysUntilNextFixedCost === 0
      ? "고정비 납부일"
      : `다음 고정비 D-${summary.daysUntilNextFixedCost}`;
  const incomeDay = summary.incomeDateKnown
    ? summary.daysUntilIncome === 0
      ? "소득 예상일"
      : `소득 예상 D-${summary.daysUntilIncome}`
    : "소득일 미정";

  const details = widget.addStack();
  details.layoutHorizontally();
  const fixedCost = details.addStack();
  fixedCost.layoutVertically();
  const badge = fixedCost.addStack();
  badge.backgroundColor = summary.overdueCount > 0 ? new Color("#FE5836") : new Color("#F28210");
  badge.cornerRadius = 6;
  badge.setPadding(2, 6, 2, 6);
  const badgeText = badge.addText(summary.overdueCount > 0 ? `미납 ${summary.overdueCount}건` : "고정비");
  badgeText.font = Font.boldSystemFont(10);
  badgeText.textColor = new Color("#FFFFFF");
  fixedCost.addSpacer(2);
  const fixedCostAmount = fixedCost.addText(`${won(summary.reservedFixedCosts)}원`);
  fixedCostAmount.font = Font.systemFont(18);
  fixedCostAmount.textColor = new Color("#2D2D2D");
  fixedCostAmount.minimumScaleFactor = 0.7;
  fixedCostAmount.lineLimit = 1;

  details.addSpacer();
  const dates = details.addStack();
  dates.layoutVertically();
  if (summary.overdueCount > 0) {
    const overdue = dates.addText(`⚠ ${periodLabel(firstOverdue && firstOverdue.period)} ${firstOverdue ? firstOverdue.name : "고정비"} 미납`);
    overdue.font = Font.boldSystemFont(10);
    overdue.textColor = new Color("#D9432B");
    overdue.rightAlignText();
    overdue.minimumScaleFactor = 0.7;
    overdue.lineLimit = 1;
  }
  const fixedDate = dates.addText(fixedCostDay);
  fixedDate.font = Font.systemFont(11);
  fixedDate.textColor = new Color("#3E3E3E");
  fixedDate.rightAlignText();
  const incomeDate = dates.addText(incomeDay);
  incomeDate.font = Font.systemFont(11);
  incomeDate.textColor = new Color("#3E3E3E");
  incomeDate.rightAlignText();
  return widget;
}

async function showConnection() {
  const connected = session();
  if (!connected) {
    const local = manualState();
    if (!local) {
      await message("설정된 잔액이 없어요", "일반은행을 연결하거나 초기 잔액을 직접 입력해 주세요.");
      return;
    }
    await message(
      "현재 방식 · 직접 입력",
      `참여자 코드 ${local.participantCode}\n현재 잔액 ${won(local.currentBalance)}원\n마지막 입력 ${timeLabel(local.syncedAt)}\n기록 ${local.history.length}건\n\n잔액·고정비·입력 기록은 이 iPhone 안에만 저장되며 서버로 자동 전송되지 않아요. 공유를 누른 경우에만 사용자가 선택한 사람에게 전달됩니다.`,
    );
    return;
  }
  const cache = cachedSummary();
  await message(
    "현재 연결",
    `${connected.provider === "popbill" ? "팝빌" : "금융결제원"} · ${connected.bankName}\n` +
      `${connected.maskedAccountNumber || "계좌번호 숨김"}\n\n` +
      `${cache ? `마지막 정상 확인 ${timeLabel(cache.syncedAt)}` : "아직 정상 잔액 확인 전"}`,
  );
}

async function menu() {
  const connected = session();
  const local = manualState();
  const items = connected
      ? [
          "지금 잔액 새로고침",
          "고정비·소득 예상일 수정",
          "고정비 납부·미납 관리",
          "연결 상태 보기",
          "계좌 연결 해제",
          "설치·개인정보 설명서",
      ]
      : local
        ? [
            "지출 입력",
            "입금 입력",
            "최근 수동 기록 보기",
            "은행 잔액과 맞추기",
            "고정비·소득 예상일 수정",
            "고정비 납부·미납 관리",
            "직접 입력 상태 보기",
            "수동 입력 기록 공유",
            "직접 입력 설정 삭제",
            "설치·개인정보 설명서",
        ]
        : [
          "일반은행 연결 (팝빌)",
          "잔액 직접 입력",
          "서버 주소 설정",
          "설치·개인정보 설명서",
        ];
  const selected = await choose(
    "미리내 · 연구 파일럿",
    items,
  );
  if (selected < 0) return;
  if (connected) {
    if (selected === 0) await refresh(true, true);
    if (selected === 1) await configureBudget(false);
    if (selected === 2) await toggleFixedCostPaid();
    if (selected === 3) await showConnection();
    if (selected === 4) await disconnect();
    if (selected === 5) Safari.open(GUIDE_URL);
  } else if (local) {
    if (selected === 0) await recordManualTransaction("expense");
    if (selected === 1) await recordManualTransaction("income");
    if (selected === 2) await showManualHistory();
    if (selected === 3) await correctManualBalance();
    if (selected === 4) await configureBudget(false);
    if (selected === 5) await toggleFixedCostPaid();
    if (selected === 6) await showConnection();
    if (selected === 7) await shareManualHistory();
    if (selected === 8) await deleteManualState();
    if (selected === 9) Safari.open(GUIDE_URL);
  } else {
    if (selected === 0) await connectPopbill();
    if (selected === 1) await startManualMode();
    if (selected === 2) {
      if (Keychain.contains(API_URL_KEY)) Keychain.remove(API_URL_KEY);
      await ensureApiUrl();
    }
    if (selected === 3) Safari.open(GUIDE_URL);
  }
}

async function main() {
  if (config.runsInWidget) {
    const local = manualState();
    if (local) {
      Script.setWidget(summaryWidget(manualSummary(local)));
    } else if (!session()) {
      Script.setWidget(placeholderWidget("설정 필요", "위젯을 눌러 계좌를 연결하거나 잔액을 입력해 주세요."));
    } else {
      const summary = await refresh(false, false);
      Script.setWidget(summaryWidget(summary));
    }
    Script.complete();
    return;
  }
  await menu();
  Script.complete();
}

await main();
