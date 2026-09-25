package kr.sseuldon.app.domain

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

object SpendableCalculator {
    private val korea = TimeZone.getTimeZone("Asia/Seoul")

    fun summary(state: SseuldonState, nowMillis: Long = System.currentTimeMillis()): SpendableSummary {
        val today = dateKey(nowMillis)
        val items = obligations(state.fixedCosts, today)
        val overdueItems = items.filter { it.overdue }
        val upcomingItems = items.filterNot { it.overdue }
        val overdue = overdueItems.sumOf { it.amount.coerceAtLeast(0) }
        val upcoming = upcomingItems.sumOf { it.amount.coerceAtLeast(0) }
        val reserved = overdue + upcoming
        val spendable = (state.currentBalance ?: 0L) -
            reserved -
            state.safetyBuffer.coerceAtLeast(0)
        val income = incomeProjection(state, today)
        val nextFixedCostDate = upcomingItems.minByOrNull { it.dueDate }?.dueDate
        val daysUntilFixedCost = nextFixedCostDate?.let { daysBetween(today, it) }
        val planningDays = if (income.known && income.days > 0) income.days else daysUntilFixedCost ?: 0
        val level = riskLevel(spendable, reserved, planningDays)
        val age = (nowMillis - state.syncedAt).coerceAtLeast(0)
        val syncStatus = when {
            state.balanceMode == "manual" -> SyncStatus.FRESH
            age > 24 * 60 * 60 * 1_000L -> SyncStatus.STALE
            age > 60 * 60 * 1_000L || state.syncError.isNotBlank() -> SyncStatus.DELAYED
            else -> SyncStatus.FRESH
        }
        return SpendableSummary(
            spendableAmount = spendable,
            shortageAmount = (-spendable).coerceAtLeast(0),
            currentBalance = state.currentBalance,
            reservedFixedCosts = reserved,
            upcomingFixedCosts = upcoming,
            overdueFixedCosts = overdue,
            overdueCount = overdueItems.size,
            fixedCostItems = items,
            safetyBuffer = state.safetyBuffer,
            daysUntilIncome = income.days,
            incomeDateKnown = income.known,
            nextFixedCostDate = nextFixedCostDate,
            daysUntilNextFixedCost = daysUntilFixedCost,
            riskLevel = level,
            riskLabel = when (level) {
                RiskLevel.SAFE -> "안전"
                RiskLevel.CAUTION -> "조금 아껴 써요"
                RiskLevel.DANGER -> "고정비에 가까워요"
                RiskLevel.CRITICAL -> "고정비가 부족해요"
            },
            riskScore = ((300_000L - spendable).toDouble() / 300_000.0).coerceIn(0.0, 1.0),
            displayAmount = !state.forceHideAmount && syncStatus != SyncStatus.STALE,
            syncStatus = syncStatus,
        )
    }

    fun manualBalanceAfter(currentBalance: Long, type: String, amount: Long): Long {
        require(type == "income" || type == "expense") { "입금 또는 지출만 기록할 수 있어요." }
        require(amount > 0) { "0원보다 큰 금액을 입력해 주세요." }
        val next = currentBalance + if (type == "income") amount else -amount
        require(next >= 0) { "현재 잔액보다 큰 지출은 입력할 수 없어요." }
        return next
    }

    fun obligations(costs: List<FixedCost>, today: String): List<FixedCostObligation> {
        val result = mutableListOf<FixedCostObligation>()
        val unique = mutableSetOf<String>()
        costs.forEach { cost ->
            val resolved = cost.resolutions.associateBy { it.period }.toMutableMap()
            if (cost.paidAt != null) {
                val period = if (cost.recurrence == "once") cost.dueDate else cost.dueDate.take(7)
                if (!resolved.containsKey(period)) {
                    resolved[period] = FixedCostResolution(period, "paid", cost.paidAt)
                }
            }
            if (cost.recurrence == "once") {
                val key = "${cost.id}:${cost.dueDate}"
                if (!resolved.containsKey(cost.dueDate) && unique.add(key)) {
                    result += FixedCostObligation(
                        cost.id, cost.name, cost.amount, cost.dueDate,
                        cost.dueDate, cost.dueDate < today,
                    )
                }
                return@forEach
            }
            val seedPeriod = cost.dueDate.take(7)
            val dueDay = cost.dueDate.takeLast(2).toIntOrNull() ?: return@forEach
            val currentPeriod = today.take(7)
            val currentDue = dateForMonth(currentPeriod, dueDay)
            val targetPeriod = maxOf(
                seedPeriod,
                if (currentDue >= today) currentPeriod else periodFromIndex(monthIndex(currentPeriod) + 1),
            )
            val start = monthIndex(seedPeriod)
            val end = monthIndex(targetPeriod)
            if (end - start !in 0..240) return@forEach
            for (index in start..end) {
                val period = periodFromIndex(index)
                val key = "${cost.id}:$period"
                if (resolved.containsKey(period) || !unique.add(key)) continue
                val dueDate = dateForMonth(period, dueDay)
                result += FixedCostObligation(
                    cost.id, cost.name, cost.amount, period, dueDate, dueDate < today,
                )
            }
        }
        return result.sortedWith(compareBy<FixedCostObligation> { it.dueDate }.thenBy { it.name })
    }

    fun riskLevel(spendable: Long, reservedFixedCosts: Long, planningDays: Int): RiskLevel {
        if (spendable < 0) return RiskLevel.CRITICAL
        if (spendable < 50_000L) return RiskLevel.DANGER
        val cautionLine = maxOf(100_000L, reservedFixedCosts / 4)
        val dailySpendable = if (planningDays > 0) spendable / planningDays else spendable
        if (spendable <= cautionLine || (planningDays > 0 && dailySpendable < 20_000L)) {
            return RiskLevel.CAUTION
        }
        return RiskLevel.SAFE
    }

    private data class IncomeProjection(val known: Boolean, val days: Int)

    private fun incomeProjection(state: SseuldonState, today: String): IncomeProjection {
        if (state.incomeMode == "irregular") {
            if (state.nextIncomeDate.isBlank()) return IncomeProjection(false, 0)
            val endOfGrace = addDays(state.nextIncomeDate, state.incomeGraceDays)
            return if (endOfGrace >= today) {
                IncomeProjection(true, daysBetween(today, state.nextIncomeDate))
            } else {
                IncomeProjection(false, 0)
            }
        }
        val currentPeriod = today.take(7)
        val current = dateForMonth(currentPeriod, state.incomeDay.coerceIn(1, 31))
        val next = if (current >= today) {
            current
        } else {
            dateForMonth(periodFromIndex(monthIndex(currentPeriod) + 1), state.incomeDay.coerceIn(1, 31))
        }
        return IncomeProjection(true, daysBetween(today, next))
    }

    private fun dateKey(value: Long): String =
        SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = korea }.format(Date(value))

    private fun monthIndex(period: String): Int {
        val parts = period.split("-")
        return parts[0].toInt() * 12 + parts[1].toInt() - 1
    }

    private fun periodFromIndex(value: Int): String =
        "%04d-%02d".format(Locale.US, value / 12, value % 12 + 1)

    private fun dateForMonth(period: String, day: Int): String {
        val parts = period.split("-")
        val calendar = Calendar.getInstance(korea).apply {
            clear()
            set(Calendar.YEAR, parts[0].toInt())
            set(Calendar.MONTH, parts[1].toInt() - 1)
            set(Calendar.DAY_OF_MONTH, 1)
        }
        val value = day.coerceAtMost(calendar.getActualMaximum(Calendar.DAY_OF_MONTH))
        return "$period-${"%02d".format(Locale.US, value)}"
    }

    private fun addDays(value: String, days: Int): String {
        val calendar = parseDate(value) ?: return value
        calendar.add(Calendar.DAY_OF_MONTH, days)
        return SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = korea }.format(calendar.time)
    }

    private fun daysBetween(from: String, to: String): Int {
        val start = parseDate(from) ?: return 0
        val end = parseDate(to) ?: return 0
        return ((end.timeInMillis - start.timeInMillis) / 86_400_000L).toInt().coerceAtLeast(0)
    }

    private fun parseDate(value: String): Calendar? {
        val parser = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply {
            isLenient = false
            timeZone = korea
        }
        val parsed = runCatching { parser.parse(value) }.getOrNull() ?: return null
        return Calendar.getInstance(korea).apply {
            time = parsed
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
    }
}
