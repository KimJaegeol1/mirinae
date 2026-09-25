import Combine
import Foundation
import WidgetKit

/// 직접입력(manual) 모드의 모든 상태 변경은 여기서 일어난다.
/// Android `SseuldonRepository` + Scriptable 의 manual 함수들을 합친 것.
/// 변경 → 저장 → 위젯 갱신 순서를 `commit` 이 보장한다.
@MainActor
final class AppState: ObservableObject {
    @Published private(set) var state: MirinaeState
    @Published var message: String?

    private let store: MirinaeStore
    private var pendingMessage: String?

    init(store: MirinaeStore = .shared) {
        self.store = store
        self.state = store.load()
    }

    var isManual: Bool { state.isManual }
    var summary: SpendableSummary { SpendableCalculator.summary(state) }
    var isAppGroupAvailable: Bool { store.isAppGroupAvailable }

    /// 앱이 다시 앞으로 올 때 (날짜가 바뀌었을 수 있으므로) 다시 읽는다.
    func reload() {
        state = store.load()
    }

    // MARK: - 시작

    func startManual(participantCode: String, balance: Int) {
        var base = MirinaeState()
        base.currentBalance = max(0, balance)
        base.balanceMode = "manual"
        base.participantCode = participantCode.trimmingCharacters(in: .whitespacesAndNewlines)
        base.syncedAt = SpendableCalculator.nowMillis()
        base.lastResult = "초기 잔액을 직접 입력했어요"
        base.safetyBuffer = 100_000
        base.incomeMode = "monthly"
        base.incomeDay = 25
        base.nextIncomeDate = SpendableCalculator.nextIncomeDate(day: 25)
        base.incomeGraceDays = 3
        commit(appendEvent(base, type: "initial_balance", changeAmount: base.currentBalance, memo: "직접 입력 시작"))
    }

    /// 시트가 닫힌 뒤 루트 화면의 안내창으로 결과를 보여준다.
    /// 시트의 onDismiss 가 flushPendingMessage() 를 부르고, 그게 안 불리는 경우(화면 자체가 바뀐 경우)를 위해 시간 예비도 둔다.
    func notifyLater(_ text: String) {
        pendingMessage = text
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 700_000_000)
            self?.flushPendingMessage()
        }
    }

    func flushPendingMessage() {
        guard let pending = pendingMessage else { return }
        pendingMessage = nil
        message = pending
    }

    // MARK: - 설정

    func saveSettings(
        safetyBuffer: Int,
        incomeMode: String,
        incomeDay: Int,
        nextIncomeDate: String,
        fixedCosts: [FixedCost]
    ) {
        var base = state
        base.safetyBuffer = max(0, safetyBuffer)
        base.incomeMode = incomeMode
        base.incomeDay = min(31, max(1, incomeDay))
        base.nextIncomeDate = nextIncomeDate
        base.incomeGraceDays = 3
        base.fixedCosts = fixedCosts
        base.lastResult = "계산 기준을 저장했어요"
        commit(appendEvent(base, type: "budget_update"))
    }

    // MARK: - 장부

    /// 입금(income) / 지출(expense). 성공하면 true.
    @discardableResult
    func recordTransaction(type: String, amount: Int, memo: String) -> Bool {
        guard let previous = state.currentBalance else {
            message = "초기 잔액을 먼저 입력해 주세요."
            return false
        }
        do {
            let next = try SpendableCalculator.manualBalanceAfter(previous, type: type, amount: amount)
            var base = state
            base.currentBalance = next
            base.syncedAt = SpendableCalculator.nowMillis()
            base.lastResult = type == "income" ? "입금을 직접 반영했어요" : "지출을 직접 반영했어요"
            base.syncError = ""
            base.forceHideAmount = false
            commit(appendEvent(base, type: type, changeAmount: type == "income" ? amount : -amount, memo: memo))
            return true
        } catch {
            message = error.localizedDescription
            return false
        }
    }

    /// 은행 잔액과 맞추기
    func correctBalance(_ balance: Int, memo: String) {
        let previous = state.currentBalance ?? 0
        var base = state
        base.currentBalance = max(0, balance)
        base.syncedAt = SpendableCalculator.nowMillis()
        base.lastResult = "현재 잔액을 직접 수정했어요"
        base.syncError = ""
        base.forceHideAmount = false
        commit(appendEvent(base, type: "balance_correction", changeAmount: max(0, balance) - previous, memo: memo))
    }

    /// 고정비 회차 상태 변경. status: paid | waived | unpaid. paid 일 때는 납부 후 잔액을 함께 받는다.
    func updateFixedCostStatus(fixedCostId: String, period: String, status: String, balanceAfter: Int?) {
        guard let target = state.fixedCosts.first(where: { $0.id == fixedCostId }) else {
            message = "고정비를 찾지 못했어요."
            return
        }
        let now = SpendableCalculator.nowMillis()
        let costs = state.fixedCosts.map { cost -> FixedCost in
            guard cost.id == fixedCostId else { return cost }
            var value = cost
            var resolutions = cost.resolutions.filter { $0.period != period }
            if status != "unpaid" {
                resolutions.append(FixedCostResolution(period: period, status: status, resolvedAt: now))
            }
            value.resolutions = resolutions
            return value
        }
        var base = state
        base.fixedCosts = costs
        var changeAmount: Int? = nil
        if let balanceAfter {
            let normalized = max(0, balanceAfter)
            changeAmount = normalized - (state.currentBalance ?? 0)
            base.currentBalance = normalized
            base.syncedAt = now
        }
        switch status {
        case "paid": base.lastResult = "납부 후 잔액과 납부완료를 반영했어요"
        case "waived": base.lastResult = "이번 고정비 회차를 면제했어요"
        default: base.lastResult = "고정비 회차를 다시 미납으로 바꿨어요"
        }
        commit(appendEvent(
            base,
            type: "fixed_cost_\(status)",
            changeAmount: changeAmount,
            memo: status == "paid" ? "납부 후 잔액 반영" : "",
            fixedCostName: target.name,
            period: period
        ))
    }

    // MARK: - 삭제·공유

    func deleteAll() {
        store.clear()
        state = MirinaeState()
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// Scriptable `shareManualHistory` 와 같은 열 구성의 CSV
    func historyCSV() -> String {
        let header = [
            "참여자코드", "입력시각", "기록유형", "금액변화", "현재잔액", "메모",
            "남겨둔고정비", "안전완충액", "사용가능액", "고정비명", "회차",
        ]
        func text(_ value: Int?) -> String {
            guard let value else { return "" }
            return String(value)
        }
        let rows: [[String]] = state.manualHistory.map { entry in
            [
                state.participantCode,
                MirinaeFormat.iso(entry.at),
                entry.typeLabel,
                text(entry.changeAmount),
                text(entry.balanceAmount),
                entry.memo,
                text(entry.reservedFixedCosts),
                text(entry.safetyBuffer),
                text(entry.spendableAmount),
                entry.fixedCostName,
                entry.period,
            ]
        }
        let lines = ([header] + rows).map { row in
            row.map { "\"" + $0.replacingOccurrences(of: "\"", with: "\"\"") + "\"" }.joined(separator: ",")
        }
        return "미리내 직접 입력 기록 · \(state.participantCode)\n\n" + lines.joined(separator: "\n")
    }

    // MARK: - 내부

    private func appendEvent(
        _ base: MirinaeState,
        type: String,
        changeAmount: Int? = nil,
        memo: String = "",
        fixedCostName: String = "",
        period: String = ""
    ) -> MirinaeState {
        let summary = SpendableCalculator.summary(base)
        let event = ManualHistoryEntry(
            at: SpendableCalculator.nowMillis(),
            type: type,
            balanceAmount: base.currentBalance,
            changeAmount: changeAmount,
            memo: memo.trimmingCharacters(in: .whitespacesAndNewlines),
            reservedFixedCosts: summary.reservedFixedCosts,
            safetyBuffer: base.safetyBuffer,
            spendableAmount: summary.spendableAmount,
            fixedCostName: fixedCostName,
            period: period
        )
        var updated = base
        updated.manualHistory = Array((base.manualHistory + [event]).suffix(500))
        return updated
    }

    private func commit(_ updated: MirinaeState) {
        do {
            try store.save(updated)
            state = updated
            WidgetCenter.shared.reloadAllTimelines()
        } catch {
            message = "기기에 저장하지 못했어요."
        }
    }
}
