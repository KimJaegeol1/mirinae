import XCTest
@testable import Mirinae

/// Android SpendableCalculator ↔ iPhone Scriptable ↔ iOS 네이티브 교차 검증.
///
/// verify/scenarios.json 의 12개 시나리오를 그대로 옮긴 것. 기대값 문자열은
/// verify/expected.txt (Android Kotlin 출력 = Scriptable 출력) 와 글자 단위로 같아야 한다.
/// 계산식을 한쪽에서 바꿨다면 세 곳 모두 고친 뒤 기대값을 함께 갱신한다.
final class CrossPlatformScenarioTests: XCTestCase {
    /// 시나리오 날짜의 한국시간 정오 (UTC 03:00) → epoch ms
    private func koreaNoon(_ date: String) -> Int {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return Int(formatter.date(from: "\(date)T03:00:00Z")!.timeIntervalSince1970 * 1000)
    }

    private func line(_ name: String, _ r: SpendableSummary) -> String {
        let items = r.fixedCostItems
            .map { "\($0.period):\($0.dueDate):\($0.overdue ? "overdue" : "upcoming")" }
            .joined(separator: ";")
        return [
            name,
            String(r.spendableAmount),
            String(r.shortageAmount),
            String(r.reservedFixedCosts),
            String(r.upcomingFixedCosts),
            String(r.overdueFixedCosts),
            String(r.overdueCount),
            String(r.daysUntilIncome),
            r.incomeDateKnown ? "true" : "false",
            r.nextFixedCostDate ?? "-",
            r.daysUntilNextFixedCost.map { String($0) } ?? "-",
            r.riskLevel.rawValue,
            String(format: "%.4f", r.riskScore),
            items,
        ].joined(separator: "|")
    }

    private func check(_ name: String, today: String, state: MirinaeState, expected: String) {
        var value = state
        let now = koreaNoon(today)
        value.syncedAt = now
        XCTAssertEqual(line(name, SpendableCalculator.summary(value, nowMillis: now)), expected)
    }

    /// 01_납부일전
    func testScenario01() {
        check(
            "01_납부일전", today: "2026-08-04",
            state: MirinaeState(
                currentBalance: 1243000, balanceMode: "manual", safetyBuffer: 100000,
                nextIncomeDate: "2026-08-25", incomeMode: "monthly", incomeDay: 25, incomeGraceDays: 3,
                fixedCosts: [
                    FixedCost(id: "rent", name: "월세", amount: 500000, dueDate: "2026-08-05", recurrence: "monthly"),
                ]
            ),
            expected: "01_납부일전|643000|0|500000|500000|0|0|21|true|2026-08-05|1|safe|0.0000|2026-08:2026-08-05:upcoming"
        )
    }

    /// 02_납부일다음날_미납
    func testScenario02() {
        check(
            "02_납부일다음날_미납", today: "2026-08-06",
            state: MirinaeState(
                currentBalance: 1243000, balanceMode: "manual", safetyBuffer: 100000,
                nextIncomeDate: "2026-08-25", incomeMode: "monthly", incomeDay: 25, incomeGraceDays: 3,
                fixedCosts: [
                    FixedCost(id: "rent", name: "월세", amount: 500000, dueDate: "2026-08-05", recurrence: "monthly"),
                ]
            ),
            expected: "02_납부일다음날_미납|143000|0|1000000|500000|500000|1|19|true|2026-09-05|30|caution|0.5233|2026-08:2026-08-05:overdue;2026-09:2026-09-05:upcoming"
        )
    }

    /// 03_이번회차_납부완료
    func testScenario03() {
        check(
            "03_이번회차_납부완료", today: "2026-08-06",
            state: MirinaeState(
                currentBalance: 1243000, balanceMode: "manual", safetyBuffer: 100000,
                nextIncomeDate: "2026-08-25", incomeMode: "monthly", incomeDay: 25, incomeGraceDays: 3,
                fixedCosts: [
                    FixedCost(id: "rent", name: "월세", amount: 500000, dueDate: "2026-08-05", recurrence: "monthly", resolutions: [FixedCostResolution(period: "2026-08", status: "paid", resolvedAt: 1754000000000)]),
                ]
            ),
            expected: "03_이번회차_납부완료|643000|0|500000|500000|0|0|19|true|2026-09-05|30|safe|0.0000|2026-09:2026-09-05:upcoming"
        )
    }

    /// 04_오늘_부족_복합
    func testScenario04() {
        check(
            "04_오늘_부족_복합", today: "2026-09-13",
            state: MirinaeState(
                currentBalance: 400000, balanceMode: "manual", safetyBuffer: 50000,
                nextIncomeDate: "2026-09-20", incomeMode: "irregular", incomeDay: 25, incomeGraceDays: 3,
                fixedCosts: [
                    FixedCost(id: "tel", name: "통신비", amount: 55000, dueDate: "2026-09-15", recurrence: "monthly"),
                    FixedCost(id: "rent", name: "월세", amount: 300000, dueDate: "2026-09-25", recurrence: "monthly"),
                    FixedCost(id: "ott", name: "넷플릭스", amount: 17000, dueDate: "2026-09-10", recurrence: "once"),
                ]
            ),
            expected: "04_오늘_부족_복합|-22000|22000|372000|355000|17000|1|7|true|2026-09-15|2|critical|1.0000|2026-09-10:2026-09-10:overdue;2026-09:2026-09-15:upcoming;2026-09:2026-09-25:upcoming"
        )
    }

    /// 05_경계_5만원_정확히
    func testScenario05() {
        check(
            "05_경계_5만원_정확히", today: "2026-09-13",
            state: MirinaeState(
                currentBalance: 150000, balanceMode: "manual", safetyBuffer: 0,
                nextIncomeDate: "2026-09-25", incomeMode: "monthly", incomeDay: 25, incomeGraceDays: 3,
                fixedCosts: [
                    FixedCost(id: "a", name: "관리비", amount: 100000, dueDate: "2026-09-20", recurrence: "monthly"),
                ]
            ),
            expected: "05_경계_5만원_정확히|50000|0|100000|100000|0|0|12|true|2026-09-20|7|caution|0.8333|2026-09:2026-09-20:upcoming"
        )
    }

    /// 06_경계_49999
    func testScenario06() {
        check(
            "06_경계_49999", today: "2026-09-13",
            state: MirinaeState(
                currentBalance: 149999, balanceMode: "manual", safetyBuffer: 0,
                nextIncomeDate: "2026-09-25", incomeMode: "monthly", incomeDay: 25, incomeGraceDays: 3,
                fixedCosts: [
                    FixedCost(id: "a", name: "관리비", amount: 100000, dueDate: "2026-09-20", recurrence: "monthly"),
                ]
            ),
            expected: "06_경계_49999|49999|0|100000|100000|0|0|12|true|2026-09-20|7|danger|0.8333|2026-09:2026-09-20:upcoming"
        )
    }

    /// 07_주의선_reserved4분의1
    func testScenario07() {
        check(
            "07_주의선_reserved4분의1", today: "2026-09-13",
            state: MirinaeState(
                currentBalance: 999000, balanceMode: "manual", safetyBuffer: 0,
                nextIncomeDate: "2026-09-25", incomeMode: "monthly", incomeDay: 25, incomeGraceDays: 3,
                fixedCosts: [
                    FixedCost(id: "a", name: "월세", amount: 800000, dueDate: "2026-09-20", recurrence: "monthly"),
                ]
            ),
            expected: "07_주의선_reserved4분의1|199000|0|800000|800000|0|0|12|true|2026-09-20|7|caution|0.3367|2026-09:2026-09-20:upcoming"
        )
    }

    /// 08_일일가용_2만미만
    func testScenario08() {
        check(
            "08_일일가용_2만미만", today: "2026-09-01",
            state: MirinaeState(
                currentBalance: 1050000, balanceMode: "manual", safetyBuffer: 0,
                nextIncomeDate: "2026-09-30", incomeMode: "monthly", incomeDay: 30, incomeGraceDays: 3,
                fixedCosts: [
                    FixedCost(id: "a", name: "월세", amount: 800000, dueDate: "2026-09-20", recurrence: "monthly"),
                ]
            ),
            expected: "08_일일가용_2만미만|250000|0|800000|800000|0|0|29|true|2026-09-20|19|caution|0.1667|2026-09:2026-09-20:upcoming"
        )
    }

    /// 09_31일_짧은달_보정
    func testScenario09() {
        check(
            "09_31일_짧은달_보정", today: "2026-02-10",
            state: MirinaeState(
                currentBalance: 2000000, balanceMode: "manual", safetyBuffer: 100000,
                nextIncomeDate: "2026-02-25", incomeMode: "monthly", incomeDay: 25, incomeGraceDays: 3,
                fixedCosts: [
                    FixedCost(id: "a", name: "보험", amount: 90000, dueDate: "2026-01-31", recurrence: "monthly"),
                ]
            ),
            expected: "09_31일_짧은달_보정|1720000|0|180000|90000|90000|1|15|true|2026-02-28|18|safe|0.0000|2026-01:2026-01-31:overdue;2026-02:2026-02-28:upcoming"
        )
    }

    /// 10_불규칙소득_유예만료
    func testScenario10() {
        check(
            "10_불규칙소득_유예만료", today: "2026-09-13",
            state: MirinaeState(
                currentBalance: 500000, balanceMode: "manual", safetyBuffer: 100000,
                nextIncomeDate: "2026-09-05", incomeMode: "irregular", incomeDay: 25, incomeGraceDays: 3,
                fixedCosts: [
                    FixedCost(id: "a", name: "통신비", amount: 55000, dueDate: "2026-09-28", recurrence: "monthly"),
                ]
            ),
            expected: "10_불규칙소득_유예만료|345000|0|55000|55000|0|0|0|false|2026-09-28|15|safe|0.0000|2026-09:2026-09-28:upcoming"
        )
    }

    /// 11_연도전환
    func testScenario11() {
        check(
            "11_연도전환", today: "2026-12-20",
            state: MirinaeState(
                currentBalance: 900000, balanceMode: "manual", safetyBuffer: 100000,
                nextIncomeDate: "2026-12-25", incomeMode: "monthly", incomeDay: 25, incomeGraceDays: 3,
                fixedCosts: [
                    FixedCost(id: "a", name: "월세", amount: 300000, dueDate: "2026-12-05", recurrence: "monthly"),
                ]
            ),
            expected: "11_연도전환|200000|0|600000|300000|300000|1|5|true|2027-01-05|16|safe|0.3333|2026-12:2026-12-05:overdue;2027-01:2027-01-05:upcoming"
        )
    }

    /// 12_고정비없음_불규칙_미정
    func testScenario12() {
        check(
            "12_고정비없음_불규칙_미정", today: "2026-09-13",
            state: MirinaeState(
                currentBalance: 80000, balanceMode: "manual", safetyBuffer: 0,
                nextIncomeDate: "", incomeMode: "irregular", incomeDay: 25, incomeGraceDays: 3,
                fixedCosts: []
            ),
            expected: "12_고정비없음_불규칙_미정|80000|0|0|0|0|0|0|false|-|-|caution|0.7333|"
        )
    }
}
