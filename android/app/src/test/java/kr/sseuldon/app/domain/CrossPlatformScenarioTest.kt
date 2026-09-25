package kr.sseuldon.app.domain

import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Android SpendableCalculator ↔ iPhone Scriptable manualSummary() 교차 검증.
 *
 * verify/scenarios.json 의 12개 시나리오를 그대로 옮긴 것이다. 기대값(expected)은
 * Scriptable 쪽 `node verify/scriptable-scenarios.mjs` 출력과 글자 단위로 같아야 한다.
 * 계산식·임계값을 한쪽에서 고쳤다면 반대쪽도 고친 뒤 양쪽 기대값을 함께 갱신한다.
 */
class CrossPlatformScenarioTest {
    private fun koreaNoon(date: String): Long =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssX", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.parse("${date}T03:00:00Z")!!.time

    private fun line(name: String, r: SpendableSummary): String = listOf(
        name, r.spendableAmount, r.shortageAmount, r.reservedFixedCosts, r.upcomingFixedCosts, r.overdueFixedCosts,
        r.overdueCount, r.daysUntilIncome, r.incomeDateKnown, r.nextFixedCostDate ?: "-", r.daysUntilNextFixedCost ?: "-",
        r.riskLevel.name.lowercase(), "%.4f".format(Locale.US, r.riskScore),
        r.fixedCostItems.joinToString(";") { "${it.period}:${it.dueDate}:${if (it.overdue) "overdue" else "upcoming"}" },
    ).joinToString("|")

    private fun check(name: String, today: String, state: SseuldonState, expected: String) {
        val now = koreaNoon(today)
        assertEquals(expected, line(name, SpendableCalculator.summary(state.copy(syncedAt = now), now)))
    }

    @Test
    fun `납부일전`() = check(
        "01_납부일전", "2026-08-04",
        SseuldonState(
            currentBalance = 1243000L, balanceMode = "manual", safetyBuffer = 100000L,
            nextIncomeDate = "2026-08-25", incomeMode = "monthly", incomeDay = 25, incomeGraceDays = 3,
            fixedCosts = listOf(
                FixedCost(id="rent", name="월세", amount=500000L, dueDate="2026-08-05", recurrence="monthly")
            ),
        ),
        "01_납부일전|643000|0|500000|500000|0|0|21|true|2026-08-05|1|safe|0.0000|2026-08:2026-08-05:upcoming",
    )

    @Test
    fun `납부일다음날_미납`() = check(
        "02_납부일다음날_미납", "2026-08-06",
        SseuldonState(
            currentBalance = 1243000L, balanceMode = "manual", safetyBuffer = 100000L,
            nextIncomeDate = "2026-08-25", incomeMode = "monthly", incomeDay = 25, incomeGraceDays = 3,
            fixedCosts = listOf(
                FixedCost(id="rent", name="월세", amount=500000L, dueDate="2026-08-05", recurrence="monthly")
            ),
        ),
        "02_납부일다음날_미납|143000|0|1000000|500000|500000|1|19|true|2026-09-05|30|caution|0.5233|2026-08:2026-08-05:overdue;2026-09:2026-09-05:upcoming",
    )

    @Test
    fun `이번회차_납부완료`() = check(
        "03_이번회차_납부완료", "2026-08-06",
        SseuldonState(
            currentBalance = 1243000L, balanceMode = "manual", safetyBuffer = 100000L,
            nextIncomeDate = "2026-08-25", incomeMode = "monthly", incomeDay = 25, incomeGraceDays = 3,
            fixedCosts = listOf(
                FixedCost(id="rent", name="월세", amount=500000L, dueDate="2026-08-05", recurrence="monthly", resolutions=listOf(FixedCostResolution("2026-08", "paid", 1754000000000L)))
            ),
        ),
        "03_이번회차_납부완료|643000|0|500000|500000|0|0|19|true|2026-09-05|30|safe|0.0000|2026-09:2026-09-05:upcoming",
    )

    @Test
    fun `오늘_부족_복합`() = check(
        "04_오늘_부족_복합", "2026-09-13",
        SseuldonState(
            currentBalance = 400000L, balanceMode = "manual", safetyBuffer = 50000L,
            nextIncomeDate = "2026-09-20", incomeMode = "irregular", incomeDay = 25, incomeGraceDays = 3,
            fixedCosts = listOf(
                FixedCost(id="tel", name="통신비", amount=55000L, dueDate="2026-09-15", recurrence="monthly"),
                FixedCost(id="rent", name="월세", amount=300000L, dueDate="2026-09-25", recurrence="monthly"),
                FixedCost(id="ott", name="넷플릭스", amount=17000L, dueDate="2026-09-10", recurrence="once")
            ),
        ),
        "04_오늘_부족_복합|-22000|22000|372000|355000|17000|1|7|true|2026-09-15|2|critical|1.0000|2026-09-10:2026-09-10:overdue;2026-09:2026-09-15:upcoming;2026-09:2026-09-25:upcoming",
    )

    @Test
    fun `경계_5만원_정확히`() = check(
        "05_경계_5만원_정확히", "2026-09-13",
        SseuldonState(
            currentBalance = 150000L, balanceMode = "manual", safetyBuffer = 0L,
            nextIncomeDate = "2026-09-25", incomeMode = "monthly", incomeDay = 25, incomeGraceDays = 3,
            fixedCosts = listOf(
                FixedCost(id="a", name="관리비", amount=100000L, dueDate="2026-09-20", recurrence="monthly")
            ),
        ),
        "05_경계_5만원_정확히|50000|0|100000|100000|0|0|12|true|2026-09-20|7|caution|0.8333|2026-09:2026-09-20:upcoming",
    )

    @Test
    fun `경계_49999`() = check(
        "06_경계_49999", "2026-09-13",
        SseuldonState(
            currentBalance = 149999L, balanceMode = "manual", safetyBuffer = 0L,
            nextIncomeDate = "2026-09-25", incomeMode = "monthly", incomeDay = 25, incomeGraceDays = 3,
            fixedCosts = listOf(
                FixedCost(id="a", name="관리비", amount=100000L, dueDate="2026-09-20", recurrence="monthly")
            ),
        ),
        "06_경계_49999|49999|0|100000|100000|0|0|12|true|2026-09-20|7|danger|0.8333|2026-09:2026-09-20:upcoming",
    )

    @Test
    fun `주의선_reserved4분의1`() = check(
        "07_주의선_reserved4분의1", "2026-09-13",
        SseuldonState(
            currentBalance = 999000L, balanceMode = "manual", safetyBuffer = 0L,
            nextIncomeDate = "2026-09-25", incomeMode = "monthly", incomeDay = 25, incomeGraceDays = 3,
            fixedCosts = listOf(
                FixedCost(id="a", name="월세", amount=800000L, dueDate="2026-09-20", recurrence="monthly")
            ),
        ),
        "07_주의선_reserved4분의1|199000|0|800000|800000|0|0|12|true|2026-09-20|7|caution|0.3367|2026-09:2026-09-20:upcoming",
    )

    @Test
    fun `일일가용_2만미만`() = check(
        "08_일일가용_2만미만", "2026-09-01",
        SseuldonState(
            currentBalance = 1050000L, balanceMode = "manual", safetyBuffer = 0L,
            nextIncomeDate = "2026-09-30", incomeMode = "monthly", incomeDay = 30, incomeGraceDays = 3,
            fixedCosts = listOf(
                FixedCost(id="a", name="월세", amount=800000L, dueDate="2026-09-20", recurrence="monthly")
            ),
        ),
        "08_일일가용_2만미만|250000|0|800000|800000|0|0|29|true|2026-09-20|19|caution|0.1667|2026-09:2026-09-20:upcoming",
    )

    @Test
    fun `31일_짧은달_보정`() = check(
        "09_31일_짧은달_보정", "2026-02-10",
        SseuldonState(
            currentBalance = 2000000L, balanceMode = "manual", safetyBuffer = 100000L,
            nextIncomeDate = "2026-02-25", incomeMode = "monthly", incomeDay = 25, incomeGraceDays = 3,
            fixedCosts = listOf(
                FixedCost(id="a", name="보험", amount=90000L, dueDate="2026-01-31", recurrence="monthly")
            ),
        ),
        "09_31일_짧은달_보정|1720000|0|180000|90000|90000|1|15|true|2026-02-28|18|safe|0.0000|2026-01:2026-01-31:overdue;2026-02:2026-02-28:upcoming",
    )

    @Test
    fun `불규칙소득_유예만료`() = check(
        "10_불규칙소득_유예만료", "2026-09-13",
        SseuldonState(
            currentBalance = 500000L, balanceMode = "manual", safetyBuffer = 100000L,
            nextIncomeDate = "2026-09-05", incomeMode = "irregular", incomeDay = 25, incomeGraceDays = 3,
            fixedCosts = listOf(
                FixedCost(id="a", name="통신비", amount=55000L, dueDate="2026-09-28", recurrence="monthly")
            ),
        ),
        "10_불규칙소득_유예만료|345000|0|55000|55000|0|0|0|false|2026-09-28|15|safe|0.0000|2026-09:2026-09-28:upcoming",
    )

    @Test
    fun `연도전환`() = check(
        "11_연도전환", "2026-12-20",
        SseuldonState(
            currentBalance = 900000L, balanceMode = "manual", safetyBuffer = 100000L,
            nextIncomeDate = "2026-12-25", incomeMode = "monthly", incomeDay = 25, incomeGraceDays = 3,
            fixedCosts = listOf(
                FixedCost(id="a", name="월세", amount=300000L, dueDate="2026-12-05", recurrence="monthly")
            ),
        ),
        "11_연도전환|200000|0|600000|300000|300000|1|5|true|2027-01-05|16|safe|0.3333|2026-12:2026-12-05:overdue;2027-01:2027-01-05:upcoming",
    )

    @Test
    fun `고정비없음_불규칙_미정`() = check(
        "12_고정비없음_불규칙_미정", "2026-09-13",
        SseuldonState(
            currentBalance = 80000L, balanceMode = "manual", safetyBuffer = 0L,
            nextIncomeDate = "", incomeMode = "irregular", incomeDay = 25, incomeGraceDays = 3,
            fixedCosts = listOf(
                
            ),
        ),
        "12_고정비없음_불규칙_미정|80000|0|0|0|0|0|0|false|-|-|caution|0.7333|",
    )
}
