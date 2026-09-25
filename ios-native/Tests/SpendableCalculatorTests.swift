import XCTest
@testable import Mirinae

/// Android `SpendableCalculatorTest.kt` 의 13개 테스트를 그대로 옮긴 것.
final class SpendableCalculatorTests: XCTestCase {
    /// 해당 날짜의 한국시간 정오 (UTC 03:00) → epoch ms
    private func atKoreaNoon(_ date: String) -> Int {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return Int(formatter.date(from: "\(date)T03:00:00Z")!.timeIntervalSince1970 * 1000)
    }

    private func configured(_ now: Int, _ overrides: (inout MirinaeState) -> Void = { _ in }) -> MirinaeState {
        var state = MirinaeState(
            currentBalance: 1_243_000,
            safetyBuffer: 100_000,
            nextIncomeDate: "2026-08-25",
            incomeMode: "monthly",
            incomeDay: 25,
            incomeGraceDays: 3,
            fixedCosts: [
                FixedCost(id: "rent", name: "월세", amount: 500_000, dueDate: "2026-08-05", recurrence: "monthly"),
            ],
            syncedAt: now
        )
        overrides(&state)
        return state
    }

    /// 납부일 전에는 이번 회차만 차감한다
    func testBeforeDueDateOnlyCurrentPeriodIsReserved() {
        let now = atKoreaNoon("2026-08-04")
        let summary = SpendableCalculator.summary(configured(now), nowMillis: now)
        XCTAssertEqual(summary.upcomingFixedCosts, 500_000)
        XCTAssertEqual(summary.overdueFixedCosts, 0)
        XCTAssertEqual(summary.spendableAmount, 643_000)
        XCTAssertEqual(summary.fixedCostItems.count, 1)
        XCTAssertEqual(summary.fixedCostItems.first?.period, "2026-08")
    }

    /// 납부일 다음 날 미납이면 두 회차를 함께 차감한다
    func testDayAfterDueDateReservesBothPeriods() {
        let now = atKoreaNoon("2026-08-06")
        let summary = SpendableCalculator.summary(configured(now), nowMillis: now)
        XCTAssertEqual(summary.overdueFixedCosts, 500_000)
        XCTAssertEqual(summary.upcomingFixedCosts, 500_000)
        XCTAssertEqual(summary.reservedFixedCosts, 1_000_000)
        XCTAssertEqual(summary.spendableAmount, 143_000)
        XCTAssertEqual(summary.overdueCount, 1)
    }

    /// 지난 회차 납부 후에는 다음 회차만 차감한다
    func testAfterPayingLastPeriodOnlyNextPeriodIsReserved() {
        let now = atKoreaNoon("2026-08-06")
        let state = configured(now) { state in
            state.currentBalance = 743_000
            state.fixedCosts = state.fixedCosts.map { cost in
                var value = cost
                value.resolutions = [FixedCostResolution(period: "2026-08", status: "paid", resolvedAt: now)]
                return value
            }
        }
        let summary = SpendableCalculator.summary(state, nowMillis: now)
        XCTAssertEqual(summary.overdueFixedCosts, 0)
        XCTAssertEqual(summary.upcomingFixedCosts, 500_000)
        XCTAssertEqual(summary.spendableAmount, 143_000)
    }

    /// 3개월을 넘겨 미납하면 지난 회차와 다음 회차를 모두 보호한다
    func testThreeMonthsOverdueKeepsAllPeriods() {
        let now = atKoreaNoon("2026-10-06")
        let summary = SpendableCalculator.summary(configured(now) { $0.currentBalance = 3_000_000 }, nowMillis: now)
        XCTAssertEqual(summary.fixedCostItems.map { $0.period }, ["2026-08", "2026-09", "2026-10", "2026-11"])
        XCTAssertEqual(summary.overdueCount, 3)
        XCTAssertEqual(summary.overdueFixedCosts, 1_500_000)
        XCTAssertEqual(summary.upcomingFixedCosts, 500_000)
        XCTAssertEqual(summary.spendableAmount, 900_000)
    }

    /// 31일 납부일은 짧은 달의 마지막 날로 보정한다
    func testDay31IsClampedToShortMonth() {
        let now = atKoreaNoon("2027-02-28")
        let state = configured(now) { state in
            state.fixedCosts = [
                FixedCost(
                    id: "rent", name: "월세", amount: 500_000, dueDate: "2027-01-31", recurrence: "monthly",
                    resolutions: [FixedCostResolution(period: "2027-01", status: "paid", resolvedAt: self.atKoreaNoon("2027-01-31"))]
                ),
            ]
        }
        let items = SpendableCalculator.summary(state, nowMillis: now).fixedCostItems
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items.first?.period, "2027-02")
        XCTAssertEqual(items.first?.dueDate, "2027-02-28")
        XCTAssertEqual(items.first?.overdue, false)
    }

    /// 연도가 바뀌어도 다음 회차를 생성한다
    func testNextPeriodCrossesYearBoundary() {
        let now = atKoreaNoon("2026-12-06")
        let state = configured(now) { state in
            state.fixedCosts = state.fixedCosts.map { cost in
                var value = cost
                value.dueDate = "2026-12-05"
                return value
            }
        }
        XCTAssertEqual(SpendableCalculator.summary(state, nowMillis: now).fixedCostItems.map { $0.period }, ["2026-12", "2027-01"])
    }

    /// 불규칙 소득일이 유예범위를 지나면 미정이다
    func testIrregularIncomePastGraceIsUnknown() {
        let now = atKoreaNoon("2026-08-30")
        let summary = SpendableCalculator.summary(configured(now) { state in
            state.incomeMode = "irregular"
            state.nextIncomeDate = "2026-08-25"
        }, nowMillis: now)
        XCTAssertEqual(summary.incomeDateKnown, false)
        XCTAssertEqual(summary.daysUntilIncome, 0)
    }

    /// 오래된 잔액은 금액을 숨긴다
    func testStaleBalanceHidesAmount() {
        let now = atKoreaNoon("2026-08-04")
        let summary = SpendableCalculator.summary(configured(now) { $0.syncedAt = now - 25 * 60 * 60 * 1000 }, nowMillis: now)
        XCTAssertEqual(summary.syncStatus, .stale)
        XCTAssertEqual(summary.displayAmount, false)
        XCTAssertEqual(summary.currentBalance, 1_243_000)
    }

    /// 1시간 넘게 갱신되지 않은 잔액은 지연으로 표시한다
    func testBalanceOlderThanOneHourIsDelayed() {
        let now = atKoreaNoon("2026-08-04")
        let summary = SpendableCalculator.summary(configured(now) { $0.syncedAt = now - 61 * 60 * 1000 }, nowMillis: now)
        XCTAssertEqual(summary.syncStatus, .delayed)
        XCTAssertEqual(summary.displayAmount, true)
    }

    /// 직접 입력 잔액은 오래되어도 자동조회 실패로 숨기지 않는다
    func testManualBalanceNeverGoesStale() {
        let now = atKoreaNoon("2026-08-04")
        let summary = SpendableCalculator.summary(configured(now) { state in
            state.balanceMode = "manual"
            state.syncedAt = now - 40 * 24 * 60 * 60 * 1000
        }, nowMillis: now)
        XCTAssertEqual(summary.syncStatus, .fresh)
        XCTAssertEqual(summary.displayAmount, true)
    }

    /// 수동 입금은 현재 잔액에 더한다
    func testManualIncomeAddsToBalance() throws {
        XCTAssertEqual(try SpendableCalculator.manualBalanceAfter(300_000, type: "income", amount: 50_000), 350_000)
    }

    /// 수동 지출은 현재 잔액에서 뺀다
    func testManualExpenseSubtractsFromBalance() throws {
        XCTAssertEqual(try SpendableCalculator.manualBalanceAfter(300_000, type: "expense", amount: 50_000), 250_000)
    }

    /// 현재 잔액보다 큰 수동 지출은 막는다
    func testManualExpenseLargerThanBalanceIsRejected() {
        XCTAssertThrowsError(try SpendableCalculator.manualBalanceAfter(30_000, type: "expense", amount: 50_000))
    }
}
