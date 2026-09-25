import SwiftUI

// 대시보드에서 띄우는 시트들. 각 시트는 자기 안내창(noticeAlert)을 따로 가진다
// (시트가 떠 있는 동안 루트의 alert 는 뜨지 않기 때문).

/// 지출 / 입금 입력
struct TransactionSheet: View {
    let type: String   // "expense" | "income"
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var amountText = ""
    @State private var memo = ""
    @State private var error: String?

    private var isIncome: Bool { type == "income" }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        TextField(isIncome ? "입금액" : "지출액", text: $amountText)
                            .keyboardType(.numberPad)
                        Text("원")
                    }
                    TextField(isIncome ? "메모 (선택, 예: 급여)" : "메모 (선택, 예: 식비)", text: $memo)
                } footer: {
                    Text("현재 잔액 \(MirinaeFormat.won(app.state.currentBalance ?? 0))원에서 \(isIncome ? "입금액을 더해요." : "지출액을 빼요.")")
                }
            }
            .navigationTitle(isIncome ? "입금 입력" : "지출 입력")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("취소") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("확인") { save() }
                }
            }
            .noticeAlert($error)
        }
    }

    private func save() {
        guard let amount = MirinaeFormat.parseAmount(amountText), amount > 0 else {
            error = "0원보다 큰 금액을 입력해 주세요."
            return
        }
        if let previous = app.state.currentBalance, !isIncome, amount > previous {
            error = "현재 잔액보다 큰 지출은 입력할 수 없어요. 빠뜨린 기록이 있다면 ‘은행 잔액과 맞추기’를 이용해 주세요."
            return
        }
        dismiss()
        if app.recordTransaction(type: type, amount: amount, memo: memo) {
            let summary = app.summary
            let spendable = summary.spendableAmount < 0
                ? "\(MirinaeFormat.won(summary.shortageAmount))원 부족"
                : "\(MirinaeFormat.won(summary.spendableAmount))원"
            app.notifyLater("현재 잔액 \(MirinaeFormat.won(app.state.currentBalance ?? 0))원\n지금 써도 되는 돈 \(spendable)\n\n위젯에도 반영했어요.")
        }
    }
}

/// 은행 잔액과 맞추기
struct BalanceCorrectionSheet: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var balanceText = ""
    @State private var memo = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        TextField("은행 앱의 실제 현재 잔액", text: $balanceText)
                            .keyboardType(.numberPad)
                        Text("원")
                    }
                    TextField("메모 (선택, 예: 입력 누락 정정)", text: $memo)
                } footer: {
                    Text("빠뜨린 입력이 있을 때만 사용해 주세요. 차액과 메모가 기록에 남습니다.")
                }
            }
            .navigationTitle("은행 잔액과 맞추기")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                if balanceText.isEmpty, let current = app.state.currentBalance {
                    balanceText = String(current)
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("취소") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("저장") { save() }
                }
            }
            .noticeAlert($error)
        }
    }

    private func save() {
        guard let balance = MirinaeFormat.parseAmount(balanceText) else {
            error = "은행 앱에 표시된 현재 잔액을 입력해 주세요."
            return
        }
        dismiss()
        app.correctBalance(balance, memo: memo)
        app.notifyLater("실제 잔액과 위젯을 맞췄어요.")
    }
}

/// 고정비·소득 예상일 수정 (BudgetSetupView 를 시트로)
struct BudgetSetupSheet: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            BudgetSetupView(initial: BudgetDraft(state: app.state), firstSetup: false) { draft in
                dismiss()
                app.saveSettings(
                    safetyBuffer: draft.safetyBuffer,
                    incomeMode: draft.incomeMode,
                    incomeDay: draft.incomeDay,
                    nextIncomeDate: draft.nextIncomeDate,
                    fixedCosts: draft.fixedCosts
                )
                app.notifyLater("저장했고 위젯에도 반영했어요.")
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("취소") { dismiss() }
                }
            }
        }
    }
}

/// 고정비 납부·미납 관리
struct FixedCostStatusSheet: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var payingItem: FixedCostObligation?

    private struct ResolvedItem: Identifiable {
        let fixedCostId: String
        let name: String
        let amount: Int
        let period: String
        let status: String
        var id: String { "\(fixedCostId):\(period)" }
    }

    private var resolvedItems: [ResolvedItem] {
        app.state.fixedCosts.flatMap { cost in
            cost.resolutions.map { resolution in
                ResolvedItem(fixedCostId: cost.id, name: cost.name, amount: cost.amount, period: resolution.period, status: resolution.status)
            }
        }
    }

    var body: some View {
        NavigationStack {
            List {
                let items = app.summary.fixedCostItems
                Section {
                    if items.isEmpty {
                        Text("현재 남겨둘 고정비 회차가 없어요.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(items) { item in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text("\(MirinaeFormat.periodLabel(item.period)) \(item.name)")
                                        .fontWeight(.semibold)
                                    Text(item.overdue ? "⚠ 납부일 \(item.dueDate) 지남 · 미납" : "납부일 \(item.dueDate)")
                                        .font(.caption)
                                        .foregroundStyle(item.overdue ? MirinaeTheme.overdueText : Color.secondary)
                                }
                                Spacer()
                                Text("\(MirinaeFormat.won(item.amount))원")
                            }
                            HStack {
                                Button("납부 완료") { payingItem = item }
                                    .buttonStyle(.borderedProminent)
                                    .controlSize(.small)
                                Button("이번 회차 면제") {
                                    app.updateFixedCostStatus(fixedCostId: item.fixedCostId, period: item.period, status: "waived", balanceAfter: nil)
                                }
                                .buttonStyle(.bordered)
                                .controlSize(.small)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                } header: {
                    Text("남겨둔 회차")
                } footer: {
                    Text("납부 완료로 바꾸면 납부 후 실제 잔액을 함께 입력해요. 그래야 고정비가 이중으로 빠지지 않아요.")
                }

                let resolved = resolvedItems
                if !resolved.isEmpty {
                    Section("납부·면제 처리한 회차") {
                        ForEach(resolved) { item in
                            HStack {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text("\(MirinaeFormat.periodLabel(item.period)) \(item.name)")
                                    Text(item.status == "paid" ? "납부 완료" : "면제")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                Button("되돌리기") {
                                    app.updateFixedCostStatus(fixedCostId: item.fixedCostId, period: item.period, status: "unpaid", balanceAfter: nil)
                                }
                                .buttonStyle(.bordered)
                                .controlSize(.small)
                            }
                        }
                    }
                }
            }
            .navigationTitle("고정비 납부·미납 관리")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("닫기") { dismiss() }
                }
            }
            .sheet(item: $payingItem) { item in
                PaidBalanceSheet(item: item)
            }
        }
    }
}

/// 납부 완료 처리 시 납부 후 잔액 입력
struct PaidBalanceSheet: View {
    let item: FixedCostObligation
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var balanceText = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        TextField("은행 앱의 실제 현재 잔액", text: $balanceText)
                            .keyboardType(.numberPad)
                        Text("원")
                    }
                } header: {
                    Text("\(MirinaeFormat.periodLabel(item.period)) \(item.name) \(MirinaeFormat.won(item.amount))원")
                } footer: {
                    Text("고정비 납부가 반영된 실제 잔액을 입력해야 이중 차감을 막을 수 있어요. 이미 지출 입력을 했다면 현재와 같은 잔액을 그대로 두세요.")
                }
            }
            .navigationTitle("납부 후 현재 잔액")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                if balanceText.isEmpty, let current = app.state.currentBalance {
                    balanceText = String(current)
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("취소") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("납부 완료") {
                        guard let balance = MirinaeFormat.parseAmount(balanceText) else {
                            error = "납부 후 은행 앱의 현재 잔액을 입력해 주세요."
                            return
                        }
                        dismiss()
                        app.updateFixedCostStatus(fixedCostId: item.fixedCostId, period: item.period, status: "paid", balanceAfter: balance)
                    }
                }
            }
            .noticeAlert($error)
        }
    }
}

/// 최근 수동 기록
struct HistorySheet: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                let entries = Array(app.state.manualHistory.reversed())
                if entries.isEmpty {
                    Text("입금이나 지출을 입력하면 이곳에 기록됩니다.")
                        .foregroundStyle(.secondary)
                }
                ForEach(entries) { entry in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(MirinaeFormat.time(entry.at))
                                .foregroundStyle(.secondary)
                            Text(entry.typeLabel)
                                .fontWeight(.semibold)
                            if let change = entry.changeAmount {
                                Text(MirinaeFormat.signedWon(change))
                                    .foregroundStyle(change >= 0 ? MirinaeTheme.safe : MirinaeTheme.overdueText)
                            }
                            Spacer()
                        }
                        .font(.subheadline)
                        if !entry.memo.isEmpty || !entry.fixedCostName.isEmpty {
                            Text([entry.fixedCostName, entry.memo].filter { !$0.isEmpty }.joined(separator: " · "))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        if let balance = entry.balanceAmount, let spendable = entry.spendableAmount {
                            Text("잔액 \(MirinaeFormat.won(balance))원 · 사용가능 \(spendable < 0 ? "\(MirinaeFormat.won(-spendable))원 부족" : "\(MirinaeFormat.won(spendable))원")")
                                .font(.caption)
                                .foregroundStyle(MirinaeTheme.ink)
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
            .navigationTitle("최근 수동 기록 \(app.state.manualHistory.count)건")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("닫기") { dismiss() }
                }
            }
        }
    }
}

/// 직접 입력 상태 · 진단 · 개인정보 · 삭제
struct SettingsSheet: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var confirmsDelete = false

    var body: some View {
        NavigationStack {
            Form {
                Section("직접 입력 상태") {
                    LabeledContent("참여자 코드", value: app.state.participantCode)
                    LabeledContent("현재 잔액", value: "\(MirinaeFormat.won(app.state.currentBalance ?? 0))원")
                    LabeledContent("마지막 입력", value: MirinaeFormat.time(app.state.syncedAt))
                    LabeledContent("기록", value: "\(app.state.manualHistory.count)건")
                }
                Section {
                    if app.isAppGroupAvailable {
                        Label("앱 ↔ 위젯 데이터 공유 가능", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(MirinaeTheme.safe)
                    } else {
                        Label("App Group 을 쓸 수 없어 위젯이 데이터를 못 읽어요", systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(MirinaeTheme.caution)
                    }
                } header: {
                    Text("위젯 진단")
                } footer: {
                    Text("Xcode 의 Signing & Capabilities 에서 App Groups(\(MirinaeStore.appGroupIdentifier)) 가 앱과 위젯 두 타깃 모두에 켜져 있어야 해요.")
                }
                Section("개인정보") {
                    Text("잔액·고정비·입력 기록은 이 아이폰의 앱 전용 저장공간에만 저장되며 서버로 전송되지 않아요. 계좌번호·비밀번호는 입력받지 않습니다. ‘수동 입력 기록 보내기’를 눌러 직접 공유한 경우에만 선택한 사람에게 전달돼요.")
                        .font(.footnote)
                }
                Section {
                    Button("직접 입력 설정 삭제", role: .destructive) {
                        confirmsDelete = true
                    }
                } footer: {
                    Text("이 아이폰에 저장된 잔액·고정비·입력 기록을 모두 지웁니다. 삭제한 기록은 복구할 수 없어요.")
                }
            }
            .navigationTitle("설정")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("닫기") { dismiss() }
                }
            }
            .confirmationDialog("직접 입력 설정을 삭제할까요?", isPresented: $confirmsDelete, titleVisibility: .visible) {
                Button("모두 삭제", role: .destructive) {
                    dismiss()
                    app.deleteAll()
                }
                Button("취소", role: .cancel) {}
            }
        }
    }
}

/// 홈 화면 위젯 추가 안내
struct WidgetGuideView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 12) {
                    Label("홈 화면의 빈 곳을 길게 누릅니다.", systemImage: "1.circle.fill")
                    Label("왼쪽 위 ‘+’ 를 누릅니다. iOS 18은 ‘편집’ → ‘위젯 추가’.", systemImage: "2.circle.fill")
                    Label("‘미리내’를 검색해 선택합니다.", systemImage: "3.circle.fill")
                    Label("중간 크기(가로로 긴 것)를 고르고 ‘위젯 추가’를 누릅니다.", systemImage: "4.circle.fill")
                }
                .card()
                VStack(alignment: .leading, spacing: 8) {
                    Text("위젯은 언제 바뀌나요?").font(.headline)
                    Text("앱에서 입력·저장할 때마다 바로 다시 그려요. 그리고 매일 자정에 D-day 와 미납 여부를 다시 계산합니다. 위젯을 탭하면 앱이 열려요.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .card()
            }
            .padding(18)
        }
        .background(MirinaeTheme.paper)
        .navigationTitle("홈 화면 위젯")
        .navigationBarTitleDisplayMode(.inline)
    }
}
