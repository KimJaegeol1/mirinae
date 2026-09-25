import SwiftUI

/// 직접입력 모드의 메인 화면. Android MainActivity 의 카드 + 메뉴, Scriptable 의 menu() 와 같은 구성.
struct DashboardView: View {
    @EnvironmentObject private var app: AppState
    @State private var sheet: DashboardSheet?

    enum DashboardSheet: String, Identifiable {
        case expense, income, correction, budget, status, history, settings
        var id: String { rawValue }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    SummaryCard(summary: app.summary, state: app.state)

                    HStack(spacing: 10) {
                        Button {
                            sheet = .expense
                        } label: {
                            Label("지출 입력", systemImage: "minus.circle.fill")
                                .font(.headline)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 8)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)

                        Button {
                            sheet = .income
                        } label: {
                            Label("입금 입력", systemImage: "plus.circle.fill")
                                .font(.headline)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 8)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                    }

                    VStack(spacing: 8) {
                        MenuButton(title: "은행 잔액과 맞추기", systemImage: "equal.circle") { sheet = .correction }
                        MenuButton(title: "고정비 납부·미납 관리", systemImage: "checkmark.circle") { sheet = .status }
                        MenuButton(title: "고정비·소득 예상일 수정", systemImage: "slider.horizontal.3") { sheet = .budget }
                        MenuButton(title: "최근 수동 기록 보기", systemImage: "list.bullet.rectangle") { sheet = .history }
                        NavigationLink {
                            WidgetGuideView()
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "square.grid.2x2").frame(width: 22)
                                Text("홈 화면 위젯 추가하기")
                                Spacer()
                                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                            }
                            .padding(.vertical, 13)
                            .padding(.horizontal, 16)
                            .background(Color.white, in: RoundedRectangle(cornerRadius: 14))
                            .foregroundStyle(MirinaeTheme.ink)
                        }
                        .buttonStyle(.plain)
                        ShareLink(item: app.historyCSV()) {
                            HStack(spacing: 12) {
                                Image(systemName: "square.and.arrow.up").frame(width: 22)
                                Text("수동 입력 기록 보내기 (CSV)")
                                Spacer()
                            }
                            .padding(.vertical, 13)
                            .padding(.horizontal, 16)
                            .background(Color.white, in: RoundedRectangle(cornerRadius: 14))
                            .foregroundStyle(MirinaeTheme.ink)
                        }
                        .buttonStyle(.plain)
                    }

                    Text("잔액·고정비·입력 기록은 이 아이폰 안에만 저장되며 서버로 전송되지 않아요.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 4)
                }
                .padding(18)
            }
            .background(MirinaeTheme.paper)
            .navigationTitle("미리내")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        sheet = .settings
                    } label: {
                        Image(systemName: "gearshape")
                    }
                }
            }
            .sheet(item: $sheet, onDismiss: { app.flushPendingMessage() }) { item in
                switch item {
                case .expense:
                    TransactionSheet(type: "expense")
                case .income:
                    TransactionSheet(type: "income")
                case .correction:
                    BalanceCorrectionSheet()
                case .budget:
                    BudgetSetupSheet()
                case .status:
                    FixedCostStatusSheet()
                case .history:
                    HistorySheet()
                case .settings:
                    SettingsSheet()
                }
            }
        }
    }
}

/// 위젯과 같은 정보를 보여주는 카드
struct SummaryCard: View {
    let summary: SpendableSummary
    let state: MirinaeState

    private var gaugeColor: Color { MirinaeTheme.gauge(for: summary.riskLevel) }

    private var detailText: String {
        if let overdue = summary.firstOverdue {
            return "⚠ \(MirinaeFormat.periodLabel(overdue.period)) \(overdue.name) 미납 · \(MirinaeFormat.won(summary.overdueFixedCosts))원"
        }
        if summary.riskLevel == .critical {
            return "🚨 미리 낼 돈이 \(MirinaeFormat.won(summary.shortageAmount))원 부족해요"
        }
        let icon: String
        switch summary.riskLevel {
        case .safe: icon = "●"
        case .caution: icon = "▲"
        case .danger: icon = "⚠"
        case .critical: icon = "🚨"
        }
        return "\(icon) \(summary.riskLabel) · 미리 남긴 고정비 \(MirinaeFormat.won(summary.reservedFixedCosts))원"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("지금 써도 되는 돈")
                    .font(.caption)
                    .foregroundStyle(MirinaeTheme.muted)
                Spacer()
                Text("직접 입력 \(MirinaeFormat.time(state.syncedAt))")
                    .font(.caption2)
                    .foregroundStyle(MirinaeTheme.faint)
            }
            Text(summary.amountText)
                .font(.system(size: 36, weight: .bold, design: .rounded))
                .foregroundStyle(MirinaeTheme.ink)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            GaugeBar(filled: summary.gaugeValue, color: gaugeColor, height: 6)
            Text(detailText)
                .font(.subheadline)
                .foregroundStyle(summary.overdueCount > 0 ? MirinaeTheme.overdueText : MirinaeTheme.ink)
                .padding(.top, 2)
            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 3) {
                    FixedCostBadge(overdueCount: summary.overdueCount)
                    Text("\(MirinaeFormat.won(summary.reservedFixedCosts))원")
                        .font(.system(size: 18))
                        .foregroundStyle(MirinaeTheme.ink)
                    Text("안전완충액 \(MirinaeFormat.won(summary.safetyBuffer))원")
                        .font(.caption2)
                        .foregroundStyle(MirinaeTheme.muted)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 3) {
                    Text(summary.fixedCostDayText)
                    Text(summary.incomeDayText)
                    Text("잔액 \(MirinaeFormat.won(summary.currentBalance ?? 0))원")
                        .foregroundStyle(MirinaeTheme.muted)
                }
                .font(.caption)
                .foregroundStyle(MirinaeTheme.ink)
            }
            .padding(.top, 4)
            Text(state.lastResult)
                .font(.caption2)
                .foregroundStyle(MirinaeTheme.faint)
        }
        .card()
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .stroke(gaugeColor.opacity(0.35), lineWidth: 1)
        )
    }
}
