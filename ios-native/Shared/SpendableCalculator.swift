import Foundation

/// Android `domain/SpendableCalculator.kt` 를 한 줄씩 옮긴 계산기.
/// 날짜는 전부 한국시간(Asia/Seoul) 기준 "yyyy-MM-dd" 문자열로 다룬다.
/// 계산식·임계값을 바꾸면 Android/Scriptable/서버 쪽도 함께 바꾸고 Tests 의 기대값을 갱신한다.
enum SpendableCalculator {
    static let korea: TimeZone = TimeZone(identifier: "Asia/Seoul") ?? TimeZone(secondsFromGMT: 9 * 3600)!

    static var calendar: Calendar {
        var value = Calendar(identifier: .gregorian)
        value.timeZone = korea
        value.locale = Locale(identifier: "en_US_POSIX")
        return value
    }

    static func nowMillis() -> Int {
        Int(Date().timeIntervalSince1970 * 1000)
    }

    // MARK: - 요약

    static func summary(_ state: MirinaeState, nowMillis: Int? = nil) -> SpendableSummary {
        let now = nowMillis ?? Self.nowMillis()
        let today = dateKey(now)
        let items = obligations(state.fixedCosts, today: today)
        let overdueItems = items.filter { $0.overdue }
        let upcomingItems = items.filter { !$0.overdue }
        let overdue = overdueItems.reduce(0) { $0 + max(0, $1.amount) }
        let upcoming = upcomingItems.reduce(0) { $0 + max(0, $1.amount) }
        let reserved = overdue + upcoming
        let spendable = (state.currentBalance ?? 0) - reserved - max(0, state.safetyBuffer)
        let income = incomeProjection(state, today: today)
        let nextFixedCostDate = upcomingItems.min { $0.dueDate < $1.dueDate }?.dueDate
        let daysUntilFixedCost = nextFixedCostDate.map { daysBetween(today, $0) }
        let planningDays = (income.known && income.days > 0) ? income.days : (daysUntilFixedCost ?? 0)
        let level = riskLevel(spendable: spendable, reservedFixedCosts: reserved, planningDays: planningDays)
        let age = max(0, now - state.syncedAt)
        let syncStatus: SyncStatus
        if state.balanceMode == "manual" {
            syncStatus = .fresh
        } else if age > 24 * 60 * 60 * 1000 {
            syncStatus = .stale
        } else if age > 60 * 60 * 1000 || !state.syncError.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            syncStatus = .delayed
        } else {
            syncStatus = .fresh
        }
        let riskLabel: String
        switch level {
        case .safe: riskLabel = "안전"
        case .caution: riskLabel = "조금 아껴 써요"
        case .danger: riskLabel = "고정비에 가까워요"
        case .critical: riskLabel = "고정비가 부족해요"
        }
        return SpendableSummary(
            spendableAmount: spendable,
            shortageAmount: max(0, -spendable),
            currentBalance: state.currentBalance,
            reservedFixedCosts: reserved,
            upcomingFixedCosts: upcoming,
            overdueFixedCosts: overdue,
            overdueCount: overdueItems.count,
            fixedCostItems: items,
            safetyBuffer: state.safetyBuffer,
            daysUntilIncome: income.days,
            incomeDateKnown: income.known,
            nextFixedCostDate: nextFixedCostDate,
            daysUntilNextFixedCost: daysUntilFixedCost,
            riskLevel: level,
            riskLabel: riskLabel,
            riskScore: min(1.0, max(0.0, Double(300_000 - spendable) / 300_000.0)),
            displayAmount: !state.forceHideAmount && syncStatus != .stale,
            syncStatus: syncStatus
        )
    }

    // MARK: - 직접입력 장부

    enum ManualError: LocalizedError {
        case invalidType
        case nonPositiveAmount
        case exceedsBalance

        var errorDescription: String? {
            switch self {
            case .invalidType: return "입금 또는 지출만 기록할 수 있어요."
            case .nonPositiveAmount: return "0원보다 큰 금액을 입력해 주세요."
            case .exceedsBalance: return "현재 잔액보다 큰 지출은 입력할 수 없어요. 빠뜨린 기록이 있다면 ‘은행 잔액과 맞추기’를 이용해 주세요."
            }
        }
    }

    static func manualBalanceAfter(_ currentBalance: Int, type: String, amount: Int) throws -> Int {
        guard type == "income" || type == "expense" else { throw ManualError.invalidType }
        guard amount > 0 else { throw ManualError.nonPositiveAmount }
        let next = currentBalance + (type == "income" ? amount : -amount)
        guard next >= 0 else { throw ManualError.exceedsBalance }
        return next
    }

    // MARK: - 고정비 회차

    static func obligations(_ costs: [FixedCost], today: String) -> [FixedCostObligation] {
        var result: [FixedCostObligation] = []
        var unique = Set<String>()
        for cost in costs {
            let resolved = Set(cost.resolutions.map { $0.period })
            if cost.recurrence == "once" {
                let key = "\(cost.id):\(cost.dueDate)"
                if !resolved.contains(cost.dueDate) && unique.insert(key).inserted {
                    result.append(FixedCostObligation(
                        fixedCostId: cost.id,
                        name: cost.name,
                        amount: cost.amount,
                        period: cost.dueDate,
                        dueDate: cost.dueDate,
                        overdue: cost.dueDate < today
                    ))
                }
                continue
            }
            let seedPeriod = String(cost.dueDate.prefix(7))
            guard let dueDay = Int(cost.dueDate.suffix(2)), monthIndexOrNil(seedPeriod) != nil else { continue }
            let currentPeriod = String(today.prefix(7))
            let currentDue = dateForMonth(currentPeriod, day: dueDay)
            let candidate = currentDue >= today ? currentPeriod : periodFromIndex(monthIndex(currentPeriod) + 1)
            let targetPeriod = max(seedPeriod, candidate)
            let start = monthIndex(seedPeriod)
            let end = monthIndex(targetPeriod)
            guard (0...240).contains(end - start) else { continue }
            for index in start...end {
                let period = periodFromIndex(index)
                let key = "\(cost.id):\(period)"
                if resolved.contains(period) || !unique.insert(key).inserted { continue }
                let dueDate = dateForMonth(period, day: dueDay)
                result.append(FixedCostObligation(
                    fixedCostId: cost.id,
                    name: cost.name,
                    amount: cost.amount,
                    period: period,
                    dueDate: dueDate,
                    overdue: dueDate < today
                ))
            }
        }
        return result.sorted { lhs, rhs in
            if lhs.dueDate != rhs.dueDate { return lhs.dueDate < rhs.dueDate }
            return lhs.name < rhs.name
        }
    }

    static func riskLevel(spendable: Int, reservedFixedCosts: Int, planningDays: Int) -> RiskLevel {
        if spendable < 0 { return .critical }
        if spendable < 50_000 { return .danger }
        let cautionLine = max(100_000, reservedFixedCosts / 4)
        let dailySpendable = planningDays > 0 ? spendable / planningDays : spendable
        if spendable <= cautionLine || (planningDays > 0 && dailySpendable < 20_000) {
            return .caution
        }
        return .safe
    }

    // MARK: - 소득 예상

    private struct IncomeProjection {
        let known: Bool
        let days: Int
    }

    private static func incomeProjection(_ state: MirinaeState, today: String) -> IncomeProjection {
        if state.incomeMode == "irregular" {
            if state.nextIncomeDate.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return IncomeProjection(known: false, days: 0)
            }
            let endOfGrace = addDays(state.nextIncomeDate, state.incomeGraceDays)
            if endOfGrace >= today {
                return IncomeProjection(known: true, days: daysBetween(today, state.nextIncomeDate))
            }
            return IncomeProjection(known: false, days: 0)
        }
        let currentPeriod = String(today.prefix(7))
        let day = min(31, max(1, state.incomeDay))
        let current = dateForMonth(currentPeriod, day: day)
        let next = current >= today ? current : dateForMonth(periodFromIndex(monthIndex(currentPeriod) + 1), day: day)
        return IncomeProjection(known: true, days: daysBetween(today, next))
    }

    /// 매월 소득일(1~31)을 기준으로 오늘 이후 가장 가까운 소득 예상일 (Android MainActivity.nextDateForDay 와 동일)
    static func nextIncomeDate(day: Int, today: String = dateKey(nowMillis())) -> String {
        let value = min(31, max(1, day))
        let currentPeriod = String(today.prefix(7))
        let current = dateForMonth(currentPeriod, day: value)
        if current >= today { return current }
        return dateForMonth(periodFromIndex(monthIndex(currentPeriod) + 1), day: value)
    }

    // MARK: - 날짜 도우미 (전부 한국시간)

    static func dateKey(_ millis: Int) -> String {
        dateKey(Date(timeIntervalSince1970: Double(millis) / 1000))
    }

    static func dateKey(_ date: Date) -> String {
        dayFormatter().string(from: date)
    }

    static func monthIndex(_ period: String) -> Int {
        monthIndexOrNil(period) ?? 0
    }

    private static func monthIndexOrNil(_ period: String) -> Int? {
        let parts = period.split(separator: "-").compactMap { Int($0) }
        guard parts.count >= 2, parts[1] >= 1, parts[1] <= 12 else { return nil }
        return parts[0] * 12 + parts[1] - 1
    }

    static func periodFromIndex(_ value: Int) -> String {
        String(format: "%04d-%02d", value / 12, value % 12 + 1)
    }

    static func dateForMonth(_ period: String, day: Int) -> String {
        let parts = period.split(separator: "-").compactMap { Int($0) }
        guard parts.count >= 2 else { return period }
        var components = DateComponents()
        components.year = parts[0]
        components.month = parts[1]
        components.day = 1
        let cal = calendar
        guard let first = cal.date(from: components),
              let range = cal.range(of: .day, in: .month, for: first) else { return period }
        let value = min(day, range.count)
        return period + "-" + String(format: "%02d", value)
    }

    static func addDays(_ value: String, _ days: Int) -> String {
        guard let date = parseDate(value),
              let shifted = calendar.date(byAdding: .day, value: days, to: date) else { return value }
        return dateKey(shifted)
    }

    /// from → to 일수. 과거면 0. (Kotlin: 밀리초 차이를 86,400,000 으로 정수 나눗셈)
    static func daysBetween(_ from: String, _ to: String) -> Int {
        guard let start = parseDate(from), let end = parseDate(to) else { return 0 }
        let days = Int(end.timeIntervalSince(start) / 86_400)
        return max(0, days)
    }

    /// 엄격한 "yyyy-MM-dd" 파싱 → 한국시간 자정
    static func parseDate(_ value: String) -> Date? {
        guard isDateString(value) else { return nil }
        let formatter = dayFormatter()
        formatter.isLenient = false
        return formatter.date(from: value)
    }

    static func isDateString(_ value: String) -> Bool {
        let pattern = "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
        return value.range(of: pattern, options: .regularExpression) != nil
    }

    /// 다음 한국시간 자정 (위젯 타임라인 갱신 시점)
    static func nextMidnight(after date: Date) -> Date {
        let cal = calendar
        let startOfToday = cal.startOfDay(for: date)
        return cal.date(byAdding: .day, value: 1, to: startOfToday) ?? date.addingTimeInterval(86_400)
    }

    private static func dayFormatter() -> DateFormatter {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = korea
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }
}
