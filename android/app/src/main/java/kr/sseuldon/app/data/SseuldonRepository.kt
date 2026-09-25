package kr.sseuldon.app.data

import android.content.Context
import kr.sseuldon.app.domain.ApiSession
import kr.sseuldon.app.domain.FixedCost
import kr.sseuldon.app.domain.FixedCostResolution
import kr.sseuldon.app.domain.ManualHistoryEntry
import kr.sseuldon.app.domain.SpendableCalculator
import kr.sseuldon.app.domain.SseuldonState
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.UUID

class SseuldonRepository private constructor(context: Context) {
    private val store = EncryptedJsonStore(context.applicationContext)
    private val lock = Any()

    fun state(): SseuldonState = synchronized(lock) {
        store.get(STATE_KEY)?.let(::decodeState) ?: SseuldonState()
    }

    fun startManualMode(participantCode: String, currentBalance: Long): SseuldonState = synchronized(lock) {
        val base = SseuldonState(
            currentBalance = currentBalance.coerceAtLeast(0),
            balanceMode = "manual",
            participantCode = participantCode.trim(),
            syncedAt = System.currentTimeMillis(),
            lastResult = "초기 잔액을 직접 입력했어요",
        )
        val updated = appendManualEvent(
            base,
            "initial_balance",
            changeAmount = base.currentBalance,
            memo = "직접 입력 시작",
        )
        clearApiSession()
        saveState(updated)
        updated
    }

    fun updateManualBalance(currentBalance: Long, memo: String = ""): SseuldonState = synchronized(lock) {
        val old = state()
        require(old.balanceMode == "manual") { "직접 입력 모드가 아니에요." }
        val previous = old.currentBalance ?: 0L
        val base = old.copy(
            currentBalance = currentBalance.coerceAtLeast(0),
            syncedAt = System.currentTimeMillis(),
            lastResult = "현재 잔액을 직접 수정했어요",
            syncError = "",
            forceHideAmount = false,
        )
        val updated = appendManualEvent(
            base,
            "balance_correction",
            changeAmount = currentBalance.coerceAtLeast(0) - previous,
            memo = memo.trim(),
        )
        saveState(updated)
        updated
    }

    fun recordManualTransaction(type: String, amount: Long, memo: String): SseuldonState = synchronized(lock) {
        require(type == "income" || type == "expense") { "입금 또는 지출만 기록할 수 있어요." }
        require(amount > 0) { "0원보다 큰 금액을 입력해 주세요." }
        val old = state()
        require(old.balanceMode == "manual") { "직접 입력 모드가 아니에요." }
        val previous = old.currentBalance ?: throw IllegalStateException("초기 잔액을 먼저 입력해 주세요.")
        val change = if (type == "income") amount else -amount
        val nextBalance = runCatching {
            SpendableCalculator.manualBalanceAfter(previous, type, amount)
        }.getOrElse {
            throw IllegalArgumentException(
                if (type == "expense") {
                    "현재 잔액보다 큰 지출은 입력할 수 없어요. 은행 잔액과 맞추기를 이용해 주세요."
                } else {
                    it.message ?: "금액을 확인해 주세요."
                },
            )
        }
        val base = old.copy(
            currentBalance = nextBalance,
            syncedAt = System.currentTimeMillis(),
            lastResult = if (type == "income") "입금을 직접 반영했어요" else "지출을 직접 반영했어요",
            syncError = "",
            forceHideAmount = false,
        )
        val updated = appendManualEvent(
            base,
            type,
            changeAmount = change,
            memo = memo.trim(),
        )
        saveState(updated)
        updated
    }

    fun updateManualFixedCostStatus(
        fixedCostId: String,
        period: String,
        status: String,
        currentBalance: Long? = null,
    ): SseuldonState = synchronized(lock) {
        val old = state()
        require(old.balanceMode == "manual") { "직접 입력 모드가 아니에요." }
        val target = old.fixedCosts.firstOrNull { it.id == fixedCostId }
            ?: throw IllegalArgumentException("고정비를 찾지 못했어요.")
        val now = System.currentTimeMillis()
        val costs = old.fixedCosts.map { cost ->
            if (cost.id != fixedCostId) return@map cost
            val resolutions = cost.resolutions.filterNot { it.period == period }.toMutableList()
            if (status != "unpaid") resolutions += FixedCostResolution(period, status, now)
            cost.copy(resolutions = resolutions)
        }
        val base = old.copy(
            currentBalance = currentBalance?.coerceAtLeast(0) ?: old.currentBalance,
            fixedCosts = costs,
            syncedAt = if (currentBalance != null) now else old.syncedAt,
            lastResult = when (status) {
                "paid" -> "납부 후 잔액과 납부완료를 반영했어요"
                "waived" -> "이번 고정비 회차를 면제했어요"
                else -> "고정비 회차를 다시 미납으로 바꿨어요"
            },
        )
        val updated = appendManualEvent(
            base,
            "fixed_cost_$status",
            changeAmount = if (currentBalance != null && old.currentBalance != null) {
                currentBalance.coerceAtLeast(0) - old.currentBalance
            } else {
                null
            },
            memo = if (status == "paid") "납부 후 잔액 반영" else "",
            fixedCostName = target.name,
            period = period,
        )
        saveState(updated)
        updated
    }

    fun saveSettings(
        currentBalance: Long,
        safetyBuffer: Long,
        nextIncomeDate: String,
        incomeMode: String,
        incomeDay: Int,
        incomeGraceDays: Int,
        fixedCosts: List<FixedCost>,
    ): SseuldonState = synchronized(lock) {
        val old = state()
        val normalizedBalance = currentBalance.coerceAtLeast(0)
        val balanceChanged = old.currentBalance != normalizedBalance
        val base = old.copy(
            currentBalance = normalizedBalance,
            safetyBuffer = safetyBuffer.coerceAtLeast(0),
            nextIncomeDate = nextIncomeDate,
            incomeMode = incomeMode,
            incomeDay = incomeDay.coerceIn(1, 31),
            incomeGraceDays = incomeGraceDays.coerceIn(0, 7),
            fixedCosts = fixedCosts,
            syncedAt = if (balanceChanged) System.currentTimeMillis() else old.syncedAt,
            lastResult = if (balanceChanged) {
                "은행 앱 잔액을 직접 반영했어요"
            } else {
                "계산 기준을 저장했어요"
            },
            syncError = if (balanceChanged) "" else old.syncError,
        )
        val updated = if (old.balanceMode == "manual") appendManualEvent(base, "budget_update") else base
        saveState(updated)
        updated
    }

    fun budgetPayload(state: SseuldonState): JSONObject = JSONObject()
        .put("nextIncomeDate", state.nextIncomeDate)
        .put("incomeMode", state.incomeMode)
        .put("incomeDay", state.incomeDay)
        .put("incomeGraceDays", state.incomeGraceDays)
        .put("safetyBuffer", state.safetyBuffer)
        .put("fixedCosts", JSONArray(state.fixedCosts.map { cost ->
            JSONObject()
                .put("id", cost.id)
                .put("category", "other")
                .put("name", cost.name)
                .put("amount", cost.amount)
                .put("dueDate", cost.dueDate)
                .put("recurrence", cost.recurrence)
                .put("resolutions", JSONArray(cost.resolutions.map { resolution ->
                    JSONObject()
                        .put("period", resolution.period)
                        .put("status", resolution.status)
                        .put("resolvedAt", formatIso(resolution.resolvedAt))
                }))
        }))

    fun applyApiBudget(payload: JSONObject): SseuldonState = synchronized(lock) {
        val budget = payload.optJSONObject("budget")
            ?: throw IllegalArgumentException("고정비 설정 응답을 확인할 수 없어요.")
        val old = state()
        val costs = budget.optJSONArray("fixedCosts") ?: JSONArray()
        val updated = old.copy(
            safetyBuffer = budget.optLong("safetyBuffer").coerceAtLeast(0),
            nextIncomeDate = budget.optString("nextIncomeDate"),
            incomeMode = budget.optString("incomeMode", "monthly"),
            incomeDay = budget.optInt(
                "incomeDay",
                budget.optString("nextIncomeDate").takeLast(2).toIntOrNull() ?: 25,
            ).coerceIn(1, 31),
            incomeGraceDays = budget.optInt("incomeGraceDays", 3).coerceIn(0, 7),
            fixedCosts = (0 until costs.length())
                .mapNotNull { costs.optJSONObject(it) }
                .map { cost ->
                    val resolutions = cost.optJSONArray("resolutions") ?: JSONArray()
                    FixedCost(
                        id = cost.optString("id", UUID.randomUUID().toString()),
                        name = cost.optString("name", "고정비"),
                        amount = cost.optLong("amount").coerceAtLeast(0),
                        dueDate = cost.optString("dueDate"),
                        recurrence = cost.optString("recurrence", "monthly"),
                        resolutions = (0 until resolutions.length())
                            .mapNotNull { resolutions.optJSONObject(it) }
                            .map { resolution ->
                                FixedCostResolution(
                                    period = resolution.optString("period"),
                                    status = resolution.optString("status", "paid"),
                                    resolvedAt = parseIsoOrNow(resolution.optString("resolvedAt")),
                                )
                            },
                    )
                },
            lastResult = "고정비 설정을 서버와 맞췄어요",
        )
        saveState(updated)
        updated
    }

    fun markSyncError(message: String): SseuldonState = synchronized(lock) {
        val updated = state().copy(
            lastResult = "마지막 잔액을 유지하고 있어요",
            syncError = message,
        )
        saveState(updated)
        updated
    }

    fun applyApiBalance(payload: JSONObject): SseuldonState = synchronized(lock) {
        val old = state()
        val balance = payload.optJSONObject("balance")
            ?: throw IllegalArgumentException("잔액 응답을 확인할 수 없어요.")
        val available = when {
            balance.has("availableAmount") && !balance.isNull("availableAmount") -> balance.getLong("availableAmount")
            balance.has("balanceAmount") && !balance.isNull("balanceAmount") -> balance.getLong("balanceAmount")
            else -> throw IllegalArgumentException("잔액 값이 없어요.")
        }
        val cached = payload.optBoolean("cached", false)
        val updated = old.copy(
            currentBalance = available,
            balanceMode = "automatic",
            syncedAt = parseIsoOrNow(balance.optString("syncedAt")),
            lastResult = if (cached) "마지막 정상 잔액을 유지하고 있어요" else "은행 잔액을 새로 확인했어요",
            syncError = if (cached) payload.optString("warning", "자동 갱신이 지연되고 있어요.") else "",
            forceHideAmount = !payload.optBoolean("displayAmount", true),
        )
        saveState(updated)
        updated
    }

    fun apiSession(): ApiSession? = synchronized(lock) {
        store.get(API_SESSION_KEY)?.let { runCatching { decodeApiSession(it) }.getOrNull() }
    }

    fun saveApiSession(session: ApiSession) = synchronized(lock) {
        store.put(API_SESSION_KEY, JSONObject()
            .put("apiBaseUrl", session.apiBaseUrl)
            .put("sessionToken", session.sessionToken)
            .put("provider", session.provider)
            .put("bankName", session.bankName)
            .put("maskedAccountNumber", session.maskedAccountNumber)
            .toString())
    }

    fun markFirstBalancePending(): SseuldonState = synchronized(lock) {
        val updated = state().copy(
            currentBalance = null,
            balanceMode = "automatic",
            syncedAt = System.currentTimeMillis(),
            lastResult = "계좌 연결 완료 · 첫 잔액 확인 중",
            syncError = "잔액이 확인되기 전에는 금액을 표시하지 않아요.",
            forceHideAmount = true,
        )
        saveState(updated)
        updated
    }

    fun clearApiSession() = synchronized(lock) {
        store.remove(API_SESSION_KEY)
    }

    fun clearAll() = synchronized(lock) {
        store.remove(API_SESSION_KEY)
        store.remove(STATE_KEY)
    }

    private fun appendManualEvent(
        state: SseuldonState,
        type: String,
        changeAmount: Long? = null,
        memo: String = "",
        fixedCostName: String = "",
        period: String = "",
    ): SseuldonState {
        val summary = SpendableCalculator.summary(state)
        val event = ManualHistoryEntry(
            at = System.currentTimeMillis(),
            type = type,
            balanceAmount = state.currentBalance,
            changeAmount = changeAmount,
            memo = memo,
            reservedFixedCosts = summary.reservedFixedCosts,
            safetyBuffer = state.safetyBuffer,
            spendableAmount = summary.spendableAmount,
            fixedCostName = fixedCostName,
            period = period,
        )
        return state.copy(manualHistory = (state.manualHistory + event).takeLast(500))
    }

    private fun saveState(state: SseuldonState) {
        store.put(STATE_KEY, encodeState(state).toString())
    }

    private fun encodeState(state: SseuldonState) = JSONObject()
        .put("currentBalance", state.currentBalance)
        .put("balanceMode", state.balanceMode)
        .put("participantCode", state.participantCode)
        .put("manualHistory", JSONArray(state.manualHistory.map {
            JSONObject()
                .put("at", it.at)
                .put("type", it.type)
                .put("balanceAmount", it.balanceAmount)
                .put("changeAmount", it.changeAmount)
                .put("memo", it.memo)
                .put("reservedFixedCosts", it.reservedFixedCosts)
                .put("safetyBuffer", it.safetyBuffer)
                .put("spendableAmount", it.spendableAmount)
                .put("fixedCostName", it.fixedCostName)
                .put("period", it.period)
        }))
        .put("safetyBuffer", state.safetyBuffer)
        .put("nextIncomeDate", state.nextIncomeDate)
        .put("incomeMode", state.incomeMode)
        .put("incomeDay", state.incomeDay)
        .put("incomeGraceDays", state.incomeGraceDays)
        .put("syncedAt", state.syncedAt)
        .put("lastResult", state.lastResult)
        .put("syncError", state.syncError)
        .put("forceHideAmount", state.forceHideAmount)
        .put("fixedCosts", JSONArray(state.fixedCosts.map {
            JSONObject()
                .put("id", it.id)
                .put("name", it.name)
                .put("amount", it.amount)
                .put("dueDate", it.dueDate)
                .put("recurrence", it.recurrence)
                .put("resolutions", JSONArray(it.resolutions.map { resolution ->
                    JSONObject()
                        .put("period", resolution.period)
                        .put("status", resolution.status)
                        .put("resolvedAt", resolution.resolvedAt)
                }))
                .put("keywords", JSONArray(it.keywords))
                .put("paidAt", it.paidAt)
        }))

    private fun decodeState(value: String): SseuldonState = runCatching {
        val json = JSONObject(value)
        val costs = json.optJSONArray("fixedCosts") ?: JSONArray()
        val history = json.optJSONArray("manualHistory") ?: JSONArray()
        SseuldonState(
            currentBalance = if (json.has("currentBalance") && !json.isNull("currentBalance")) json.optLong("currentBalance") else null,
            balanceMode = json.optString("balanceMode", "none"),
            participantCode = json.optString("participantCode"),
            manualHistory = (0 until history.length()).mapNotNull { history.optJSONObject(it) }.map {
                ManualHistoryEntry(
                    at = it.optLong("at"),
                    type = it.optString("type"),
                    balanceAmount = nullableLong(it, "balanceAmount"),
                    changeAmount = nullableLong(it, "changeAmount"),
                    memo = it.optString("memo"),
                    reservedFixedCosts = nullableLong(it, "reservedFixedCosts"),
                    safetyBuffer = nullableLong(it, "safetyBuffer"),
                    spendableAmount = nullableLong(it, "spendableAmount"),
                    fixedCostName = it.optString("fixedCostName"),
                    period = it.optString("period"),
                )
            },
            safetyBuffer = json.optLong("safetyBuffer"),
            nextIncomeDate = json.optString("nextIncomeDate"),
            incomeMode = json.optString("incomeMode", "monthly"),
            incomeDay = json.optInt(
                "incomeDay",
                json.optString("nextIncomeDate").takeLast(2).toIntOrNull() ?: 25,
            ).coerceIn(1, 31),
            incomeGraceDays = json.optInt("incomeGraceDays", 3).coerceIn(0, 7),
            fixedCosts = (0 until costs.length()).mapNotNull { costs.optJSONObject(it) }.map {
                val keywords = it.optJSONArray("keywords") ?: JSONArray()
                val resolutions = it.optJSONArray("resolutions") ?: JSONArray()
                FixedCost(
                    id = it.optString("id", UUID.randomUUID().toString()),
                    name = it.optString("name", "고정비"),
                    amount = it.optLong("amount").coerceAtLeast(0),
                    dueDate = it.optString("dueDate"),
                    recurrence = it.optString("recurrence", "monthly"),
                    resolutions = (0 until resolutions.length())
                        .mapNotNull { resolutions.optJSONObject(it) }
                        .map { resolution ->
                            FixedCostResolution(
                                period = resolution.optString("period"),
                                status = resolution.optString("status", "paid"),
                                resolvedAt = resolution.optLong("resolvedAt"),
                            )
                        },
                    keywords = (0 until keywords.length()).map(keywords::optString).filter(String::isNotBlank),
                    paidAt = if (it.has("paidAt") && !it.isNull("paidAt")) it.optLong("paidAt") else null,
                )
            },
            syncedAt = json.optLong("syncedAt", System.currentTimeMillis()),
            lastResult = json.optString("lastResult", "설정이 필요합니다"),
            syncError = json.optString("syncError"),
            forceHideAmount = json.optBoolean("forceHideAmount", false),
        )
    }.getOrElse { SseuldonState() }

    private fun nullableLong(json: JSONObject, key: String): Long? =
        if (json.has(key) && !json.isNull(key)) json.optLong(key) else null

    private fun decodeApiSession(value: String): ApiSession = JSONObject(value).let {
        ApiSession(
            apiBaseUrl = it.getString("apiBaseUrl"),
            sessionToken = it.getString("sessionToken"),
            provider = it.getString("provider"),
            bankName = it.optString("bankName", "연결 은행"),
            maskedAccountNumber = it.optString("maskedAccountNumber"),
        )
    }

    private fun parseIsoOrNow(value: String): Long {
        if (value.isBlank()) return System.currentTimeMillis()
        val patterns = listOf("yyyy-MM-dd'T'HH:mm:ss.SSSX", "yyyy-MM-dd'T'HH:mm:ssX")
        return patterns.firstNotNullOfOrNull { pattern ->
            runCatching {
                SimpleDateFormat(pattern, Locale.US).apply { isLenient = false }.parse(value)?.time
            }.getOrNull()
        } ?: System.currentTimeMillis()
    }

    private fun formatIso(value: Long): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = java.util.TimeZone.getTimeZone("UTC")
        }.format(java.util.Date(value))

    companion object {
        private const val STATE_KEY = "state"
        private const val API_SESSION_KEY = "api-session-v1"

        @Volatile
        private var instance: SseuldonRepository? = null

        fun get(context: Context): SseuldonRepository = instance ?: synchronized(this) {
            instance ?: SseuldonRepository(context.applicationContext).also { instance = it }
        }
    }
}
