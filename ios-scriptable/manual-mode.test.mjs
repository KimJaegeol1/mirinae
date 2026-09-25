import fs from "node:fs";

let source = fs.readFileSync(new URL("./SseuldonPilot.source.js", import.meta.url), "utf8");
source = source.replace("await main();", `
const budget = {
  nextIncomeDate: dateAfter(30),
  incomeMode: "monthly",
  incomeDay: Number(dateAfter(30).slice(-2)),
  incomeGraceDays: 3,
  safetyBuffer: 100000,
  fixedCosts: [{
    id: "rent",
    name: "월세",
    amount: 300000,
    dueDate: dateAfter(7),
    recurrence: "monthly",
    resolutions: [],
  }],
};
const state = {
  mode: "manual",
  participantCode: "P01",
  currentBalance: 1000000,
  syncedAt: new Date().toISOString(),
  budget,
  history: [],
};
const summary = manualSummary(state);
if (summary.spendableAmount !== 600000) {
  throw new Error("manual spendable mismatch: " + summary.spendableAmount);
}
const next = appendManualEvent(
  { ...state, currentBalance: 900000 },
  "expense",
  -100000,
  "식비",
);
if (
  next.history.length !== 1
  || next.history[0].changeAmount !== -100000
  || next.history[0].spendableAmount !== 500000
  || next.history[0].memo !== "식비"
) {
  throw new Error("manual history mismatch");
}
console.log("manual-ledger-tests: ok");
`);

globalThis.Script = { name: () => "Mirinae" };
globalThis.FileManager = {
  local: () => ({
    documentsDirectory: () => ".",
    joinPath: (_, name) => name,
    fileExists: () => false,
  }),
};

await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
