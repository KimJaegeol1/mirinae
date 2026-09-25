import SwiftUI

/// 아직 잔액을 넣기 전 첫 화면
struct StartView: View {
    @EnvironmentObject private var app: AppState
    @State private var showsStart = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("미리내")
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                        .foregroundStyle(MirinaeTheme.brand)
                    Text("미리 낼 돈을 남겨두고, 오늘 써도 되는 돈만 봐요")
                        .font(.body)
                        .foregroundStyle(.secondary)

                    VStack(alignment: .leading, spacing: 6) {
                        Text("현재 계좌 잔액")
                        Text("− 이번에 남겨둘 고정비")
                        Text("− 과거 미납 고정비")
                        Text("− 안전완충액")
                        Divider()
                        Text("= 지금 써도 되는 돈").fontWeight(.semibold)
                    }
                    .font(.callout.monospacedDigit())
                    .card()

                    Text("1. 잔액 입력  →  2. 미리 낼 돈 설정  →  3. 위젯 추가")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(MirinaeTheme.brandSoft)

                    Button {
                        showsStart = true
                    } label: {
                        Text("잔액 직접 입력으로 시작")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 6)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)

                    Text("일반은행 자동연동(팝빌)은 서버와 함께 정식 서비스에서 제공돼요. 이 빌드는 서버 없이 이 아이폰 안에서만 동작합니다. 계좌번호·비밀번호는 입력하지 않아요.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .padding(24)
            }
            .background(MirinaeTheme.paper)
            .sheet(isPresented: $showsStart, onDismiss: { app.flushPendingMessage() }) {
                ManualStartSheet()
            }
        }
    }
}

/// 참여자 코드·초기 잔액 → (같은 시트 안에서) 미리 낼 돈 설정까지 이어서 진행
struct ManualStartSheet: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var code = "P01"
    @State private var balanceText = ""
    @State private var goesToBudget = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("참여자 코드 (예: P03)", text: $code)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                    TextField("은행 앱에 표시된 현재 잔액", text: $balanceText)
                        .keyboardType(.numberPad)
                } footer: {
                    Text("입력한 잔액과 설정은 이 아이폰에만 저장됩니다. 잔액은 자동으로 바뀌지 않으므로 입금·출금 뒤 직접 입력해야 합니다.")
                }
            }
            .navigationTitle("초기 잔액 직접 입력")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("취소") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("다음") { next() }
                }
            }
            .navigationDestination(isPresented: $goesToBudget) {
                BudgetSetupView(initial: .firstSetup, firstSetup: true) { draft in
                    let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
                    let amount = MirinaeFormat.parseAmount(balanceText) ?? 0
                    dismiss()
                    app.startManual(participantCode: trimmed, balance: amount)
                    app.saveSettings(
                        safetyBuffer: draft.safetyBuffer,
                        incomeMode: draft.incomeMode,
                        incomeDay: draft.incomeDay,
                        nextIncomeDate: draft.nextIncomeDate,
                        fixedCosts: draft.fixedCosts
                    )
                    app.notifyLater("초기 잔액과 미리 낼 돈을 저장했어요. 이제 홈 화면에 위젯을 추가해 보세요.")
                }
            }
            .noticeAlert($error)
        }
    }

    private func next() {
        let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            error = "참여자 코드를 입력해 주세요."
            return
        }
        guard MirinaeFormat.parseAmount(balanceText) != nil else {
            error = "현재 잔액을 숫자로 입력해 주세요."
            return
        }
        goesToBudget = true
    }
}
