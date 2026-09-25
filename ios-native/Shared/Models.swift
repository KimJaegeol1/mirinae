import Foundation

// Android `domain/Models.kt` 를 그대로 옮긴 모델.
// 앱과 위젯 익스텐션이 함께 쓰므로 Foundation 만 사용한다.

enum RiskLevel: String, Codable {
    case safe
    case caution
    case danger
    case critical
}

enum SyncStatus: String, Codable {
    case fresh
    case delayed
    case stale
}

/// 고정비 한 회차의 처리 결과. period 는 매월 반복이면 "yyyy-MM", 한 번만 납부면 납부일 "yyyy-MM-dd".
struct FixedCostResolution: Codable, Equatable, Hashable {
    var period: String
    var status: String      // "paid" | "waived"
    var resolvedAt: Int     // epoch ms

    init(period: String, status: String, resolvedAt: Int) {
        self.period = period
        self.status = status
        self.resolvedAt = resolvedAt
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        period = try values.decodeIfPresent(String.self, forKey: .period) ?? ""
        status = try values.decodeIfPresent(String.self, forKey: .status) ?? "paid"
        resolvedAt = try values.decodeIfPresent(Int.self, forKey: .resolvedAt) ?? 0
    }
}

struct FixedCost: Codable, Equatable, Hashable, Identifiable {
    var id: String
    var name: String
    var amount: Int
    var dueDate: String         // "yyyy-MM-dd". 매월 반복이면 첫 납부일(회차 시작점)
    var recurrence: String      // "monthly" | "once"
    var resolutions: [FixedCostResolution]

    init(
        id: String = UUID().uuidString,
        name: String,
        amount: Int,
        dueDate: String,
        recurrence: String = "monthly",
        resolutions: [FixedCostResolution] = []
    ) {
        self.id = id
        self.name = name
        self.amount = amount
        self.dueDate = dueDate
        self.recurrence = recurrence
        self.resolutions = resolutions
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        name = try values.decodeIfPresent(String.self, forKey: .name) ?? ""
        amount = try values.decodeIfPresent(Int.self, forKey: .amount) ?? 0
        dueDate = try values.decodeIfPresent(String.self, forKey: .dueDate) ?? ""
        recurrence = try values.decodeIfPresent(String.self, forKey: .recurrence) ?? "monthly"
        resolutions = try values.decodeIfPresent([FixedCostResolution].self, forKey: .resolutions) ?? []
    }
}

/// 계산 시점에 만들어지는 "남겨둘 고정비 회차" 한 건.
struct FixedCostObligation: Equatable, Hashable, Identifiable {
    var fixedCostId: String
    var name: String
    var amount: Int
    var period: String
    var dueDate: String
    var overdue: Bool

    var id: String { "\(fixedCostId):\(period)" }
}

struct ManualHistoryEntry: Codable, Equatable, Identifiable {
    var id: String
    var at: Int                 // epoch ms
    var type: String            // initial_balance | income | expense | balance_correction | budget_update | fixed_cost_paid | fixed_cost_waived | fixed_cost_unpaid
    var balanceAmount: Int?
    var changeAmount: Int?
    var memo: String
    var reservedFixedCosts: Int?
    var safetyBuffer: Int?
    var spendableAmount: Int?
    var fixedCostName: String
    var period: String

    init(
        id: String = UUID().uuidString,
        at: Int,
        type: String,
        balanceAmount: Int? = nil,
        changeAmount: Int? = nil,
        memo: String = "",
        reservedFixedCosts: Int? = nil,
        safetyBuffer: Int? = nil,
        spendableAmount: Int? = nil,
        fixedCostName: String = "",
        period: String = ""
    ) {
        self.id = id
        self.at = at
        self.type = type
        self.balanceAmount = balanceAmount
        self.changeAmount = changeAmount
        self.memo = memo
        self.reservedFixedCosts = reservedFixedCosts
        self.safetyBuffer = safetyBuffer
        self.spendableAmount = spendableAmount
        self.fixedCostName = fixedCostName
        self.period = period
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        at = try values.decodeIfPresent(Int.self, forKey: .at) ?? 0
        type = try values.decodeIfPresent(String.self, forKey: .type) ?? ""
        balanceAmount = try values.decodeIfPresent(Int.self, forKey: .balanceAmount)
        changeAmount = try values.decodeIfPresent(Int.self, forKey: .changeAmount)
        memo = try values.decodeIfPresent(String.self, forKey: .memo) ?? ""
        reservedFixedCosts = try values.decodeIfPresent(Int.self, forKey: .reservedFixedCosts)
        safetyBuffer = try values.decodeIfPresent(Int.self, forKey: .safetyBuffer)
        spendableAmount = try values.decodeIfPresent(Int.self, forKey: .spendableAmount)
        fixedCostName = try values.decodeIfPresent(String.self, forKey: .fixedCostName) ?? ""
        period = try values.decodeIfPresent(String.self, forKey: .period) ?? ""
    }

    var typeLabel: String {
        switch type {
        case "initial_balance": return "초기 잔액"
        case "income": return "입금"
        case "expense": return "지출"
        case "balance_correction": return "잔액 맞춤"
        case "budget_update": return "고정비 설정"
        case "fixed_cost_paid": return "고정비 납부"
        case "fixed_cost_waived": return "고정비 면제"
        case "fixed_cost_unpaid": return "미납 되돌림"
        default: return type
        }
    }
}

/// Android `SseuldonState` 에 해당. 이 앱은 직접입력(manual) 모드만 쓰지만
/// 계산기가 Android 와 완전히 같도록 balanceMode·syncError 등 필드를 그대로 둔다.
struct MirinaeState: Codable, Equatable {
    var currentBalance: Int?
    var balanceMode: String         // "none" | "manual"
    var participantCode: String
    var manualHistory: [ManualHistoryEntry]
    var safetyBuffer: Int
    var nextIncomeDate: String      // monthly 면 다음 소득 예상일, irregular 면 예상일 또는 "2000-01-01"(미정)
    var incomeMode: String          // "monthly" | "irregular"
    var incomeDay: Int
    var incomeGraceDays: Int
    var fixedCosts: [FixedCost]
    var syncedAt: Int               // epoch ms
    var lastResult: String
    var syncError: String
    var forceHideAmount: Bool

    init(
        currentBalance: Int? = nil,
        balanceMode: String = "none",
        participantCode: String = "",
        manualHistory: [ManualHistoryEntry] = [],
        safetyBuffer: Int = 0,
        nextIncomeDate: String = "",
        incomeMode: String = "monthly",
        incomeDay: Int = 25,
        incomeGraceDays: Int = 3,
        fixedCosts: [FixedCost] = [],
        syncedAt: Int = Int(Date().timeIntervalSince1970 * 1000),
        lastResult: String = "설정이 필요합니다",
        syncError: String = "",
        forceHideAmount: Bool = false
    ) {
        self.currentBalance = currentBalance
        self.balanceMode = balanceMode
        self.participantCode = participantCode
        self.manualHistory = manualHistory
        self.safetyBuffer = safetyBuffer
        self.nextIncomeDate = nextIncomeDate
        self.incomeMode = incomeMode
        self.incomeDay = incomeDay
        self.incomeGraceDays = incomeGraceDays
        self.fixedCosts = fixedCosts
        self.syncedAt = syncedAt
        self.lastResult = lastResult
        self.syncError = syncError
        self.forceHideAmount = forceHideAmount
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        currentBalance = try values.decodeIfPresent(Int.self, forKey: .currentBalance)
        balanceMode = try values.decodeIfPresent(String.self, forKey: .balanceMode) ?? "none"
        participantCode = try values.decodeIfPresent(String.self, forKey: .participantCode) ?? ""
        manualHistory = try values.decodeIfPresent([ManualHistoryEntry].self, forKey: .manualHistory) ?? []
        safetyBuffer = try values.decodeIfPresent(Int.self, forKey: .safetyBuffer) ?? 0
        nextIncomeDate = try values.decodeIfPresent(String.self, forKey: .nextIncomeDate) ?? ""
        incomeMode = try values.decodeIfPresent(String.self, forKey: .incomeMode) ?? "monthly"
        incomeDay = try values.decodeIfPresent(Int.self, forKey: .incomeDay) ?? 25
        incomeGraceDays = try values.decodeIfPresent(Int.self, forKey: .incomeGraceDays) ?? 3
        fixedCosts = try values.decodeIfPresent([FixedCost].self, forKey: .fixedCosts) ?? []
        syncedAt = try values.decodeIfPresent(Int.self, forKey: .syncedAt) ?? Int(Date().timeIntervalSince1970 * 1000)
        lastResult = try values.decodeIfPresent(String.self, forKey: .lastResult) ?? "설정이 필요합니다"
        syncError = try values.decodeIfPresent(String.self, forKey: .syncError) ?? ""
        forceHideAmount = try values.decodeIfPresent(Bool.self, forKey: .forceHideAmount) ?? false
    }

    var isManual: Bool { balanceMode == "manual" }
}

/// Android `SpendableSummary` 와 같은 필드.
struct SpendableSummary: Equatable {
    var spendableAmount: Int
    var shortageAmount: Int
    var currentBalance: Int?
    var reservedFixedCosts: Int
    var upcomingFixedCosts: Int
    var overdueFixedCosts: Int
    var overdueCount: Int
    var fixedCostItems: [FixedCostObligation]
    var safetyBuffer: Int
    var daysUntilIncome: Int
    var incomeDateKnown: Bool
    var nextFixedCostDate: String?
    var daysUntilNextFixedCost: Int?
    var riskLevel: RiskLevel
    var riskLabel: String
    var riskScore: Double
    var displayAmount: Bool
    var syncStatus: SyncStatus

    var firstOverdue: FixedCostObligation? { fixedCostItems.first { $0.overdue } }

    /// 위젯·앱 카드에 쓰는 문구 (Android 위젯과 동일)
    var fixedCostDayText: String {
        guard let days = daysUntilNextFixedCost else { return "예정 고정비 없음" }
        return days == 0 ? "고정비 납부일" : "다음 고정비 D-\(days)"
    }

    var incomeDayText: String {
        guard incomeDateKnown else { return "소득일 미정" }
        return daysUntilIncome == 0 ? "소득 예상일" : "소득 예상 D-\(daysUntilIncome)"
    }

    /// 큰 숫자 자리에 들어가는 문구
    var amountText: String {
        if currentBalance == nil { return "설정 필요" }
        if !displayAmount { return "잔액 확인 필요" }
        if spendableAmount < 0 { return "\(MirinaeFormat.won(shortageAmount))원 부족" }
        return "\(MirinaeFormat.won(spendableAmount))원"
    }

    /// 게이지 10칸 중 채울 칸 수 (Scriptable 위젯과 동일)
    var gaugeValue: Int {
        guard currentBalance != nil, displayAmount else { return 0 }
        let remaining = 1.0 - min(1.0, max(0.0, riskScore))
        return max(1, Int((remaining * 10).rounded()))
    }
}
