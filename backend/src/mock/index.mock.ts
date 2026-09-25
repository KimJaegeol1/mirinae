// 로컬 mock 진입점.
// 팀의 실제 Worker(src/index.ts)를 그대로 감싸고, /mock/* 경로만 가짜 은행 제어용으로 앞에서 처리한다.
// wrangler.mock.jsonc 의 main 이 이 파일이고, 운영 배포(wrangler.jsonc)는 이 파일을 전혀 모른다.

import worker from "../index";
import type { Env } from "../types";
import { fakeBank } from "./fake-popbill-sdk";

type MockEnv = Env & { MOCK_BANK?: string };

export default {
  async fetch(request: Request, env: MockEnv): Promise<Response> {
    const url = new URL(request.url);
    if (env.MOCK_BANK === "true" && (url.pathname === "/mock" || url.pathname.startsWith("/mock/"))) {
      try {
        return await mockRoute(request, url, env);
      } catch (error) {
        return json({ error: { code: "MOCK_ERROR", message: error instanceof Error ? error.message : String(error) } }, 400);
      }
    }
    return worker.fetch(request, env);
  },

  async scheduled(controller: ScheduledController, env: MockEnv): Promise<void> {
    return worker.scheduled(controller, env);
  },
};

async function mockRoute(request: Request, url: URL, env: MockEnv): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method === "GET" && (url.pathname === "/mock" || url.pathname === "/mock/")) {
    return new Response(controlPage(env), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  if (method === "GET" && url.pathname === "/mock/bank") {
    return json({
      inviteCode: env.PILOT_INVITE_CODE,
      cacheMinutes: env.BALANCE_CACHE_MINUTES,
      accounts: fakeBank.list(),
    });
  }
  if (method === "POST" && url.pathname === "/mock/bank/balance") {
    const input = (await request.json().catch(() => ({}))) as {
      accountNumber?: string;
      balance?: number;
      delta?: number;
    };
    const accountNumber = input.accountNumber ?? soleAccountNumber();
    if (typeof input.balance === "number") {
      return json({ account: fakeBank.setBalance(accountNumber, input.balance) });
    }
    if (typeof input.delta === "number") {
      return json({ account: fakeBank.adjust(accountNumber, input.delta) });
    }
    throw new Error("balance 또는 delta 숫자를 보내주세요.");
  }
  if (method === "POST" && url.pathname === "/mock/bank/reset") {
    fakeBank.reset();
    return json({ ok: true });
  }
  return json({ error: { code: "NOT_FOUND", message: "mock 경로가 없습니다." } }, 404);
}

function soleAccountNumber(): string {
  const all = fakeBank.list();
  if (all.length === 1) return all[0].accountNumber;
  if (all.length === 0) throw new Error("아직 등록된 가짜 계좌가 없어요. 앱에서 먼저 연결해 주세요.");
  throw new Error("계좌가 여러 개예요. accountNumber 를 지정해 주세요.");
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function controlPage(env: MockEnv): string {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>미리내 mock 은행</title>
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; margin: 0; padding: 20px; background: #f7f5fa; color: #2d2d2d; }
  h1 { font-size: 20px; margin: 0 0 4px; color: #4a3163; }
  .sub { color: #767676; font-size: 13px; margin-bottom: 16px; }
  .card { background: #fff; border-radius: 16px; padding: 16px; margin-bottom: 12px; box-shadow: 0 1px 2px rgba(0,0,0,.05); }
  .code { font-family: ui-monospace, Menlo, monospace; background: #f0edf5; padding: 2px 6px; border-radius: 6px; }
  .amount { font-size: 30px; font-weight: 700; margin: 6px 0 10px; }
  button { font: inherit; padding: 9px 12px; border-radius: 10px; border: 1px solid #d9d4e0; background: #fff; cursor: pointer; margin: 3px 4px 3px 0; }
  button.minus { border-color: #fe5836; color: #b31338; }
  button.plus { border-color: #00b176; color: #007a52; }
  button.primary { background: #6b4c8a; border-color: #6b4c8a; color: #fff; }
  input { font: inherit; padding: 8px; border-radius: 8px; border: 1px solid #d9d4e0; width: 140px; }
  .muted { color: #767676; font-size: 12px; }
  .empty { color: #767676; }
  ul { padding-left: 18px; line-height: 1.6; font-size: 13px; }
</style>
</head>
<body>
<h1>미리내 mock 은행</h1>
<div class="sub">실제 Worker 코드가 돌고 있고, 팝빌 대신 이 가짜 은행이 잔액을 줍니다. 여기서 잔액을 바꾸면 앱·위젯이 새로고침할 때 반영돼요.</div>

<div class="card">
  <div><b>파일럿 초대코드</b> <span class="code">${escapeHtml(env.PILOT_INVITE_CODE ?? "")}</span></div>
  <div class="muted" style="margin-top:6px">앱의 "일반은행 연결 (팝빌)"에서 이 코드를 넣어요. 은행은 아무거나, 계좌번호는 숫자 6자리 이상, 비밀번호 4자리·생년월일 6자리는 아무 숫자나.</div>
  <ul>
    <li>초기 잔액 = 계좌번호 끝 4자리 × 1,000원 (…1234 → 1,234,000원)</li>
    <li>끝 4자리 <span class="code">0000</span> → 등록 실패 케이스, <span class="code">9999</span> → 첫 잔액조회 지연(202 pending) 케이스</li>
    <li>서버 잔액 캐시 ${escapeHtml(env.BALANCE_CACHE_MINUTES ?? "")}분. 앱의 "지금 잔액 새로고침"은 캐시 무시하고 바로 가져와요</li>
  </ul>
</div>

<div id="accounts"></div>

<div class="card">
  <button onclick="reset()">가짜 은행 초기화 (모든 계좌 삭제)</button>
  <div class="muted" style="margin-top:6px">서버 쪽 연결(세션)은 남아 있으니 앱에서 "계좌 연결 해제"도 눌러 주세요.</div>
</div>

<script>
const fmt = (n) => Number(n).toLocaleString("ko-KR") + "원";
async function load() {
  const res = await fetch("/mock/bank");
  const data = await res.json();
  const root = document.getElementById("accounts");
  if (!data.accounts.length) {
    root.innerHTML = '<div class="card empty">아직 등록된 계좌가 없어요. 앱에서 "일반은행 연결 (팝빌)"을 진행하면 여기 나타납니다.</div>';
    return;
  }
  root.innerHTML = data.accounts.map((a) => \`
    <div class="card">
      <div><b>\${a.accountName || "계좌"}</b> · 은행코드 \${a.bankCode} · <span class="code">\${a.accountNumber}</span></div>
      <div class="amount">\${fmt(a.balance)}</div>
      <div>
        <button class="minus" onclick="adjust('\${a.accountNumber}', -10000)">−1만</button>
        <button class="minus" onclick="adjust('\${a.accountNumber}', -50000)">−5만</button>
        <button class="minus" onclick="adjust('\${a.accountNumber}', -300000)">−30만</button>
        <button class="plus" onclick="adjust('\${a.accountNumber}', 100000)">+10만</button>
        <button class="plus" onclick="adjust('\${a.accountNumber}', 1000000)">+100만</button>
      </div>
      <div style="margin-top:8px">
        <input id="set-\${a.accountNumber}" inputmode="numeric" placeholder="잔액 직접 지정">
        <button class="primary" onclick="setBalance('\${a.accountNumber}')">이 금액으로</button>
      </div>
      <div class="muted" style="margin-top:6px">잔액조회 \${a.jobRequests}회 · 등록 \${a.registeredAt.slice(0, 19).replace("T", " ")}</div>
    </div>\`).join("");
}
async function post(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) alert(data.error?.message || "실패");
  await load();
}
function adjust(accountNumber, delta) { post("/mock/bank/balance", { accountNumber, delta }); }
function setBalance(accountNumber) {
  const value = Number(String(document.getElementById("set-" + accountNumber).value).replace(/[^0-9]/g, ""));
  if (!Number.isFinite(value)) return;
  post("/mock/bank/balance", { accountNumber, balance: value });
}
function reset() { if (confirm("가짜 은행의 모든 계좌를 지울까요?")) post("/mock/bank/reset", {}); }
load();
setInterval(load, 5000);
</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[char] ?? char);
}
