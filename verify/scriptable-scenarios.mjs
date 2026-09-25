// iPhone Scriptable manualSummary() 를 verify/scenarios.json 12개 시나리오로 돌려
// verify/expected.txt (Android SpendableCalculator 결과와 동일) 와 글자 단위로 비교합니다.
//
//   node verify/scriptable-scenarios.mjs            → 비교 후 일치/불일치 출력
//   node verify/scriptable-scenarios.mjs --print    → 결과만 출력 (expected.txt 갱신용)
//
// Android 쪽 짝은 android/app/src/test/.../CrossPlatformScenarioTest.kt 이고
// `gradlew testDebugUnitTest` 로 돕니다. 한쪽 계산식을 바꿨으면 양쪽 모두 갱신하세요.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const scenarios = JSON.parse(fs.readFileSync(path.join(here, "scenarios.json"), "utf8"));
const expected = fs.readFileSync(path.join(here, "expected.txt"), "utf8").trim().split("\n");
const sourcePath = path.join(here, "..", "ios-scriptable", "SseuldonPilot.source.js");

// 스크립트 끝의 `await main();` 을 시나리오 실행 훅으로 바꿔 모듈 내부 함수(manualSummary)에 접근합니다.
let source = fs.readFileSync(sourcePath, "utf8").replace(/^\uFEFF/, "");
source = source.replace("await main();", `
globalThis.__runScenario = (s) => manualSummary({
  mode: "manual", participantCode: "P01", currentBalance: s.balance, syncedAt: new Date().toISOString(), history: [],
  budget: { nextIncomeDate: s.nextIncomeDate, incomeMode: s.incomeMode, incomeDay: s.incomeDay,
            incomeGraceDays: s.grace, safetyBuffer: s.buffer, fixedCosts: s.costs },
});
`);

// Scriptable 전역 객체 최소 스텁
globalThis.Script = { name: () => "Mirinae" };
globalThis.FileManager = { local: () => ({ documentsDirectory: () => ".", joinPath: (_, n) => n, fileExists: () => false }) };

// "오늘"을 시나리오 날짜(한국시간 정오)로 고정
const RealDate = Date;
let fixedNow = 0;
class FakeDate extends RealDate {
  constructor(...args) { if (args.length === 0) super(fixedNow); else super(...args); }
  static now() { return fixedNow; }
}
globalThis.Date = FakeDate;

await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

const lines = scenarios.map((s) => {
  const [y, m, d] = s.today.split("-").map(Number);
  fixedNow = RealDate.UTC(y, m - 1, d, 3, 0, 0); // 12:00 KST
  const r = globalThis.__runScenario(s);
  return [
    s.name, r.spendableAmount, r.shortageAmount, r.reservedFixedCosts, r.upcomingFixedCosts, r.overdueFixedCosts,
    r.overdueCount, r.daysUntilIncome, r.incomeDateKnown, r.nextFixedCostDate ?? "-", r.daysUntilNextFixedCost ?? "-",
    r.riskLevel, r.riskScore.toFixed(4),
    r.fixedCostItems.map((i) => `${i.period}:${i.dueDate}:${i.state}`).join(";"),
  ].join("|");
});

if (process.argv.includes("--print")) {
  console.log(lines.join("\n"));
  process.exit(0);
}
let failed = 0;
lines.forEach((line, i) => {
  if (line === expected[i]) {
    console.log(`OK   ${scenarios[i].name}`);
  } else {
    failed += 1;
    console.log(`DIFF ${scenarios[i].name}\n  scriptable: ${line}\n  expected  : ${expected[i]}`);
  }
});
console.log(failed ? `\n${failed}개 불일치` : `\n${lines.length}개 시나리오 모두 Android 계산과 일치`);
process.exit(failed ? 1 : 0);
