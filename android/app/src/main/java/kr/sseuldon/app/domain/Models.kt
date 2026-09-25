package kr.sseuldon.app.domain

data class FixedCost(
    val id: String,
    val name: String,
    val amount: Long,
    val dueDate: String,
    val recurrence: String = "monthly",
    val resolutions: List<FixedCostResolution> = emptyList(),
    val keywords: List<String> = emptyList(),
    /** 이전 1개월 설정 호환용 */
    val paidAt: Long? = null,
)

data class FixedCostResolution(
    val period: String,
    val status: String,
    val resolvedAt: Long,
)

data class FixedCostObligation(
    val fixedCostId: String,
    val name: String,
    val amount: Long,
    val period: String,
    val dueDate: String,
    val overdue: Boolean,
)

data class ApiSession(
    val apiBaseUrl: String,
    val sessionToken: String,
    val provider: String,
    val bankName: String,
    val maskedAccountNumber: String,
)

data class SseuldonState(
    val currentBalance: Long? = null,
    val balanceMode: String = "none",
    val participantCode: String = "",
    val manualHistory: List<ManualHistoryEntry> = emptyList(),
    val safetyBuffer: Long = 0,
    val nextIncomeDate: String = "",
    val incomeMode: String = "monthly",
    val incomeDay: Int = 25,
    val incomeGraceDays: Int = 3,
    val fixedCosts: List<FixedCost> = emptyList(),
    val syncedAt: Long = System.currentTimeMillis(),
    val lastResult: String = "설정이 필요합니다",
    val syncError: String = "",
    val forceHideAmount: Boolean = false,
)

data class ManualHistoryEntry(
    val at: Long,
    val type: String,
    val balanceAmount: Long? = null,
    val changeAmount: Long? = null,
    val memo: String = "",
    val reservedFixedCosts: Long? = null,
    val safetyBuffer: Long? = null,
    val spendableAmount: Long? = null,
    val fixedCostName: String = "",
    val period: String = "",
)

enum class RiskLevel {
    SAFE,
    CAUTION,
    DANGER,
    CRITICAL,
}

data class SpendableSummary(
    val spendableAmount: Long,
    val shortageAmount: Long,
    val currentBalance: Long?,
    val reservedFixedCosts: Long,
    val upcomingFixedCosts: Long,
    val overdueFixedCosts: Long,
    val overdueCount: Int,
    val fixedCostItems: List<FixedCostObligation>,
    val safetyBuffer: Long,
    val daysUntilIncome: Int,
    val incomeDateKnown: Boolean,
    val nextFixedCostDate: String?,
    val daysUntilNextFixedCost: Int?,
    val riskLevel: RiskLevel,
    val riskLabel: String,
    val riskScore: Double,
    val displayAmount: Boolean,
    val syncStatus: SyncStatus,
)

enum class SyncStatus {
    FRESH,
    DELAYED,
    STALE,
}
