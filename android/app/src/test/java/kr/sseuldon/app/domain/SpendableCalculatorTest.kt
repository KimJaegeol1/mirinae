package kr.sseuldon.app.domain

import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class SpendableCalculatorTest {
    private fun atKoreaNoon(date: String): Long =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssX", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.parse("${date}T03:00:00Z")!!.time

    private fun configured(now: Long, overrides: (SseuldonState) -> SseuldonState = { it }) =
        overrides(
            SseuldonState(
                currentBalance = 1_243_000,
                safetyBuffer = 100_000,
                nextIncomeDate = "2026-08-25",
                incomeMode = "monthly",
                incomeDay = 25,
                incomeGraceDays = 3,
                fixedCosts = listOf(
                    FixedCost(
                        id = "rent",
                        name = "월세",
                        amount = 500_000,
                        dueDate = "2026-08-05",
                        recurrence = "monthly",
                    ),
                ),
                syncedAt = now,
            ),
        )

    @Test
    fun `납부일 전에는 이번 회차만 차감한다`() {
        val now = atKoreaNoon("2026-08-04")
        val summary = SpendableCalculator.summary(configured(now), now)
        assertEquals(500_000L, summary.upcomingFixedCosts)
        assertEquals(0L, summary.overdueFixedCosts)
        assertEquals(643_000L, summary.spendableAmount)
        assertEquals("2026-08", summary.fixedCostItems.single().period)
    }

    @Test
    fun `납부일 다음 날 미납이면 두 회차를 함께 차감한다`() {
        val now = atKoreaNoon("2026-08-06")
        val summary = SpendableCalculator.summary(configured(now), now)
        assertEquals(500_000L, summary.overdueFixedCosts)
        assertEquals(500_000L, summary.upcomingFixedCosts)
        assertEquals(1_000_000L, summary.reservedFixedCosts)
        assertEquals(143_000L, summary.spendableAmount)
        assertEquals(1, summary.overdueCount)
    }

    @Test
    fun `지난 회차 납부 후에는 다음 회차만 차감한다`() {
        val now = atKoreaNoon("2026-08-06")
        val state = configured(now) {
            it.copy(
                currentBalance = 743_000,
                fixedCosts = it.fixedCosts.map { cost ->
                    cost.copy(
                        resolutions = listOf(
                            FixedCostResolution("2026-08", "paid", now),
                        ),
                    )
                },
            )
        }
        val summary = SpendableCalculator.summary(state, now)
        assertEquals(0L, summary.overdueFixedCosts)
        assertEquals(500_000L, summary.upcomingFixedCosts)
        assertEquals(143_000L, summary.spendableAmount)
    }

    @Test
    fun `3개월을 넘겨 미납하면 지난 회차와 다음 회차를 모두 보호한다`() {
        val now = atKoreaNoon("2026-10-06")
        val summary = SpendableCalculator.summary(configured(now) {
            it.copy(currentBalance = 3_000_000)
        }, now)
        assertEquals(
            listOf("2026-08", "2026-09", "2026-10", "2026-11"),
            summary.fixedCostItems.map { it.period },
        )
        assertEquals(3, summary.overdueCount)
        assertEquals(1_500_000L, summary.overdueFixedCosts)
        assertEquals(500_000L, summary.upcomingFixedCosts)
        assertEquals(900_000L, summary.spendableAmount)
    }

    @Test
    fun `31일 납부일은 짧은 달의 마지막 날로 보정한다`() {
        val now = atKoreaNoon("2027-02-28")
        val state = configured(now) {
            it.copy(
                fixedCosts = listOf(
                    FixedCost(
                        id = "rent",
                        name = "월세",
                        amount = 500_000,
                        dueDate = "2027-01-31",
                        recurrence = "monthly",
                        resolutions = listOf(
                            FixedCostResolution("2027-01", "paid", atKoreaNoon("2027-01-31")),
                        ),
                    ),
                ),
            )
        }
        val item = SpendableCalculator.summary(state, now).fixedCostItems.single()
        assertEquals("2027-02", item.period)
        assertEquals("2027-02-28", item.dueDate)
        assertEquals(false, item.overdue)
    }

    @Test
    fun `연도가 바뀌어도 다음 회차를 생성한다`() {
        val now = atKoreaNoon("2026-12-06")
        val state = configured(now) {
            it.copy(fixedCosts = it.fixedCosts.map { cost -> cost.copy(dueDate = "2026-12-05") })
        }
        assertEquals(
            listOf("2026-12", "2027-01"),
            SpendableCalculator.summary(state, now).fixedCostItems.map { it.period },
        )
    }

    @Test
    fun `불규칙 소득일이 유예범위를 지나면 미정이다`() {
        val now = atKoreaNoon("2026-08-30")
        val summary = SpendableCalculator.summary(configured(now) {
            it.copy(incomeMode = "irregular", nextIncomeDate = "2026-08-25")
        }, now)
        assertEquals(false, summary.incomeDateKnown)
        assertEquals(0, summary.daysUntilIncome)
    }

    @Test
    fun `오래된 잔액은 금액을 숨긴다`() {
        val now = atKoreaNoon("2026-08-04")
        val summary = SpendableCalculator.summary(configured(now) {
            it.copy(syncedAt = now - 25 * 60 * 60 * 1_000L)
        }, now)
        assertEquals(SyncStatus.STALE, summary.syncStatus)
        assertEquals(false, summary.displayAmount)
        assertEquals(1_243_000L, summary.currentBalance)
    }

    @Test
    fun `1시간 넘게 갱신되지 않은 잔액은 지연으로 표시한다`() {
        val now = atKoreaNoon("2026-08-04")
        val summary = SpendableCalculator.summary(configured(now) {
            it.copy(syncedAt = now - 61 * 60 * 1_000L)
        }, now)
        assertEquals(SyncStatus.DELAYED, summary.syncStatus)
        assertEquals(true, summary.displayAmount)
    }

    @Test
    fun `직접 입력 잔액은 오래되어도 자동조회 실패로 숨기지 않는다`() {
        val now = atKoreaNoon("2026-08-04")
        val summary = SpendableCalculator.summary(configured(now) {
            it.copy(
                balanceMode = "manual",
                syncedAt = now - 40 * 24 * 60 * 60 * 1_000L,
            )
        }, now)
        assertEquals(SyncStatus.FRESH, summary.syncStatus)
        assertEquals(true, summary.displayAmount)
    }

    @Test
    fun `수동 입금은 현재 잔액에 더한다`() {
        assertEquals(350_000L, SpendableCalculator.manualBalanceAfter(300_000L, "income", 50_000L))
    }

    @Test
    fun `수동 지출은 현재 잔액에서 뺀다`() {
        assertEquals(250_000L, SpendableCalculator.manualBalanceAfter(300_000L, "expense", 50_000L))
    }

    @Test
    fun `현재 잔액보다 큰 수동 지출은 막는다`() {
        assertThrows(IllegalArgumentException::class.java) {
            SpendableCalculator.manualBalanceAfter(30_000L, "expense", 50_000L)
        }
    }
}
