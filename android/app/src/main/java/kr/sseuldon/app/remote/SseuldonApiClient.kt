package kr.sseuldon.app.remote

import kr.sseuldon.app.BuildConfig
import kr.sseuldon.app.domain.ApiSession
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class ConnectedApiAccount(
    val session: ApiSession,
    val balancePayload: JSONObject?,
)

class SseuldonApiClient(
    private val apiBaseUrl: String = BuildConfig.API_BASE_URL.trimEnd('/'),
) {
    fun ensurePilotReady() {
        val health = request("/health")
        val isTest = BuildConfig.API_CHANNEL == "test"
        val ready = if (isTest) health.optBoolean("testReady") else health.optBoolean("pilotReady")
        if (
            health.optString("status") != "ok" ||
            !health.optBoolean("persistentStore") ||
            !ready
        ) {
            throw IllegalStateException("미리내 운영 서버가 아직 참가자 연결 준비 중이에요.")
        }
        val mode = health.optJSONObject("providers")?.optString("popbill")
        val expectedMode = if (isTest) "test" else "production"
        if (mode != expectedMode) {
            throw IllegalStateException("팝빌 ${if (isTest) "테스트" else "운영"} 연결이 아직 준비되지 않았어요.")
        }
    }

    fun connectPopbill(
        inviteCode: String,
        bankCode: String,
        accountNumber: String,
        accountPassword: String,
        birthDate: String,
        accountName: String,
        bankId: String,
        fastId: String,
        fastPassword: String,
    ): ConnectedApiAccount {
        ensurePilotReady()
        val request = JSONObject()
            .put("inviteCode", inviteCode)
            .put("bankCode", bankCode)
            .put("accountNumber", accountNumber.filter(Char::isDigit))
            .put("accountPassword", accountPassword.filter(Char::isDigit))
            .put("identityNumber", birthDate.filter(Char::isDigit))
            .put("accountName", accountName.ifBlank { "생활비 계좌" })
            .put("consent", true)
        if (bankId.isNotBlank()) request.put("bankId", bankId.trim())
        if (fastId.isNotBlank()) request.put("fastId", fastId.trim())
        if (fastPassword.isNotBlank()) request.put("fastPassword", fastPassword)
        val response = request("/auth/popbill/connect", "POST", request)
        return connected(response)
    }

    fun balance(session: ApiSession, force: Boolean): JSONObject {
        return request(
            path = "/api/balance${if (force) "?force=true" else ""}",
            token = session.sessionToken,
        )
    }

    fun budget(session: ApiSession): JSONObject =
        request("/api/budget", token = session.sessionToken)

    fun saveBudget(session: ApiSession, budget: JSONObject): JSONObject =
        request("/api/budget", "PUT", budget, session.sessionToken)

    fun fixedCostStatus(
        session: ApiSession,
        fixedCostId: String,
        period: String,
        status: String,
    ): JSONObject = request(
        "/api/fixed-cost-status",
        "POST",
        JSONObject()
            .put("fixedCostId", fixedCostId)
            .put("period", period)
            .put("status", status),
        session.sessionToken,
    )

    fun disconnect(session: ApiSession) {
        request("/api/connection/disconnect", "POST", JSONObject(), session.sessionToken, expectEmpty = true)
    }

    private fun connected(response: JSONObject): ConnectedApiAccount {
        val account = response.getJSONObject("account")
        val payload = response.optJSONObject("balance")?.let { balance ->
            JSONObject().put("balance", balance)
                .put("cached", response.optBoolean("cached", false))
                .put("displayAmount", response.optBoolean("displayAmount", true))
                .also {
                    if (response.has("warning")) it.put("warning", response.getString("warning"))
                }
        }
        return ConnectedApiAccount(
            session = ApiSession(
                apiBaseUrl = apiBaseUrl,
                sessionToken = response.getString("sessionToken"),
                provider = account.optString("provider", "popbill"),
                bankName = account.getString("bankName"),
                maskedAccountNumber = account.getString("maskedAccountNumber"),
            ),
            balancePayload = payload,
        )
    }

    private fun request(
        path: String,
        method: String = "GET",
        body: JSONObject? = null,
        token: String? = null,
        expectEmpty: Boolean = false,
    ): JSONObject {
        val connection = (URL("$apiBaseUrl$path").openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15_000
            readTimeout = 60_000
            setRequestProperty("Accept", "application/json")
            if (token != null) setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
        }
        return try {
            if (body != null) {
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            if (expectEmpty && status == 204) return JSONObject()
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            val response = if (text.isBlank()) JSONObject() else JSONObject(text)
            if (status !in 200..299) {
                val message = response.optJSONObject("error")?.optString("message")
                    ?: "계좌 서버 요청에 실패했어요. ($status)"
                throw IllegalStateException(message)
            }
            response
        } finally {
            connection.disconnect()
        }
    }
}
