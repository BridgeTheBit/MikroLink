package com.mikrolink.app

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.URI
import java.net.URL
import javax.net.ssl.HttpsURLConnection

data class LoginSession(val baseUrl: String, val token: String, val expiresAt: String)
data class VpnProfile(val id: String, val name: String, val protocol: String, val description: String)
data class VpnLease(
    val id: String,
    val protocol: String,
    val configuration: JSONObject,
    val expiresAt: String,
    val releaseToken: String
)

class ApiException(message: String, val status: Int = 0) : IOException(message)

/** Only HTTPS with ordinary platform certificate validation is accepted. */
class ApiClient private constructor(private val baseUrl: String) {
    companion object {
        fun fromUserInput(value: String): ApiClient {
            val uri = try { URI(value.trim()) } catch (_: Exception) {
                throw ApiException("نشانی سرور معتبر نیست")
            }
            if (uri.scheme?.lowercase() != "https" || uri.host.isNullOrBlank() ||
                uri.rawUserInfo != null || uri.rawQuery != null || uri.rawFragment != null ||
                (uri.path != "" && uri.path != "/")) {
                throw ApiException("نشانی باید به شکل https://example.com باشد")
            }
            return ApiClient("https://${uri.rawAuthority}")
        }
    }

    fun login(username: String, password: String): LoginSession {
        val body = JSONObject().put("username", username).put("password", password)
        val result = request("POST", "/v1/auth/login", null, body) as JSONObject
        return LoginSession(baseUrl, result.getString("token"), result.optString("expiresAt"))
    }

    fun configs(token: String): List<VpnProfile> {
        val items = request("GET", "/v1/configs", token, null) as JSONArray
        return (0 until items.length()).map { index ->
            val item = items.getJSONObject(index)
            VpnProfile(
                item.getString("id"), item.getString("name"),
                item.getString("protocol").lowercase(), item.optString("description")
            )
        }
    }

    fun lease(token: String, profileId: String, deviceId: String, publicKey: String?): VpnLease {
        val body = JSONObject().put("deviceId", deviceId)
        if (publicKey != null) body.put("publicKey", publicKey)
        val result = request("POST", "/v1/configs/${safeId(profileId)}/lease", token, body) as JSONObject
        return VpnLease(
            result.getString("id"), result.getString("protocol").lowercase(),
            result.getJSONObject("configuration"), result.getString("expiresAt"),
            result.getString("releaseToken")
        )
    }

    fun release(lease: VpnLease) {
        request("DELETE", "/v1/leases/${safeId(lease.id)}", lease.releaseToken, null, "Lease")
    }

    private fun safeId(id: String): String {
        if (!id.matches(Regex("[A-Za-z0-9_-]{1,128}"))) throw ApiException("شناسه نامعتبر است")
        return id
    }

    private fun request(method: String, path: String, token: String?, body: JSONObject?, scheme: String = "Bearer"): Any {
        val conn = URL(baseUrl + path).openConnection() as HttpsURLConnection
        conn.requestMethod = method
        conn.connectTimeout = 10_000
        conn.readTimeout = 15_000
        conn.instanceFollowRedirects = false
        conn.setRequestProperty("Accept", "application/json")
        if (token != null) conn.setRequestProperty("Authorization", "$scheme $token")
        if (body != null) {
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        }
        try {
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (code !in 200..299) {
                val message = try { JSONObject(text).optString("error") } catch (_: Exception) { "" }
                throw ApiException(if (message.isBlank()) "خطای سرور ($code)" else message, code)
            }
            if (text.isBlank()) return JSONObject()
            return if (text.trimStart().startsWith("[")) JSONArray(text) else JSONObject(text)
        } finally {
            conn.disconnect()
        }
    }
}
