package kr.sseuldon.app.widget

import android.content.Context
import android.graphics.Color
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import kr.sseuldon.app.MainActivity
import kr.sseuldon.app.data.SseuldonRepository
import kr.sseuldon.app.domain.RiskLevel
import kr.sseuldon.app.domain.SpendableCalculator
import kr.sseuldon.app.domain.SpendableSummary
import kr.sseuldon.app.domain.SyncStatus
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.launch

class SseuldonWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val state = SseuldonRepository.get(context).state()
        val summary = SpendableCalculator.summary(state)
        val syncedAt = state.syncedAt
        provideContent { WidgetContent(summary, syncedAt, state.balanceMode) }
    }

    @Composable
    private fun WidgetContent(summary: SpendableSummary, syncedAt: Long, balanceMode: String) {
        val gaugeColor = gaugeColor(summary)
        val gaugeValue = if (summary.currentBalance == null || !summary.displayAmount) {
            0
        } else {
            ((1.0 - summary.riskScore.coerceIn(0.0, 1.0)) * 10).toInt().coerceAtLeast(1)
        }
        val firstOverdue = summary.fixedCostItems.firstOrNull { it.overdue }
        val fixedCostDay = summary.daysUntilNextFixedCost?.let {
            if (it == 0) "고정비 납부일" else "다음 고정비 D-$it"
        } ?: "예정 고정비 없음"
        val incomeDay = if (summary.incomeDateKnown) {
            if (summary.daysUntilIncome == 0) "소득 예상일" else "다음 소득일 D-${summary.daysUntilIncome}"
        } else {
            "소득일 미정"
        }

        Column(
            modifier = GlanceModifier
                .fillMaxSize()
                .background(ColorProvider(ComposeColor(Color.WHITE)))
                .clickable(actionStartActivity<MainActivity>())
                .padding(16.dp),
            verticalAlignment = Alignment.Vertical.Top,
        ) {
            Row(modifier = GlanceModifier.fillMaxWidth()) {
                Text(
                    text = if (syncedAt > 0) {
                        "지금 써도 되는 돈  ·  ${if (balanceMode == "manual") "직접 입력" else if (summary.syncStatus == SyncStatus.FRESH) "자동 갱신" else "마지막 정상"} ${time(syncedAt)}"
                    } else {
                        "지금 써도 되는 돈  ·  연결 필요"
                    },
                    style = TextStyle(
                        color = ColorProvider(ComposeColor(Color.rgb(118, 118, 118))),
                        fontSize = 10.sp,
                    ),
                )
            }
            Spacer(GlanceModifier.height(4.dp))
            Text(
                text = when {
                    summary.currentBalance == null -> "설정 필요"
                    !summary.displayAmount -> "잔액 확인 필요"
                    summary.spendableAmount < 0 -> "${won(summary.shortageAmount)}원 부족"
                    else -> "${won(summary.spendableAmount)}원"
                },
                style = TextStyle(
                    color = ColorProvider(ComposeColor(Color.rgb(45, 45, 45))),
                    fontSize = 32.sp,
                    fontWeight = FontWeight.Bold,
                ),
            )
            Spacer(GlanceModifier.height(5.dp))
            Row(modifier = GlanceModifier.fillMaxWidth()) {
                repeat(10) { index ->
                    Spacer(
                        GlanceModifier
                            .width(13.dp)
                            .height(8.dp)
                            .background(ColorProvider(ComposeColor(
                                if (index < gaugeValue) gaugeColor else Color.rgb(231, 231, 231),
                            ))),
                    )
                    if (index < 9) Spacer(GlanceModifier.width(2.dp))
                }
            }
            Spacer(GlanceModifier.height(7.dp))
            Row(modifier = GlanceModifier.fillMaxWidth()) {
                Column(modifier = GlanceModifier.width(86.dp)) {
                    Text(
                        text = if (summary.overdueCount > 0) "미납 ${summary.overdueCount}건" else "고정비",
                        modifier = GlanceModifier
                            .background(ColorProvider(ComposeColor(
                                if (summary.overdueCount > 0) Color.rgb(254, 88, 54) else Color.rgb(242, 130, 16),
                            )))
                            .padding(horizontal = 7.dp, vertical = 3.dp),
                        style = TextStyle(
                            color = ColorProvider(ComposeColor(Color.WHITE)),
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                        ),
                    )
                    Spacer(GlanceModifier.height(2.dp))
                    Text(
                        text = "${won(summary.reservedFixedCosts)}원",
                        style = TextStyle(
                            color = ColorProvider(ComposeColor(Color.rgb(45, 45, 45))),
                            fontSize = 17.sp,
                        ),
                    )
                }
                Spacer(GlanceModifier.width(10.dp))
                Column(
                    horizontalAlignment = Alignment.Horizontal.End,
                ) {
                    if (summary.overdueCount > 0) {
                        Text(
                            text = "⚠ ${periodLabel(firstOverdue?.period.orEmpty())} ${firstOverdue?.name ?: "고정비"} 미납",
                            style = TextStyle(
                                color = ColorProvider(ComposeColor(Color.rgb(217, 67, 43))),
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold,
                            ),
                        )
                    }
                    Text(
                        text = fixedCostDay,
                        style = TextStyle(
                            color = ColorProvider(ComposeColor(Color.rgb(62, 62, 62))),
                            fontSize = 11.sp,
                        ),
                    )
                    Text(
                        text = incomeDay,
                        style = TextStyle(
                            color = ColorProvider(ComposeColor(Color.rgb(62, 62, 62))),
                            fontSize = 11.sp,
                        ),
                    )
                }
            }
        }
    }

    private fun gaugeColor(summary: SpendableSummary): Int =
        when (summary.riskLevel) {
            RiskLevel.SAFE -> Color.rgb(0, 177, 118)
            RiskLevel.CAUTION -> Color.rgb(242, 130, 16)
            RiskLevel.DANGER, RiskLevel.CRITICAL -> Color.rgb(254, 88, 54)
        }

    companion object {
        suspend fun updateNow(context: Context) {
            SseuldonWidget().updateAll(context)
        }

        fun update(context: Context) {
            kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Default).launch {
                updateNow(context.applicationContext)
            }
        }

        private fun won(value: Long): String = NumberFormat.getNumberInstance(Locale.KOREA).format(value)
        private fun time(value: Long): String = SimpleDateFormat("M/d HH:mm", Locale.KOREA).format(Date(value))
        private fun periodLabel(value: String): String {
            if (!value.matches(Regex("""\d{4}-\d{2}"""))) return value.ifBlank { "이번 회차" }
            return "${value.takeLast(2).toInt()}월"
        }
    }
}

class SseuldonWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = SseuldonWidget()
}
