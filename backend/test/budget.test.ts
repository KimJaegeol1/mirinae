import { describe, expect, it } from "vitest";
import {
  calculateSummary,
  fixedCostObligations,
  setFixedCostStatus,
} from "../src/budget";
import type { Balance, Budget } from "../src/types";

function atKoreaNoon(date: string): Date {
  return new Date(`${date}T03:00:00.000Z`);
}

function balance(now: Date, amount = 1_243_000): Balance {
  return {
    balanceAmount: amount,
    availableAmount: amount,
    bankName: "테스트은행",
    productName: "생활비 계좌",
    syncedAt: now.toISOString(),
    provider: "popbill",
  };
}

function budget(overrides: Partial<Budget> = {}): Budget {
  return {
    nextIncomeDate: "2026-08-25",
    incomeMode: "monthly",
    incomeDay: 25,
    incomeGraceDays: 3,
    safetyBuffer: 100_000,
    fixedCosts: [
      {
        id: "rent",
        category: "rent",
        name: "월세",
        amount: 500_000,
        dueDate: "2026-08-05",
        recurrence: "monthly",
        resolutions: [],
      },
    ],
    ...overrides,
  };
}

describe("미리내 월별 고정비 회차", () => {
  it("납부일까지는 이번 달 회차만 남겨둔다", () => {
    const now = atKoreaNoon("2026-08-04");
    const summary = calculateSummary(balance(now), budget(), false, now);
    expect(summary.upcomingFixedCosts).toBe(500_000);
    expect(summary.overdueFixedCosts).toBe(0);
    expect(summary.spendableAmount).toBe(643_000);
    expect(summary.fixedCostItems[0]).toMatchObject({
      period: "2026-08",
      dueDate: "2026-08-05",
      state: "upcoming",
    });
  });

  it("납부일 당일에도 이번 달 회차만 남겨둔다", () => {
    const now = atKoreaNoon("2026-08-05");
    const items = fixedCostObligations(budget(), now);
    expect(items).toHaveLength(1);
    expect(items[0].period).toBe("2026-08");
  });

  it("납부일 다음 날 미납이면 지난달 미납과 다음 회차를 함께 차감한다", () => {
    const now = atKoreaNoon("2026-08-06");
    const summary = calculateSummary(balance(now), budget(), false, now);
    expect(summary.overdueFixedCosts).toBe(500_000);
    expect(summary.upcomingFixedCosts).toBe(500_000);
    expect(summary.overdueCount).toBe(1);
    expect(summary.reservedFixedCosts).toBe(1_000_000);
    expect(summary.spendableAmount).toBe(143_000);
    expect(summary.fixedCostItems.map((item) => item.period)).toEqual([
      "2026-08",
      "2026-09",
    ]);
  });

  it("이번 달 납부가 확인되면 다음 회차만 차감한다", () => {
    const now = atKoreaNoon("2026-08-06");
    const paid = setFixedCostStatus(
      budget(),
      "rent",
      "2026-08",
      "paid",
      now.toISOString(),
    );
    const summary = calculateSummary(balance(now, 743_000), paid, false, now);
    expect(summary.overdueFixedCosts).toBe(0);
    expect(summary.upcomingFixedCosts).toBe(500_000);
    expect(summary.spendableAmount).toBe(143_000);
  });

  it("3개월을 넘겨 미납하면 지난 회차와 다음 회차를 모두 보호한다", () => {
    const now = atKoreaNoon("2026-10-06");
    const summary = calculateSummary(balance(now, 3_000_000), budget(), false, now);
    expect(summary.fixedCostItems.map((item) => item.period)).toEqual([
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    expect(summary.overdueCount).toBe(3);
    expect(summary.overdueFixedCosts).toBe(1_500_000);
    expect(summary.upcomingFixedCosts).toBe(500_000);
    expect(summary.spendableAmount).toBe(900_000);
  });

  it("31일 납부일은 짧은 달에서 마지막 날로 안전하게 보정한다", () => {
    const now = atKoreaNoon("2027-02-28");
    const longMonth = budget({
      fixedCosts: [{
        ...budget().fixedCosts[0],
        dueDate: "2027-01-31",
        resolutions: [{
          period: "2027-01",
          status: "paid",
          resolvedAt: "2027-01-31T03:00:00.000Z",
        }],
      }],
    });
    const items = fixedCostObligations(longMonth, now);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      period: "2027-02",
      dueDate: "2027-02-28",
      state: "upcoming",
    });
  });

  it("연도가 바뀌어도 다음 회차를 올바르게 생성한다", () => {
    const now = atKoreaNoon("2026-12-06");
    const yearEnd = budget({
      fixedCosts: [{
        ...budget().fixedCosts[0],
        dueDate: "2026-12-05",
      }],
    });
    expect(fixedCostObligations(yearEnd, now).map((item) => item.period)).toEqual([
      "2026-12",
      "2027-01",
    ]);
  });

  it("일회성 고정비는 미납이어도 다음 달 회차를 만들지 않는다", () => {
    const now = atKoreaNoon("2026-08-06");
    const once = budget({
      fixedCosts: [{
        ...budget().fixedCosts[0],
        recurrence: "once",
      }],
    });
    const summary = calculateSummary(balance(now), once, false, now);
    expect(summary.overdueFixedCosts).toBe(500_000);
    expect(summary.upcomingFixedCosts).toBe(0);
  });

  it("기존 1개월 paidAt 설정도 해당 월 납부기록으로 안전하게 읽는다", () => {
    const now = atKoreaNoon("2026-08-06");
    const legacy = budget({
      fixedCosts: [{
        id: "rent",
        category: "rent",
        name: "월세",
        amount: 500_000,
        dueDate: "2026-08-05",
        paidAt: "2026-08-05T03:00:00.000Z",
      }],
    });
    const summary = calculateSummary(balance(now), legacy, false, now);
    expect(summary.overdueCount).toBe(0);
    expect(summary.fixedCostItems.map((item) => item.period)).toEqual(["2026-09"]);
  });
});

describe("소득일과 잔액 안전성", () => {
  it("정기 소득일이 지나면 다음 달 예상일로 자동 이동한다", () => {
    const now = atKoreaNoon("2026-08-26");
    const summary = calculateSummary(balance(now), budget(), false, now);
    expect(summary.nextIncomeDate).toBe("2026-09-25");
    expect(summary.incomeDateKnown).toBe(true);
    expect(summary.incomeWindowStart).toBe("2026-09-22");
    expect(summary.incomeWindowEnd).toBe("2026-09-28");
  });

  it("불규칙 소득 예정일이 허용범위를 지나면 소득일 미정으로 둔다", () => {
    const now = atKoreaNoon("2026-08-30");
    const summary = calculateSummary(balance(now), budget({
      incomeMode: "irregular",
      nextIncomeDate: "2026-08-25",
    }), false, now);
    expect(summary.incomeDateKnown).toBe(false);
    expect(summary.nextIncomeDate).toBe("");
  });

  it("24시간 넘은 잔액은 금액을 숨기고 잘못된 0원으로 바꾸지 않는다", () => {
    const now = atKoreaNoon("2026-08-04");
    const staleBalance = {
      ...balance(now),
      syncedAt: "2026-08-02T00:00:00.000Z",
    };
    const summary = calculateSummary(staleBalance, budget(), false, now);
    expect(summary.status).toBe("stale");
    expect(summary.displayAmount).toBe(false);
    expect(summary.availableAmount).toBe(1_243_000);
  });

  it("1시간 넘게 갱신되지 않은 잔액은 지연 상태로 명확히 표시한다", () => {
    const now = atKoreaNoon("2026-08-04");
    const delayedBalance = {
      ...balance(now),
      syncedAt: new Date(now.getTime() - 61 * 60_000).toISOString(),
    };
    const summary = calculateSummary(delayedBalance, budget(), false, now);
    expect(summary.status).toBe("delayed");
    expect(summary.displayAmount).toBe(true);
    expect(summary.needsUpdate).toBe(true);
  });
});
