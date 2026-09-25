import SwiftUI

/// 설정 화면이 편집하는 값. 저장 전까지는 앱 상태를 건드리지 않는다.
struct BudgetDraft: Equatable {
    var safetyBuffer: Int
    var incomeMode: String          // "monthly" | "irregular"
    var incomeDay: Int
    var irregularDateText: String   // "" = 미정, 아니면 "yyyy-MM-dd"
    var fixedCosts: [FixedCost]

    init(state: MirinaeState) {
        safetyBuffer = state.safetyBuffer
        incomeMode = state.incomeMode
        incomeDay = state.incomeDay
        irregularDateText = (state.incomeMode == "irregular" && state.nextIncomeDate != "2000-01-01") ? state.nextIncomeDate : ""
        fixedCosts = state.fixedCosts
    }

    init(safetyBuffer: Int, incomeMode: String, incomeDay: Int, irregularDateText: String, fixedCosts: [FixedCost]) {
        self.safetyBuffer = safetyBuffer
        self.incomeMode = incomeMode
        self.incomeDay = incomeDay
        self.irregularDateText = irregularDateText
        self.fixedCosts = fixedCosts
    }

    static var firstSetup: BudgetDraft {
        BudgetDraft(safetyBuffer: 100_000, incomeMode: "monthly", incomeDay: 25, irregularDateText: "", fixedCosts: [])
    }

    /// 저장할 nextIncomeDate (Android saveSettings 와 동일한 규칙)
    var nextIncomeDate: String {
        if incomeMode == "monthly" {
            return SpendableCalculator.nextIncomeDate(day: incomeDay)
        }
        return irregularDateText.isEmpty ? "2000-01-01" : irregularDateText
    }
}

struct BudgetSetupView: View {
    let firstSetup: Bool
    let onSave: (BudgetDraft) -> Void

    @State private var draft: BudgetDraft
    @State private var bufferText: String
    @State private var incomeDayText: String
    @State private var irregularKnown: Bool
    @State private var irregularDate: Date
    @State private var editingCost: FixedCost?
    @State private var error: String?

    init(initial: BudgetDraft, firstSetup: Bool, onSave: @escaping (BudgetDraft) -> Void) {
        self.firstSetup = firstSetup
        self.onSave = onSave
        _draft = State(initialValue: initial)
        _bufferText = State(initialValue: String(initial.safetyBuffer))
        _incomeDayText = State(initialValue: String(initial.incomeDay))
        _irregularKnown = State(initialValue: !initial.irregularDateText.isEmpty)
        _irregularDate = State(initialValue: MirinaeFormat.localDate(from: initial.irregularDateText) ?? Date())
    }

    var body: some View {
        Form {
            Section {
                Picker("소득 방식", selection: $draft.incomeMode) {
                    Text("매월 비슷한 날").tag("monthly")
                    Text("불규칙하거나 미정").tag("irregular")
                }
                if draft.incomeMode == "monthly" {
                    HStack {
                        Text("매월 예상 소득일")
                        Spacer()
                        TextField("1~31", text: $incomeDayText)
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 80)
                        Text("일")
                    }
                } else {
                    Toggle("예상일을 알고 있어요", isOn: $irregularKnown)
                    if irregularKnown {
                        DatePicker("예상일", selection: $irregularDate, displayedComponents: .date)
                    }
                }
            } header: {
                Text("소득 예상")
            } footer: {
                Text("실제 소득이 들어오면 ‘입금 입력’에서 직접 반영해 주세요. 이 날짜는 위젯 안내와 하루 사용가능액 계산에 씁니다.")
            }

            Section {
                HStack {
                    Text("안전완충액")
                    Spacer()
                    TextField("100000", text: $bufferText)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing)
                    Text("원")
                }
            } footer: {
                Text("예상 못 한 지출에 대비해 항상 남겨둘 금액이에요.")
            }

            Section {
                ForEach(draft.fixedCosts) { cost in
                    Button {
                        editingCost = cost
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(cost.name.isEmpty ? "이름 없음" : cost.name)
                                    .foregroundStyle(MirinaeTheme.ink)
                                Text("\(cost.recurrence == "once" ? "한 번만" : "매월") · \(cost.dueDate)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text("\(MirinaeFormat.won(cost.amount))원")
                                .foregroundStyle(MirinaeTheme.ink)
                        }
                    }
                }
                .onDelete { offsets in
                    draft.fixedCosts.remove(atOffsets: offsets)
                }
                Button {
                    let today = SpendableCalculator.dateKey(SpendableCalculator.nowMillis())
                    editingCost = FixedCost(name: "", amount: 0, dueDate: SpendableCalculator.addDays(today, 7))
                } label: {
                    Label("고정비 추가", systemImage: "plus.circle.fill")
                }
            } header: {
                Text("미리 남겨둘 고정비")
            } footer: {
                Text("매월 반복 고정비는 납부일 다음 날부터 다음 달 회차가 생겨요. 이전 회차를 내지 않았다면 미납액과 다음 회차를 함께 남겨둡니다. 실제로 냈으면 ‘고정비 납부·미납 관리’에서 납부 완료로 바꾸세요.")
            }
        }
        .navigationTitle(firstSetup ? "미리 낼 돈 설정" : "고정비·소득 예상일 수정")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(firstSetup ? "완료" : "저장") { save() }
            }
        }
        .sheet(item: $editingCost) { cost in
            FixedCostEditor(cost: cost) { saved in
                if let index = draft.fixedCosts.firstIndex(where: { $0.id == saved.id }) {
                    draft.fixedCosts[index] = saved
                } else {
                    draft.fixedCosts.append(saved)
                }
            }
        }
        .noticeAlert($error)
    }

    private func save() {
        var result = draft
        result.safetyBuffer = MirinaeFormat.parseAmount(bufferText) ?? 0
        if draft.incomeMode == "monthly" {
            guard let day = Int(incomeDayText.filter { $0.isASCII && $0.isNumber }), (1...31).contains(day) else {
                error = "매월 예상 소득일을 1부터 31 사이로 입력해 주세요."
                return
            }
            result.incomeDay = day
            result.irregularDateText = ""
        } else {
            result.irregularDateText = irregularKnown ? MirinaeFormat.localDayString(irregularDate) : ""
        }
        if result.fixedCosts.contains(where: { $0.name.trimmingCharacters(in: .whitespaces).isEmpty || $0.amount <= 0 }) {
            error = "고정비는 이름과 0원보다 큰 금액을 모두 입력해 주세요."
            return
        }
        onSave(result)
    }
}

/// 고정비 한 건 편집
struct FixedCostEditor: View {
    @Environment(\.dismiss) private var dismiss
    @State private var cost: FixedCost
    @State private var amountText: String
    @State private var dueDate: Date
    @State private var error: String?
    let onSave: (FixedCost) -> Void

    init(cost: FixedCost, onSave: @escaping (FixedCost) -> Void) {
        self.onSave = onSave
        _cost = State(initialValue: cost)
        _amountText = State(initialValue: cost.amount > 0 ? String(cost.amount) : "")
        _dueDate = State(initialValue: MirinaeFormat.localDate(from: cost.dueDate) ?? Date())
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("이름 (예: 월세)", text: $cost.name)
                    HStack {
                        TextField("금액", text: $amountText)
                            .keyboardType(.numberPad)
                        Text("원")
                    }
                    Picker("반복", selection: $cost.recurrence) {
                        Text("매월 반복").tag("monthly")
                        Text("한 번만 납부").tag("once")
                    }
                    DatePicker(cost.recurrence == "monthly" ? "첫 납부일" : "납부일", selection: $dueDate, displayedComponents: .date)
                } footer: {
                    Text(cost.recurrence == "monthly"
                         ? "입력한 날짜를 시작으로 같은 날짜에 매월 새 고정비 회차가 생겨요. 31일이면 짧은 달에는 말일로 잡혀요."
                         : "이번 한 번만 남겨둘 고정비예요.")
                }
                if !cost.resolutions.isEmpty {
                    Section("처리한 회차") {
                        ForEach(cost.resolutions, id: \.self) { resolution in
                            HStack {
                                Text(MirinaeFormat.periodLabel(resolution.period))
                                Spacer()
                                Text(resolution.status == "paid" ? "납부 완료" : "면제")
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("고정비")
            .navigationBarTitleDisplayMode(.inline)
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
        let name = cost.name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else {
            error = "고정비 이름을 입력해 주세요."
            return
        }
        guard let amount = MirinaeFormat.parseAmount(amountText), amount > 0 else {
            error = "0원보다 큰 금액을 입력해 주세요."
            return
        }
        var saved = cost
        saved.name = name
        saved.amount = amount
        saved.dueDate = MirinaeFormat.localDayString(dueDate)
        onSave(saved)
        dismiss()
    }
}
