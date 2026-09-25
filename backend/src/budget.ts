import type {
  Balance,
  Budget,
  FixedCost,
  FixedCostObligation,
  FixedCostResolution,
  FixedCostResolutionStatus,
  WidgetSummary,
} from "./types";

function dateOnly(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("날짜 형식이 올바르지 않습니다.");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime())
    || date.getUTCFullYear() !== Number(match[1])
    || date.getUTCMonth() + 1 !== Number(match[2])
    || date.getUTCDate() !== Number(match[3])
  ) {
    throw new Error("날짜 형식이 올바르지 않습니다.");
  }
  return date;
}

function koreaDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function monthIndex(period: string): number {
  const [year, month] = period.split("-").map(Number);
  return year * 12 + month - 1;
}

function periodFromIndex(value: number): string {
  const year = Math.floor(value / 12);
  const month = value % 12 + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function dateForMonth(period: string, day: number): string {
  const [year, month] = period.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${period}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function addDays(value: string, days: number): string {
  const result = dateOnly(value);
  result.setUTCDate(result.getUTCDate() + days);
  return dateKey(result);
}

function daysBetween(from: string, to: string): number {
  return Math.max(
    0,
    Math.ceil((dateOnly(to).getTime() - dateOnly(from).getTime()) / 86_400_000),
  );
}

function resolutionPeriod(item: FixedCost): string {
  return item.recurrence === "once" ? item.dueDate : item.dueDate.slice(0, 7);
}

function resolutionMap(item: FixedCost): Map<string, FixedCostResolution> {
  const values = new Map<string, FixedCostResolution>();
  for (const resolution of item.resolutions ?? []) {
    values.set(resolution.period, resolution);
  }
  if (item.paidAt && !values.has(resolutionPeriod(item))) {
    values.set(resolutionPeriod(item), {
      period: resolutionPeriod(item),
      status: "paid",
      resolvedAt: item.paidAt,
    });
  }
  return values;
}

function monthlyTargetPeriod(item: FixedCost, today: string): string {
  const seed = dateOnly(item.dueDate);
  const dueDay = seed.getUTCDate();
  const currentPeriod = today.slice(0, 7);
  const currentDue = dateForMonth(currentPeriod, dueDay);
  const target = currentDue >= today
    ? currentPeriod
    : periodFromIndex(monthIndex(currentPeriod) + 1);
  return monthIndex(target) < monthIndex(monthKey(seed))
    ? monthKey(seed)
    : target;
}

/**
 * 소득일과 독립된 고정비 시간축을 만든다.
 * 매월 납부일 다음 날부터는 다음 달 회차를 남겨두고,
 * 이전 회차가 미납이면 두 회차를 모두 차감한다.
 */
export function fixedCostObligations(
  budget: Budget,
  now = new Date(),
): FixedCostObligation[] {
  const today = koreaDateKey(now);
  const obligations: FixedCostObligation[] = [];
  const unique = new Set<string>();

  for (const item of budget.fixedCosts) {
    const recurrence = item.recurrence ?? "monthly";
    const resolved = resolutionMap(item);
    if (recurrence === "once") {
      const period = item.dueDate;
      const key = `${item.id}:${period}`;
      if (!resolved.has(period) && !unique.has(key)) {
        unique.add(key);
        obligations.push({
          fixedCostId: item.id,
          name: item.name,
          amount: item.amount,
          period,
          dueDate: item.dueDate,
          state: item.dueDate < today ? "overdue" : "upcoming",
        });
      }
      continue;
    }

    const seedPeriod = item.dueDate.slice(0, 7);
    const targetPeriod = monthlyTargetPeriod(item, today);
    const dueDay = dateOnly(item.dueDate).getUTCDate();
    const start = monthIndex(seedPeriod);
    const end = monthIndex(targetPeriod);
    if (end - start > 240) throw new Error("고정비 반복기간이 너무 깁니다.");

    for (let index = start; index <= end; index += 1) {
      const period = periodFromIndex(index);
      const key = `${item.id}:${period}`;
      if (unique.has(key) || resolved.has(period)) continue;
      unique.add(key);
      const dueDate = dateForMonth(period, dueDay);
      obligations.push({
        fixedCostId: item.id,
        name: item.name,
        amount: item.amount,
        period,
        dueDate,
        state: dueDate < today ? "overdue" : "upcoming",
      });
    }
  }

  return obligations.sort((a, b) =>
    a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name));
}

function incomeProjection(budget: Budget, today: string): {
  nextIncomeDate: string;
  daysUntilIncome: number;
  incomeDateKnown: boolean;
  incomeWindowStart?: string;
  incomeWindowEnd?: string;
} {
  const graceDays = budget.incomeGraceDays ?? 3;
  if ((budget.incomeMode ?? "monthly") === "irregular") {
    const configured = budget.nextIncomeDate;
    const known = configured >= addDays(today, -graceDays);
    return {
      nextIncomeDate: known ? configured : "",
      daysUntilIncome: known ? daysBetween(today, configured) : 0,
      incomeDateKnown: known,
      ...(known
        ? {
            incomeWindowStart: addDays(configured, -graceDays),
            incomeWindowEnd: addDays(configured, graceDays),
          }
        : {}),
    };
  }

  const incomeDay = budget.incomeDay ?? dateOnly(budget.nextIncomeDate).getUTCDate();
  const currentPeriod = today.slice(0, 7);
  const currentCandidate = dateForMonth(currentPeriod, incomeDay);
  const nextIncomeDate = currentCandidate >= today
    ? currentCandidate
    : dateForMonth(periodFromIndex(monthIndex(currentPeriod) + 1), incomeDay);
  return {
    nextIncomeDate,
    daysUntilIncome: daysBetween(today, nextIncomeDate),
    incomeDateKnown: true,
    incomeWindowStart: addDays(nextIncomeDate, -graceDays),
    incomeWindowEnd: addDays(nextIncomeDate, graceDays),
  };
}

export function setFixedCostStatus(
  budget: Budget,
  fixedCostId: string,
  period: string,
  status: FixedCostResolutionStatus | "unpaid",
  resolvedAt: string,
): Budget {
  let matched = false;
  const fixedCosts = budget.fixedCosts.map((item) => {
    if (item.id !== fixedCostId) return item;
    const recurrence = item.recurrence ?? "monthly";
    const validPeriod = recurrence === "once"
      ? period === item.dueDate
      : /^\d{4}-\d{2}$/.test(period)
        && monthIndex(period) >= monthIndex(item.dueDate.slice(0, 7));
    if (!validPeriod) throw new Error("고정비 회차가 올바르지 않습니다.");
    matched = true;
    const resolutions = (item.resolutions ?? [])
      .filter((value) => value.period !== period);
    if (status !== "unpaid") resolutions.push({ period, status, resolvedAt });
    const next = { ...item, resolutions };
    delete next.paidAt;
    return next;
  });
  if (!matched) throw new Error("고정비 항목을 찾을 수 없습니다.");
  return { ...budget, fixedCosts };
}

export function calculateSummary(
  balance: Balance,
  budget: Budget,
  hideAmounts: boolean,
  now = new Date(),
): WidgetSummary {
  const availableAmount = balance.availableAmount;
  const obligations = fixedCostObligations(budget, now);
  const overdue = obligations.filter((item) => item.state === "overdue");
  const upcoming = obligations.filter((item) => item.state === "upcoming");
  const overdueFixedCosts = overdue.reduce((total, item) => total + item.amount, 0);
  const upcomingFixedCosts = upcoming.reduce((total, item) => total + item.amount, 0);
  const reservedFixedCosts = overdueFixedCosts + upcomingFixedCosts;
  const spendableAmount = availableAmount - reservedFixedCosts - budget.safetyBuffer;
  const today = koreaDateKey(now);
  const income = incomeProjection(budget, today);
  const nextFixedCostDate = upcoming[0]?.dueDate;
  const daysUntilNextFixedCost = nextFixedCostDate
    ? daysBetween(today, nextFixedCostDate)
    : undefined;
  const ageMs = now.getTime() - new Date(balance.syncedAt).getTime();
  const riskScore = Math.max(0, Math.min(1, (300_000 - spendableAmount) / 300_000));
  const shakeLevel: 0 | 1 | 2 | 3 = spendableAmount <= 10_000
    ? 3
    : spendableAmount <= 30_000
      ? 2
      : spendableAmount < 50_000
        ? 1
        : 0;
  const planningDays = income.incomeDateKnown && income.daysUntilIncome > 0
    ? income.daysUntilIncome
    : daysUntilNextFixedCost ?? 0;
  const dailySpendable = planningDays > 0 ? spendableAmount / planningDays : spendableAmount;
  const riskLevel = spendableAmount < 0
    ? "critical"
    : spendableAmount < 50_000
      ? "danger"
      : spendableAmount <= Math.max(100_000, reservedFixedCosts / 4)
          || (planningDays > 0 && dailySpendable < 20_000)
        ? "caution"
        : "safe";
  const status = ageMs > 24 * 60 * 60_000
    ? "stale"
    : ageMs > 60 * 60_000
      ? "delayed"
      : "fresh";

  return {
    spendableAmount,
    shortageAmount: Math.max(0, -spendableAmount),
    availableAmount,
    reservedFixedCosts,
    upcomingFixedCosts,
    overdueFixedCosts,
    overdueCount: overdue.length,
    fixedCostItems: obligations,
    safetyBuffer: budget.safetyBuffer,
    nextIncomeDate: income.nextIncomeDate,
    daysUntilIncome: income.daysUntilIncome,
    incomeDateKnown: income.incomeDateKnown,
    ...(income.incomeWindowStart
      ? { incomeWindowStart: income.incomeWindowStart }
      : {}),
    ...(income.incomeWindowEnd
      ? { incomeWindowEnd: income.incomeWindowEnd }
      : {}),
    ...(nextFixedCostDate ? { nextFixedCostDate } : {}),
    ...(daysUntilNextFixedCost === undefined ? {} : { daysUntilNextFixedCost }),
    syncedAt: balance.syncedAt,
    needsUpdate: status !== "fresh",
    displayAmount: !hideAmounts && status !== "stale",
    provider: "popbill",
    riskScore,
    riskLevel,
    shakeLevel,
    status,
  };
}
