import SwiftUI
import WidgetKit

// 홈 화면 위젯. Scriptable 위젯(summaryWidget)과 같은 배치·색으로 그린다.
// 데이터는 App Group 저장소에서 읽고, 계산은 위젯이 직접 한다 (자정에 D-day·미납이 바뀌도록).

struct MirinaeEntry: TimelineEntry {
    let date: Date
    let state: MirinaeState?
    let summary: SpendableSummary?
}

struct MirinaeProvider: TimelineProvider {
    private static let sample: MirinaeState = {
        let today = SpendableCalculator.dateKey(SpendableCalculator.nowMillis())
        return MirinaeState(
            currentBalance: 1_000_000,
            balanceMode: "manual",
            participantCode: "P01",
            safetyBuffer: 100_000,
            nextIncomeDate: SpendableCalculator.nextIncomeDate(day: 25),
            incomeMode: "monthly",
            incomeDay: 25,
            incomeGraceDays: 3,
            fixedCosts: [
                FixedCost(id: "sample-rent", name: "월세", amount: 300_000, dueDate: SpendableCalculator.addDays(today, 7), recurrence: "monthly"),
            ],
            lastResult: "미리보기"
        )
    }()

    func placeholder(in context: Context) -> MirinaeEntry {
        MirinaeEntry(date: Date(), state: Self.sample, summary: SpendableCalculator.summary(Self.sample))
    }

    func getSnapshot(in context: Context, completion: @escaping (MirinaeEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : entry(at: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<MirinaeEntry>) -> Void) {
        let now = Date()
        let midnight = SpendableCalculator.nextMidnight(after: now)
        let entries = [entry(at: now), entry(at: midnight)]
        completion(Timeline(entries: entries, policy: .after(midnight.addingTimeInterval(60))))
    }

    private func entry(at date: Date) -> MirinaeEntry {
        let state = MirinaeStore.shared.load()
        guard state.isManual else { return MirinaeEntry(date: date, state: nil, summary: nil) }
        let millis = Int(date.timeIntervalSince1970 * 1000)
        return MirinaeEntry(date: date, state: state, summary: SpendableCalculator.summary(state, nowMillis: millis))
    }
}

struct MirinaeWidgetView: View {
    let entry: MirinaeEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if #available(iOS 17.0, *) {
            inner
                .containerBackground(for: .widget) { Color.white }
                .widgetURL(URL(string: "mirinae://open"))
        } else {
            inner
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .padding(14)
                .background(Color.white)
                .widgetURL(URL(string: "mirinae://open"))
        }
    }

    @ViewBuilder
    private var inner: some View {
        if let summary = entry.summary, let state = entry.state {
            if family == .systemSmall {
                SmallContent(summary: summary, state: state)
            } else {
                MediumContent(summary: summary, state: state)
            }
        } else {
            PlaceholderContent()
        }
    }
}

private struct HeaderRow: View {
    let state: MirinaeState

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("지금 써도 되는 돈")
                .font(.system(size: 12))
                .foregroundColor(MirinaeTheme.muted)
            Spacer(minLength: 4)
            Text("직접 입력 \(MirinaeFormat.time(state.syncedAt))")
                .font(.system(size: 9))
                .foregroundColor(MirinaeTheme.faint)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
    }
}

private struct MediumContent: View {
    let summary: SpendableSummary
    let state: MirinaeState

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HeaderRow(state: state)
            Text(summary.amountText)
                .font(.system(size: summary.amountText.count > 12 ? 26 : 32, weight: .bold, design: .rounded))
                .foregroundColor(MirinaeTheme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.65)
                .privacySensitive()
            GaugeBar(filled: summary.gaugeValue, color: MirinaeTheme.gauge(for: summary.riskLevel))
                .padding(.vertical, 2)
            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 2) {
                    FixedCostBadge(overdueCount: summary.overdueCount)
                    Text("\(MirinaeFormat.won(summary.reservedFixedCosts))원")
                        .font(.system(size: 17))
                        .foregroundColor(MirinaeTheme.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 1) {
                    if let overdue = summary.firstOverdue {
                        Text("⚠ \(MirinaeFormat.periodLabel(overdue.period)) \(overdue.name) 미납")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundColor(MirinaeTheme.overdueText)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                    Text(summary.fixedCostDayText)
                        .font(.system(size: 11))
                        .foregroundColor(MirinaeTheme.ink)
                    Text(summary.incomeDayText)
                        .font(.system(size: 11))
                        .foregroundColor(MirinaeTheme.ink)
                }
            }
        }
    }
}

private struct SmallContent: View {
    let summary: SpendableSummary
    let state: MirinaeState

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("지금 써도 되는 돈")
                .font(.system(size: 11))
                .foregroundColor(MirinaeTheme.muted)
            Text(summary.amountText)
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .foregroundColor(MirinaeTheme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .privacySensitive()
            GaugeBar(filled: summary.gaugeValue, color: MirinaeTheme.gauge(for: summary.riskLevel), height: 4)
            Spacer(minLength: 2)
            if let overdue = summary.firstOverdue {
                Text("⚠ \(overdue.name) 미납")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(MirinaeTheme.overdueText)
                    .lineLimit(1)
            } else {
                Text("고정비 \(MirinaeFormat.won(summary.reservedFixedCosts))원")
                    .font(.system(size: 10))
                    .foregroundColor(MirinaeTheme.ink)
                    .lineLimit(1)
            }
            Text(summary.fixedCostDayText)
                .font(.system(size: 10))
                .foregroundColor(MirinaeTheme.muted)
                .lineLimit(1)
        }
    }
}

private struct PlaceholderContent: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("지금 써도 되는 돈")
                .font(.system(size: 12))
                .foregroundColor(MirinaeTheme.muted)
            Text("설정 필요")
                .font(.system(size: 24, weight: .bold, design: .rounded))
                .foregroundColor(MirinaeTheme.ink)
            Text("위젯을 눌러 잔액을 입력해 주세요.")
                .font(.system(size: 11))
                .foregroundColor(MirinaeTheme.muted)
            Spacer(minLength: 0)
        }
    }
}

struct MirinaeWidget: Widget {
    let kind = "MirinaeWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirinaeProvider()) { entry in
            MirinaeWidgetView(entry: entry)
        }
        .configurationDisplayName("지금 써도 되는 돈")
        .description("미리 낼 고정비와 안전완충액을 제외한 지금 써도 되는 돈")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct MirinaeWidgetBundle: WidgetBundle {
    var body: some Widget {
        MirinaeWidget()
    }
}
