package kr.sseuldon.app

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.ArrayAdapter
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import kr.sseuldon.app.data.SseuldonRepository
import kr.sseuldon.app.domain.FixedCost
import kr.sseuldon.app.domain.RiskLevel
import kr.sseuldon.app.domain.SpendableCalculator
import kr.sseuldon.app.domain.SseuldonState
import kr.sseuldon.app.remote.SseuldonApiClient
import kr.sseuldon.app.widget.SseuldonWidget
import kr.sseuldon.app.worker.WidgetRefreshWorker
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

class MainActivity : Activity() {
    private lateinit var repository: SseuldonRepository
    private lateinit var summaryCard: LinearLayout
    private lateinit var amountText: TextView
    private lateinit var detailText: TextView
    private lateinit var statusText: TextView
    private lateinit var actionMenuContainer: LinearLayout
    private lateinit var settingsContainer: LinearLayout
    private lateinit var settingsDescription: TextView
    private lateinit var popbillConnectionContainer: LinearLayout
    private lateinit var bufferInput: EditText
    private lateinit var incomeDateInput: EditText
    private lateinit var incomeModeSpinner: Spinner
    private lateinit var fixedCostsContainer: LinearLayout
    private lateinit var bankSpinner: Spinner
    private lateinit var inviteCodeInput: EditText
    private lateinit var accountNumberInput: EditText
    private lateinit var accountPasswordInput: EditText
    private lateinit var birthDateInput: EditText
    private lateinit var accountNameInput: EditText
    private lateinit var bankIdInput: EditText
    private lateinit var fastIdInput: EditText
    private lateinit var fastPasswordInput: EditText
    private lateinit var privacyCheck: CheckBox
    private val costRows = mutableListOf<CostRow>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        repository = SseuldonRepository.get(this)
        setContentView(buildScreen())
        load(repository.state())
    }

    override fun onResume() {
        super.onResume()
        if (::statusText.isInitialized) refreshSummary(repository.state())
    }

    private fun buildScreen(): View {
        val scroll = ScrollView(this).apply { setBackgroundColor(Color.rgb(247, 245, 250)) }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(22), dp(18), dp(40))
        }
        scroll.addView(root)

        root.addView(text("미리내", 28f, true).apply { setTextColor(Color.rgb(51, 35, 66)) })
        root.addView(text("미리 낼 돈을 남겨두고, 오늘 써도 되는 돈만 봐요", 14f).apply {
            setTextColor(Color.rgb(88, 76, 99))
            setPadding(0, dp(3), 0, dp(8))
        })
        root.addView(text("1. 계좌 연결  →  2. 미리 낼 돈 설정  →  3. 위젯 추가", 12f, true).apply {
            setTextColor(Color.rgb(107, 76, 138))
            setPadding(0, 0, 0, dp(16))
        })

        summaryCard = card().apply {
            setPadding(dp(20), dp(20), dp(20), dp(20))
            amountText = text("설정 필요", 34f, true)
            detailText = text("", 14f)
            statusText = text("", 12f)
            addView(text("지금 써도 되는 돈", 13f, true))
            addView(amountText)
            addView(detailText.apply { setPadding(0, dp(8), 0, dp(4)) })
            addView(statusText)
        }
        root.addView(summaryCard)

        actionMenuContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(10), 0, 0)
        }
        root.addView(actionMenuContainer)

        settingsContainer = card().apply {
            setPadding(dp(16), dp(8), dp(16), dp(16))
            visibility = View.GONE
            addView(sectionTitle("고정비·소득 예상일 수정"))
            settingsDescription = text("iPhone과 같은 항목을 설정합니다.", 12f).apply {
                setTextColor(Color.rgb(88, 76, 99))
                setPadding(0, 0, 0, dp(8))
            }
            addView(settingsDescription)
        }
        bufferInput = moneyInput("안전완충액")
        incomeModeSpinner = Spinner(this).apply {
            adapter = ArrayAdapter(
                this@MainActivity,
                android.R.layout.simple_spinner_dropdown_item,
                listOf("매월 비슷한 날 들어와요", "날짜가 불규칙하거나 아직 몰라요"),
            )
        }
        incomeDateInput = input("정기: 매월 날짜 1~31 / 불규칙: 예상일 또는 빈칸")
        settingsContainer.addView(incomeModeSpinner)
        settingsContainer.addView(incomeDateInput)
        settingsContainer.addView(bufferInput)
        settingsContainer.addView(sectionTitle("미리 남겨둘 고정비"))
        settingsContainer.addView(text("매월 새 회차가 생기며, 납부일을 넘긴 미납액은 다음 회차와 함께 남겨둬요.", 12f).apply {
            setTextColor(Color.rgb(88, 76, 99))
            setPadding(0, 0, 0, dp(8))
        })
        fixedCostsContainer = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        settingsContainer.addView(fixedCostsContainer)
        settingsContainer.addView(button("+ 고정비 추가") { addCostRow(null) })
        settingsContainer.addView(button("설정 저장", primary = true) { saveSettings() })
        settingsContainer.addView(button("취소") { settingsContainer.visibility = View.GONE })
        root.addView(settingsContainer)

        popbillConnectionContainer = card().apply {
            setPadding(dp(16), dp(8), dp(16), dp(16))
            visibility = View.GONE
            addView(sectionTitle("일반은행 연결 (팝빌)"))
            addView(text("팝빌 지원 일반은행만 자동 업데이트합니다.", 13f))
            addView(text("카카오뱅크·토스뱅크·케이뱅크와 지역 농·축협은 이번 파일럿 연결 대상이 아닙니다.", 12f).apply {
            setTextColor(Color.rgb(122, 111, 132))
                setPadding(0, dp(6), 0, dp(10))
            })
        }
        bankSpinner = Spinner(this)
        bankSpinner.adapter = ArrayAdapter(
            this,
            android.R.layout.simple_spinner_dropdown_item,
            POPBILL_BANKS.map { it.second },
        )
        popbillConnectionContainer.addView(bankSpinner)
        inviteCodeInput = secureInput("파일럿 초대코드", false)
        accountNameInput = input("계좌 별칭 (예: 생활비)")
        accountNumberInput = moneyInput("계좌번호")
        accountPasswordInput = secureInput("계좌 비밀번호 4자리", true)
        birthDateInput = secureInput("생년월일 6자리", true)
        bankIdInput = input("국민은행만: 인터넷뱅킹 ID")
        fastIdInput = input("iM·신한·신협만: 조회전용 ID")
        fastPasswordInput = secureInput("iM·신한·신협만: 조회전용 비밀번호", false)
        listOf(
            inviteCodeInput,
            accountNameInput,
            accountNumberInput,
            accountPasswordInput,
            birthDateInput,
            bankIdInput,
            fastIdInput,
            fastPasswordInput,
        ).forEach(popbillConnectionContainer::addView)
        privacyCheck = CheckBox(this).apply {
            text = "개인정보 처리 내용을 확인했고 계좌조회에 동의합니다."
            setTextColor(Color.rgb(51, 35, 66))
        }
        popbillConnectionContainer.addView(privacyCheck)
        popbillConnectionContainer.addView(button("무엇을 저장하고 언제 지우는지 보기") { showPrivacyDetails() })
        popbillConnectionContainer.addView(button("일반은행 연결하고 잔액 확인", primary = true) { connectPopbill() })
        popbillConnectionContainer.addView(button("취소") { popbillConnectionContainer.visibility = View.GONE })
        root.addView(popbillConnectionContainer)
        root.addView(text("홈 화면 빈 곳을 길게 누른 뒤 ‘위젯’ → ‘미리내’를 선택하세요.", 13f).apply {
            setTextColor(Color.rgb(88, 76, 99))
            setPadding(0, dp(16), 0, 0)
        })
        refreshActionMenu()
        return scroll
    }

    private fun load(state: SseuldonState) {
        settingsDescription.text = if (state.balanceMode == "manual") {
            "고정비·소득일·완충액을 설정합니다. 잔액은 ‘현재 잔액 수정’에서 직접 맞춰요."
        } else {
            "고정비·소득일·완충액을 설정합니다. 현재 잔액은 연결된 은행에서 자동으로 확인해요."
        }
        bufferInput.setText(state.safetyBuffer.toString())
        incomeModeSpinner.setSelection(if (state.incomeMode == "irregular") 1 else 0)
        incomeDateInput.setText(
            if (state.incomeMode == "irregular") {
                state.nextIncomeDate.takeUnless { it == "2000-01-01" }.orEmpty()
            } else {
                state.incomeDay.toString()
            },
        )
        costRows.clear()
        fixedCostsContainer.removeAllViews()
        if (state.fixedCosts.isEmpty()) addCostRow(null) else state.fixedCosts.forEach(::addCostRow)
        refreshSummary(state)
        refreshActionMenu()
    }

    private fun saveSettings() {
        val current = repository.state()
        val balance = current.currentBalance
        if (balance == null) {
            toast("일반은행을 연결하거나 초기 잔액을 직접 입력해 주세요.")
            return
        }
        val buffer = amount(bufferInput.text.toString())
        val incomeMode = if (incomeModeSpinner.selectedItemPosition == 0) "monthly" else "irregular"
        val incomeValue = incomeDateInput.text.toString().trim()
        val incomeDay = if (incomeMode == "monthly") incomeValue.toIntOrNull() ?: 0 else current.incomeDay
        if (incomeMode == "monthly" && incomeDay !in 1..31) {
            toast("매월 예상 소득일을 1부터 31 사이로 입력해 주세요.")
            return
        }
        if (incomeMode == "irregular" && incomeValue.isNotBlank() && !validDate(incomeValue)) {
            toast("예상일은 2026-08-25처럼 입력하거나 비워 주세요.")
            return
        }
        val date = if (incomeMode == "monthly") nextDateForDay(incomeDay) else incomeValue.ifBlank { "2000-01-01" }
        if (costRows.any { it.hasAnyInput() && it.value() == null }) {
            toast("고정비는 이름·0원보다 큰 금액·올바른 납부일을 모두 입력해 주세요.")
            return
        }
        val costs = costRows.mapNotNull { it.value() }
        if (costs.any { !validDate(it.dueDate) }) {
            toast("고정비 납부일을 2026-08-01처럼 입력해 주세요.")
            return
        }
        val candidate = current.copy(
            currentBalance = balance,
            safetyBuffer = buffer,
            nextIncomeDate = date,
            incomeMode = incomeMode,
            incomeDay = incomeDay.coerceIn(1, 31),
            incomeGraceDays = 3,
            fixedCosts = costs,
        )
        val session = repository.apiSession()
        if (session == null) {
            if (current.balanceMode != "manual") {
                toast("일반은행을 연결하거나 초기 잔액을 직접 입력해 주세요.")
                return
            }
            val updated = repository.saveSettings(
                currentBalance = balance,
                safetyBuffer = buffer,
                nextIncomeDate = date,
                incomeMode = incomeMode,
                incomeDay = incomeDay.coerceIn(1, 31),
                incomeGraceDays = 3,
                fixedCosts = costs,
            )
            load(updated)
            SseuldonWidget.update(this)
            settingsContainer.visibility = View.GONE
            toast("저장했고 위젯에도 반영했어요.")
            return
        }
        toast("설정을 안전하게 저장하고 있어요.")
        Thread {
            runCatching {
                SseuldonApiClient(session.apiBaseUrl)
                    .saveBudget(session, repository.budgetPayload(candidate))
            }.onSuccess { response ->
                val updated = repository.applyApiBudget(response)
                runOnUiThread {
                    load(updated)
                    SseuldonWidget.update(this)
                    settingsContainer.visibility = View.GONE
                    toast("저장했고 위젯에도 반영했어요.")
                }
            }.onFailure { error ->
                runOnUiThread { toast(error.message ?: "설정을 저장하지 못했어요.") }
            }
        }.start()
    }

    private fun connectPopbill() {
        if (!privacyCheck.isChecked) {
            toast("개인정보 처리 내용을 확인하고 동의해 주세요.")
            return
        }
        val bank = POPBILL_BANKS[bankSpinner.selectedItemPosition]
        runNetwork("일반은행을 연결하고 있어요.") {
            SseuldonApiClient().connectPopbill(
                inviteCode = inviteCodeInput.text.toString(),
                bankCode = bank.first,
                accountNumber = accountNumberInput.text.toString(),
                accountPassword = accountPasswordInput.text.toString(),
                birthDate = birthDateInput.text.toString(),
                accountName = accountNameInput.text.toString(),
                bankId = bankIdInput.text.toString(),
                fastId = fastIdInput.text.toString(),
                fastPassword = fastPasswordInput.text.toString(),
            )
        }
    }

    private fun startManualSetup() {
        val code = input("참여자 코드 (예: P03)")
        val balance = moneyInput("은행 앱에 표시된 현재 잔액")
        val fields = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(4), dp(20), 0)
            addView(code)
            addView(balance)
        }
        AlertDialog.Builder(this)
            .setTitle("초기 잔액 직접 입력")
            .setMessage("입력한 잔액과 설정은 이 휴대폰에만 암호화해 저장됩니다. 잔액은 자동으로 바뀌지 않으므로 입금·출금 뒤 직접 수정해야 합니다.")
            .setView(fields)
            .setNegativeButton("취소", null)
            .setPositiveButton("다음", null)
            .create()
            .also { dialog ->
                dialog.setOnShowListener {
                    dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                        val participantCode = code.text.toString().trim()
                        val amount = parseBalance(balance.text.toString())
                        when {
                            participantCode.isBlank() -> toast("참여자 코드를 입력해 주세요.")
                            amount == null -> toast("현재 잔액을 숫자로 입력해 주세요.")
                            else -> {
                                val updated = repository.startManualMode(participantCode, amount)
                                load(updated)
                                popbillConnectionContainer.visibility = View.GONE
                                settingsContainer.visibility = View.VISIBLE
                                SseuldonWidget.update(this)
                                dialog.dismiss()
                                toast("초기 잔액을 저장했어요. 이제 고정비를 설정해 주세요.")
                            }
                        }
                    }
                }
                dialog.show()
            }
    }

    private fun editManualBalance() {
        val current = repository.state()
        if (current.balanceMode != "manual") return
        val balance = moneyInput("은행 앱에 표시된 현재 잔액").apply {
            setText(current.currentBalance?.toString().orEmpty())
        }
        val memo = input("메모 (선택, 예: 입력 누락 정정)")
        val fields = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(4), dp(20), 0)
            addView(balance)
            addView(memo)
        }
        AlertDialog.Builder(this)
            .setTitle("은행 잔액과 맞추기")
            .setMessage("빠뜨린 입력이 있을 때만 은행 앱의 실제 잔액으로 맞춰 주세요. 차액과 메모가 기록에 남습니다.")
            .setView(fields)
            .setNegativeButton("취소", null)
            .setPositiveButton("저장", null)
            .create()
            .also { dialog ->
                dialog.setOnShowListener {
                    dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                        val amount = parseBalance(balance.text.toString())
                        if (amount == null) {
                            toast("현재 잔액을 숫자로 입력해 주세요.")
                        } else {
                            val updated = repository.updateManualBalance(amount, memo.text.toString())
                            load(updated)
                            SseuldonWidget.update(this)
                            dialog.dismiss()
                            toast("실제 잔액과 위젯을 맞췄어요.")
                        }
                    }
                }
                dialog.show()
            }
    }

    private fun recordManualTransaction(type: String) {
        val state = repository.state()
        if (state.balanceMode != "manual") return
        val isIncome = type == "income"
        val amountInput = moneyInput(if (isIncome) "입금액" else "지출액")
        val memoInput = input(if (isIncome) "메모 (선택, 예: 급여)" else "메모 (선택, 예: 식비)")
        val fields = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(4), dp(20), 0)
            addView(amountInput)
            addView(memoInput)
        }
        AlertDialog.Builder(this)
            .setTitle(if (isIncome) "입금 입력" else "지출 입력")
            .setMessage(
                "현재 잔액 ${won(state.currentBalance ?: 0)}원에서 " +
                    if (isIncome) "입금액을 더합니다." else "지출액을 뺍니다.",
            )
            .setView(fields)
            .setNegativeButton("취소", null)
            .setPositiveButton("반영", null)
            .create()
            .also { dialog ->
                dialog.setOnShowListener {
                    dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                        val value = amount(amountInput.text.toString())
                        if (value <= 0) {
                            toast("0원보다 큰 금액을 입력해 주세요.")
                            return@setOnClickListener
                        }
                        runCatching {
                            repository.recordManualTransaction(type, value, memoInput.text.toString())
                        }.onSuccess { updated ->
                            load(updated)
                            SseuldonWidget.update(this)
                            dialog.dismiss()
                            toast(if (isIncome) "입금과 위젯을 반영했어요." else "지출과 위젯을 반영했어요.")
                        }.onFailure { error ->
                            toast(error.message ?: "금액을 반영하지 못했어요.")
                        }
                    }
                }
                dialog.show()
            }
    }

    private fun refreshActionMenu() {
        if (!::actionMenuContainer.isInitialized) return
        actionMenuContainer.removeAllViews()
        val connected = repository.apiSession() != null
        val manual = !connected && repository.state().balanceMode == "manual"
        actionMenuContainer.addView(text(
            if (connected || manual) "미리내 메뉴" else "시작하기",
            17f,
            true,
        ).apply {
            setTextColor(Color.rgb(51, 35, 66))
            setPadding(0, dp(8), 0, dp(8))
        })
        if (connected) {
            actionMenuContainer.addView(button("지금 잔액 새로고침", primary = true) {
                WidgetRefreshWorker.now(this, true)
                toast("잔액을 확인하고 있어요.")
            })
            actionMenuContainer.addView(button("고정비·소득 예상일 수정") {
                popbillConnectionContainer.visibility = View.GONE
                settingsContainer.visibility = View.VISIBLE
            })
            actionMenuContainer.addView(button("고정비 납부·미납 관리") {
                changeFixedCostPaidStatus()
            })
            actionMenuContainer.addView(button("연결 상태 보기") {
                showConnectionDetails()
            })
            actionMenuContainer.addView(button("계좌 연결 해제") {
                confirmDisconnect()
            })
            actionMenuContainer.addView(button("설치·개인정보 설명서") {
                openGuide()
            })
        } else if (manual) {
            actionMenuContainer.addView(button("지출 입력", primary = true) {
                recordManualTransaction("expense")
            })
            actionMenuContainer.addView(button("입금 입력") {
                recordManualTransaction("income")
            })
            actionMenuContainer.addView(button("최근 수동 기록 보기") {
                showManualHistory()
            })
            actionMenuContainer.addView(button("은행 잔액과 맞추기") {
                editManualBalance()
            })
            actionMenuContainer.addView(button("고정비·소득 예상일 수정") {
                popbillConnectionContainer.visibility = View.GONE
                settingsContainer.visibility = View.VISIBLE
            })
            actionMenuContainer.addView(button("고정비 납부·미납 관리") {
                changeFixedCostPaidStatus()
            })
            actionMenuContainer.addView(button("직접 입력 상태 보기") {
                showConnectionDetails()
            })
            actionMenuContainer.addView(button("수동 입력 기록 보내기") {
                shareManualHistory()
            })
            actionMenuContainer.addView(button("직접 입력 설정 삭제") {
                confirmDisconnect()
            })
            actionMenuContainer.addView(button("설치·개인정보 설명서") {
                openGuide()
            })
        } else {
            actionMenuContainer.addView(button("일반은행 연결 (팝빌)", primary = true) {
                settingsContainer.visibility = View.GONE
                popbillConnectionContainer.visibility = View.VISIBLE
            })
            actionMenuContainer.addView(button("잔액 직접 입력") {
                startManualSetup()
            })
            actionMenuContainer.addView(button("설치·개인정보 설명서") {
                openGuide()
            })
        }
    }

    private fun changeFixedCostPaidStatus() {
        val state = repository.state()
        if (state.fixedCosts.isEmpty()) {
            toast("등록된 고정비가 없어요.")
            return
        }
        val active = SpendableCalculator.summary(state).fixedCostItems.map {
            StatusCandidate(
                fixedCostId = it.fixedCostId,
                name = it.name,
                amount = it.amount,
                period = it.period,
                label = "${if (it.overdue) "⚠ 미납 · " else ""}${periodLabel(it.period)} ${it.name} ${won(it.amount)}원",
            )
        }
        val resolved = state.fixedCosts.flatMap { cost ->
            cost.resolutions.map {
                StatusCandidate(
                    fixedCostId = cost.id,
                    name = cost.name,
                    amount = cost.amount,
                    period = it.period,
                    label = "${periodLabel(it.period)} ${cost.name} · ${if (it.status == "waived") "면제" else "납부완료"}",
                )
            }
        }
        val actions = arrayOf("납부 완료로 바꾸기", "이번 회차 면제하기", "납부·면제 기록 되돌리기")
        AlertDialog.Builder(this)
            .setTitle("고정비 납부상태")
            .setItems(actions) { _, action ->
                val candidates = if (action == 2) resolved else active
                if (candidates.isEmpty()) {
                    toast(if (action == 2) "되돌릴 기록이 없어요." else "현재 처리할 고정비 회차가 없어요.")
                    return@setItems
                }
                AlertDialog.Builder(this)
                    .setTitle("회차 선택")
                    .setItems(candidates.map { it.label }.toTypedArray()) { _, index ->
                        val status = when (action) {
                            0 -> "paid"
                            1 -> "waived"
                            else -> "unpaid"
                        }
                        updateFixedCostStatus(candidates[index], status)
                    }
                    .setNegativeButton("취소", null)
                    .show()
            }
            .setNegativeButton("취소", null)
            .show()
    }

    private data class StatusCandidate(
        val fixedCostId: String,
        val name: String,
        val amount: Long,
        val period: String,
        val label: String,
    )

    private fun updateFixedCostStatus(target: StatusCandidate, status: String) {
        val session = repository.apiSession()
        if (session == null) {
            val state = repository.state()
            if (state.balanceMode != "manual") {
                toast("잔액 설정을 다시 확인해 주세요.")
                return
            }
            if (status == "paid") {
                val balance = moneyInput("납부 후 은행 앱의 현재 잔액").apply {
                    setText(state.currentBalance?.toString().orEmpty())
                }
                AlertDialog.Builder(this)
                    .setTitle("납부 후 현재 잔액")
                    .setMessage("고정비 납부가 반영된 잔액을 입력해야 이중 차감을 막을 수 있어요.")
                    .setView(balance)
                    .setNegativeButton("취소", null)
                    .setPositiveButton("반영", null)
                    .create()
                    .also { dialog ->
                        dialog.setOnShowListener {
                            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                                val amount = parseBalance(balance.text.toString())
                                if (amount == null) {
                                    toast("납부 후 현재 잔액을 숫자로 입력해 주세요.")
                                } else {
                                    val updated = repository.updateManualFixedCostStatus(
                                        target.fixedCostId,
                                        target.period,
                                        status,
                                        amount,
                                    )
                                    load(updated)
                                    SseuldonWidget.update(this)
                                    dialog.dismiss()
                                    toast("납부 후 잔액과 납부완료를 함께 반영했어요.")
                                }
                            }
                        }
                        dialog.show()
                    }
            } else {
                val updated = repository.updateManualFixedCostStatus(
                    target.fixedCostId,
                    target.period,
                    status,
                )
                load(updated)
                SseuldonWidget.update(this)
                toast(if (status == "waived") "이번 회차를 면제했어요." else "다시 미납 상태로 바꿨어요.")
            }
            return
        }
        toast(if (status == "paid") "최신 잔액을 확인한 뒤 반영해요." else "납부상태를 바꾸고 있어요.")
        Thread {
            runCatching {
                SseuldonApiClient(session.apiBaseUrl).fixedCostStatus(
                    session,
                    target.fixedCostId,
                    target.period,
                    status,
                )
            }.onSuccess { response ->
                val updated = repository.applyApiBudget(response)
                runOnUiThread {
                    load(updated)
                    SseuldonWidget.update(this)
                    toast(
                        when (status) {
                            "paid" -> "최신 잔액 확인 후 납부완료로 반영했어요."
                            "waived" -> "이번 회차만 면제로 처리했어요."
                            else -> "다시 미납 상태로 바꿨어요."
                        },
                    )
                }
            }.onFailure { error ->
                runOnUiThread { toast(error.message ?: "납부상태를 바꾸지 못했어요.") }
            }
        }.start()
    }

    private fun showConnectionDetails() {
        val session = repository.apiSession()
        if (session == null) {
            val state = repository.state()
            if (state.balanceMode != "manual") {
                toast("설정된 잔액이 없어요.")
                return
            }
            AlertDialog.Builder(this)
                .setTitle("현재 방식 · 직접 입력")
                .setMessage(
                    "참여자 코드 ${state.participantCode}\n" +
                        "현재 잔액 ${won(state.currentBalance ?: 0)}원\n" +
                        "마지막 수정 ${time(state.syncedAt)}\n\n" +
                        "이 값은 이 휴대폰에만 암호화해 저장되며 자동으로 갱신되지 않아요.",
                )
                .setPositiveButton("확인", null)
                .show()
            return
        }
        val state = repository.state()
        AlertDialog.Builder(this)
            .setTitle("현재 연결")
            .setMessage(
                "팝빌 · ${session.bankName}\n" +
                    "${session.maskedAccountNumber.ifBlank { "계좌번호 숨김" }}\n\n" +
                    "마지막 정상 확인 ${time(state.syncedAt)}\n" +
                    state.lastResult,
            )
            .setPositiveButton("확인", null)
            .show()
    }

    private fun confirmDisconnect() {
        val manual = repository.apiSession() == null && repository.state().balanceMode == "manual"
        AlertDialog.Builder(this)
            .setTitle(if (manual) "직접 입력 설정 삭제" else "계좌 연결 해제")
            .setMessage(
                if (manual) "이 휴대폰에 저장된 잔액·고정비·입력 기록을 모두 삭제할까요?"
                else "자동 잔액조회 연결과 이 기기의 미리내 설정을 삭제할까요?",
            )
            .setNegativeButton("취소", null)
            .setPositiveButton(if (manual) "모두 삭제" else "연결 해제") { _, _ -> disconnectApi() }
            .show()
    }

    private fun openGuide() {
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(GUIDE_URL)))
    }

    private fun shareManualHistory() {
        val state = repository.state()
        if (state.balanceMode != "manual" || state.manualHistory.isEmpty()) {
            toast("보낼 수동 입력 기록이 없어요.")
            return
        }
        AlertDialog.Builder(this)
            .setTitle("수동 입력 기록 보내기")
            .setMessage(
                "참여자 코드, 입력시각, 직접 입력한 잔액, 남겨둔 고정비, 안전완충액, 사용가능액과 납부상태 변경 기록이 포함됩니다.\n\n" +
                    "계좌번호·비밀번호·거래 상대방은 포함되지 않습니다. 공유창에서 받을 사람을 직접 확인해 주세요.",
            )
            .setNegativeButton("취소", null)
            .setPositiveButton("내용 확인 후 공유") { _, _ ->
                val labels = mapOf(
                    "initial_balance" to "초기 잔액 입력",
                    "balance_update" to "현재 잔액 수정(이전 버전)",
                    "balance_correction" to "은행 잔액과 맞춤",
                    "income" to "입금",
                    "expense" to "지출",
                    "budget_update" to "고정비·완충액 설정",
                    "fixed_cost_paid" to "고정비 납부완료",
                    "fixed_cost_waived" to "고정비 면제",
                    "fixed_cost_unpaid" to "고정비 미납으로 되돌림",
                )
                val header = listOf(
                    "참여자코드", "입력시각", "기록유형", "금액변화", "현재잔액", "메모",
                    "남겨둔고정비", "안전완충액", "사용가능액", "고정비명", "회차",
                )
                val rows = state.manualHistory.map { entry ->
                    listOf(
                        state.participantCode,
                        isoTime(entry.at),
                        labels[entry.type] ?: entry.type,
                        entry.changeAmount,
                        entry.balanceAmount,
                        entry.memo,
                        entry.reservedFixedCosts,
                        entry.safetyBuffer,
                        entry.spendableAmount,
                        entry.fixedCostName,
                        entry.period,
                    )
                }
                val csv = (listOf(header) + rows).joinToString("\n") { row ->
                    row.joinToString(",") { csvCell(it) }
                }
                val intent = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_SUBJECT, "미리내 직접 입력 기록 · ${state.participantCode}")
                    putExtra(Intent.EXTRA_TEXT, "미리내 직접 입력 기록\n\n$csv")
                }
                startActivity(Intent.createChooser(intent, "수동 입력 기록 보내기"))
            }
            .show()
    }

    private fun showManualHistory() {
        val state = repository.state()
        if (state.balanceMode != "manual" || state.manualHistory.isEmpty()) {
            toast("아직 수동 입력 기록이 없어요.")
            return
        }
        val labels = mapOf(
            "initial_balance" to "초기 잔액",
            "balance_update" to "잔액 수정",
            "balance_correction" to "잔액 맞춤",
            "income" to "입금",
            "expense" to "지출",
            "budget_update" to "고정비 설정",
            "fixed_cost_paid" to "고정비 납부",
            "fixed_cost_waived" to "고정비 면제",
            "fixed_cost_unpaid" to "미납 되돌림",
        )
        val body = state.manualHistory.takeLast(30).asReversed().joinToString("\n\n") { entry ->
            val change = entry.changeAmount?.let {
                " · ${if (it >= 0) "+" else ""}${won(it)}원"
            }.orEmpty()
            val memo = entry.memo.takeIf(String::isNotBlank)?.let { " · $it" }.orEmpty()
            "${isoTime(entry.at)} · ${labels[entry.type] ?: entry.type}$change$memo\n" +
                "잔액 ${won(entry.balanceAmount ?: 0)}원 · 사용가능 ${won(entry.spendableAmount ?: 0)}원"
        }
        AlertDialog.Builder(this)
            .setTitle("최근 수동 기록 ${state.manualHistory.size}건")
            .setMessage(body)
            .setNegativeButton("닫기", null)
            .setPositiveButton("기록 공유") { _, _ -> shareManualHistory() }
            .show()
    }

    private fun refreshSummary(state: SseuldonState) {
        val summary = SpendableCalculator.summary(state)
        val icon = when (summary.riskLevel) {
            RiskLevel.SAFE -> "●"
            RiskLevel.CAUTION -> "▲"
            RiskLevel.DANGER -> "⚠"
            RiskLevel.CRITICAL -> "🚨"
        }
        val numberColor = riskColor(summary.riskScore)
        summaryCard.background = rounded(blend(Color.WHITE, numberColor, 0.12), 22)
        amountText.setTextColor(numberColor)
        detailText.setTextColor(Color.rgb(51, 35, 66))
        statusText.setTextColor(Color.rgb(88, 76, 99))
        amountText.text = when {
            summary.currentBalance == null -> "설정 필요"
            !summary.displayAmount -> "잔액 확인 필요"
            summary.spendableAmount < 0 -> "${won(summary.shortageAmount)}원 부족"
            else -> "${won(summary.spendableAmount)}원"
        }
        val firstOverdue = summary.fixedCostItems.firstOrNull { it.overdue }
        detailText.text = if (summary.overdueCount > 0) {
            "⚠ ${periodLabel(firstOverdue?.period.orEmpty())} ${firstOverdue?.name ?: "고정비"} 미납 · ${won(summary.overdueFixedCosts)}원"
        } else if (summary.riskLevel == RiskLevel.CRITICAL) {
            "$icon 미리 낼 돈이 ${won(summary.shortageAmount)}원 부족해요"
        } else {
            "$icon ${summary.riskLabel} · 미리 남긴 고정비 ${won(summary.reservedFixedCosts)}원"
        }
        detailText.setTextColor(
            if (summary.overdueCount > 0) Color.rgb(179, 19, 56) else Color.rgb(51, 35, 66),
        )
        val source = repository.apiSession()?.let {
            "팝빌 · ${it.bankName}"
        } ?: if (state.balanceMode == "manual") "직접 입력 · 기기 저장" else "계좌 연결 전"
        val fixedCostDay = summary.daysUntilNextFixedCost?.let {
            if (it == 0) "고정비 납부일" else "다음 고정비 D-$it"
        } ?: "예정 고정비 없음"
        val incomeDay = if (summary.incomeDateKnown) {
            if (summary.daysUntilIncome == 0) "소득 예상일" else "소득 예상 D-${summary.daysUntilIncome}"
        } else {
            "소득일 미정"
        }
        statusText.text = "$fixedCostDay · $incomeDay\n$source · ${state.lastResult} · ${time(state.syncedAt)}" +
            if (state.syncError.isBlank()) "" else "\n${state.syncError}"
    }

    private fun addCostRow(cost: FixedCost?) {
        val row = CostRow(cost)
        costRows.add(row)
        fixedCostsContainer.addView(row.container)
    }

    private inner class CostRow(cost: FixedCost?) {
        val container: LinearLayout
        private val original = cost
        private val name = input("이름 (예: 월세)")
        private val costAmount = moneyInput("금액")
        private val recurrence = Spinner(this@MainActivity).apply {
            adapter = ArrayAdapter(
                this@MainActivity,
                android.R.layout.simple_spinner_dropdown_item,
                listOf("매월 반복", "한 번만 납부"),
            )
        }
        private val dueDate = input("첫 납부일 (예: 2026-08-05)")

        init {
            val box = card()
            container = box
            box.apply {
                setPadding(dp(12), dp(12), dp(12), dp(12))
                name.setText(cost?.name.orEmpty())
                costAmount.setText(cost?.amount?.toString().orEmpty())
                recurrence.setSelection(if (cost?.recurrence == "once") 1 else 0)
                dueDate.setText(cost?.dueDate.orEmpty())
                addView(name)
                addView(costAmount)
                addView(recurrence)
                addView(dueDate)
                addView(text("매월 반복은 납부일 다음 날부터 다음 달 회차를 자동으로 남겨둬요.", 11f).apply {
                    setTextColor(Color.rgb(122, 111, 132))
                    setPadding(0, 0, 0, dp(6))
                })
                addView(button("이 고정비 삭제") {
                    costRows.remove(this@CostRow)
                    fixedCostsContainer.removeView(box)
                })
            }
        }

        fun value(): FixedCost? {
            val costName = name.text.toString().trim()
            val amount = amount(costAmount.text.toString())
            if (costName.isBlank() || amount <= 0) return null
            return FixedCost(
                id = original?.id ?: UUID.randomUUID().toString(),
                name = costName,
                amount = amount,
                dueDate = dueDate.text.toString().trim(),
                recurrence = if (recurrence.selectedItemPosition == 1) "once" else "monthly",
                resolutions = original?.resolutions.orEmpty(),
                keywords = emptyList(),
            )
        }

        fun hasAnyInput(): Boolean = name.text.toString().isNotBlank()
            || costAmount.text.toString().isNotBlank()
            || dueDate.text.toString().isNotBlank()
    }

    private fun sectionTitle(value: String) = text(value, 17f, true).apply {
        setTextColor(Color.rgb(51, 35, 66))
        setPadding(0, dp(24), 0, dp(8))
    }

    private fun input(hintValue: String) = EditText(this).apply {
        hint = hintValue
        textSize = 15f
        setPadding(dp(12), dp(12), dp(12), dp(12))
        background = rounded(Color.WHITE, 12)
        layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(8) }
    }

    private fun moneyInput(hintValue: String) = input(hintValue).apply {
        inputType = InputType.TYPE_CLASS_NUMBER
    }

    private fun secureInput(hintValue: String, numeric: Boolean) = input(hintValue).apply {
        inputType = (if (numeric) InputType.TYPE_CLASS_NUMBER else InputType.TYPE_CLASS_TEXT) or
            InputType.TYPE_TEXT_VARIATION_PASSWORD
    }

    private fun card() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        background = rounded(Color.WHITE, 18)
        layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(10) }
    }

    private fun button(label: String, primary: Boolean = false, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 14f
        setTextColor(if (primary) Color.WHITE else Color.rgb(74, 49, 99))
        background = rounded(if (primary) Color.rgb(107, 76, 138) else Color.WHITE, 12)
        setOnClickListener { action() }
        layoutParams = LinearLayout.LayoutParams(-1, dp(50)).apply { bottomMargin = dp(8) }
    }

    private fun text(value: String, size: Float, bold: Boolean = false) = TextView(this).apply {
        text = value
        textSize = size
        gravity = Gravity.START
        if (bold) setTypeface(typeface, Typeface.BOLD)
    }

    private fun rounded(color: Int, radius: Int) = android.graphics.drawable.GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(radius).toFloat()
    }

    private fun runNetwork(message: String, operation: () -> kr.sseuldon.app.remote.ConnectedApiAccount) {
        toast(message)
        Thread {
            runCatching(operation)
                .onSuccess(::saveConnectedAccount)
                .onFailure { error ->
                    runOnUiThread { toast(error.message ?: "계좌 연결에 실패했어요.") }
                }
        }.start()
    }

    private fun saveConnectedAccount(result: kr.sseuldon.app.remote.ConnectedApiAccount) {
        repository.saveApiSession(result.session)
        val updated = result.balancePayload?.let(repository::applyApiBalance)
            ?: repository.markFirstBalancePending()
        runOnUiThread {
            clearConnectionSecrets()
            load(updated)
            popbillConnectionContainer.visibility = View.GONE
            settingsContainer.visibility = View.VISIBLE
            SseuldonWidget.update(this)
            toast(
                if (result.balancePayload == null) {
                    "계좌는 연결됐어요. 첫 잔액을 확인하고 있어요."
                } else {
                    "연결됐어요. 잔액을 자동으로 확인합니다."
                },
            )
        }
    }

    private fun disconnectApi() {
        val session = repository.apiSession()
        if (session == null) {
            repository.clearAll()
            load(SseuldonState())
            toast("기기에 저장된 정보를 지웠어요.")
            return
        }
        Thread {
            runCatching { SseuldonApiClient(session.apiBaseUrl).disconnect(session) }
                .onSuccess {
                    repository.clearAll()
                    runOnUiThread {
                        load(SseuldonState())
                        settingsContainer.visibility = View.GONE
                        popbillConnectionContainer.visibility = View.GONE
                        SseuldonWidget.update(this)
                        toast("연결과 저장 정보를 삭제했어요.")
                    }
                }
                .onFailure { error ->
                    runOnUiThread { toast(error.message ?: "연결 해제를 완료하지 못했어요.") }
                }
        }.start()
    }

    private fun clearConnectionSecrets() {
        listOf(
            accountNumberInput,
            accountPasswordInput,
            birthDateInput,
            bankIdInput,
            fastIdInput,
            fastPasswordInput,
        ).forEach { it.setText("") }
        privacyCheck.isChecked = false
    }

    private fun showPrivacyDetails() {
        val manual = repository.apiSession() == null && repository.state().balanceMode == "manual"
        AlertDialog.Builder(this)
            .setTitle("개인정보 처리")
            .setMessage(
                if (manual) {
                    "직접 입력 모드는 참여자 코드, 직접 입력한 잔액과 수정시각, 고정비·소득일·완충액, 고정비 상태변경 기록을 이 Android 기기의 암호화 저장소에만 보관합니다.\n\n" +
                        "계좌번호·비밀번호·생년월일·거래 상대방은 입력하거나 저장하지 않습니다. 서버와 팝빌로 수동 입력 기록을 자동 전송하지 않습니다.\n\n" +
                        "‘수동 입력 기록 보내기’를 누른 경우에만 공유할 내용과 받을 사람을 참여자가 직접 확인해 전송합니다. ‘직접 입력 설정 삭제’를 누르면 기기에 저장된 잔액·설정·기록을 삭제합니다."
                } else {
                    "저장: 암호화된 연결정보(일반은행은 조회에 필요한 계좌번호 포함), 마지막 정상 잔액·동기화 시각, 고정비·소득일·완충액\n\n" +
                    "미저장: 계좌 비밀번호·생년월일·조회전용 비밀번호, 입출금·거래내역 원문, 통장 캡처\n\n" +
                    "미리내는 다른 앱의 알림을 읽지 않으며 알림 접근 권한을 요구하지 않습니다. 이번 파일럿은 팝빌 지원 일반은행만 연결합니다.\n\n" +
                    "담당자용 화면에는 개인 잔액과 거래내역이 없습니다. 서버 운영자는 암호화 파일과 별도 키를 모두 가진 경우에만 장애 대응을 위해 복호화할 수 있습니다.\n\n" +
                    "연결 해제 시 외부 조회 해지를 요청한 뒤 현재 운영 저장본에서 제거합니다. 연결자료는 연구 파일럿과 종료 정리를 위해 최대 70일 보관한 뒤 만료 처리에 들어가며, 팝빌 해지가 실패하면 안전한 해지를 다시 시도하기 위해 암호화 상태로 남을 수 있어 운영진이 확인해야 합니다. 팝빌 자체 보관자료의 삭제 시점은 팝빌 계약·정책 안내를 따릅니다."
                },
            )
            .setPositiveButton("확인", null)
            .show()
    }

    private fun blend(start: Int, end: Int, amount: Double): Int {
        val value = amount.coerceIn(0.0, 1.0)
        fun channel(a: Int, b: Int) = (a + (b - a) * value).toInt()
        return Color.rgb(
            channel(Color.red(start), Color.red(end)),
            channel(Color.green(start), Color.green(end)),
            channel(Color.blue(start), Color.blue(end)),
        )
    }

    private fun riskColor(score: Double): Int =
        if (score < 0.55) {
            blend(Color.rgb(76, 82, 164), Color.rgb(137, 58, 117), score / 0.55)
        } else {
            blend(Color.rgb(137, 58, 117), Color.rgb(196, 38, 58), (score - 0.55) / 0.45)
        }

    private fun amount(value: String): Long = value.replace(Regex("""[^0-9-]"""), "").toLongOrNull()?.coerceAtLeast(0) ?: 0
    private fun parseBalance(value: String): Long? {
        val digits = value.replace(Regex("""[^0-9]"""), "")
        return digits.takeIf(String::isNotBlank)?.toLongOrNull()
    }
    private fun csvCell(value: Any?): String = "\"${(value ?: "").toString().replace("\"", "\"\"")}\""
    private fun isoTime(value: Long): String =
        SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.KOREA).format(Date(value))
    private fun validDate(value: String): Boolean {
        if (!value.matches(Regex("""\d{4}-\d{2}-\d{2}"""))) return false
        return runCatching {
            SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { isLenient = false }.parse(value)
        }.getOrNull() != null
    }

    private fun nextDateForDay(day: Int): String {
        val korea = TimeZone.getTimeZone("Asia/Seoul")
        val now = Calendar.getInstance(korea)
        fun candidate(year: Int, month: Int): String {
            val calendar = Calendar.getInstance(korea).apply {
                clear()
                set(Calendar.YEAR, year)
                set(Calendar.MONTH, month)
                set(Calendar.DAY_OF_MONTH, 1)
            }
            val actualDay = day.coerceAtMost(calendar.getActualMaximum(Calendar.DAY_OF_MONTH))
            return "%04d-%02d-%02d".format(Locale.US, year, month + 1, actualDay)
        }
        val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = korea }.format(now.time)
        val current = candidate(now.get(Calendar.YEAR), now.get(Calendar.MONTH))
        if (current >= today) return current
        now.add(Calendar.MONTH, 1)
        return candidate(now.get(Calendar.YEAR), now.get(Calendar.MONTH))
    }

    private fun periodLabel(value: String): String {
        if (!value.matches(Regex("""\d{4}-\d{2}"""))) return value.ifBlank { "이번 회차" }
        return "${value.take(4)}년 ${value.takeLast(2).toInt()}월"
    }

    private fun won(value: Long): String = NumberFormat.getNumberInstance(Locale.KOREA).format(value)
    private fun time(value: Long): String = SimpleDateFormat("M/d HH:mm", Locale.KOREA).format(Date(value))
    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
    private fun toast(value: String) = Toast.makeText(this, value, Toast.LENGTH_SHORT).show()

    companion object {
        private const val GUIDE_URL = "https://sseudon-demo-2026.boogieee.chatgpt.site/guide"
        private val POPBILL_BANKS = listOf(
            "0002" to "산업은행", "0003" to "기업은행", "0004" to "국민은행",
            "0007" to "수협은행", "0011" to "NH농협은행", "0020" to "우리은행",
            "0023" to "SC제일은행", "0027" to "한국씨티은행", "0031" to "iM뱅크",
            "0032" to "부산은행", "0034" to "광주은행", "0035" to "제주은행",
            "0037" to "전북은행", "0039" to "경남은행", "0045" to "새마을금고",
            "0048" to "신협", "0071" to "우체국", "0081" to "하나은행",
            "0088" to "신한은행",
        )
    }
}
