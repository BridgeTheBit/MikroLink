package com.mikrolink.app

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.VpnService
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ImageView
import android.widget.ScrollView
import android.widget.TextView
import com.wireguard.android.backend.Tunnel
import com.wireguard.crypto.KeyPair
import java.time.Instant
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private val app get() = application as MikroLinkApplication
    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val ikeEngine by lazy { StrongSwanIkeEngine(applicationContext) }
    private lateinit var content: LinearLayout
    private lateinit var status: TextView
    private var profiles: List<VpnProfile> = emptyList()
    private var busy = false
    private var pendingWgProfile: VpnProfile? = null
    private var pendingIkeProfile: VpnProfile? = null

    private val background = 0xff071421.toInt()
    private val ink = 0xfff4f8ff.toInt()
    private val muted = 0xff9eb2c9.toInt()
    private val blue = 0xff5b8cff.toInt()
    private val accent = 0xff2de2c5.toInt()
    private val surface = 0xff13283a.toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = 0xff030a12.toInt()
        window.navigationBarColor = 0xff030a12.toInt()
        window.decorView.layoutDirection = View.LAYOUT_DIRECTION_RTL
        val scroll = ScrollView(this).apply {
            setBackgroundResource(R.drawable.mikrolink_background)
            isFillViewport = true
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(30), dp(22), dp(34))
        }
        scroll.addView(content)
        setContentView(scroll)
        ikeEngine.observe { connection ->
            runOnUiThread {
                if (app.activeVpn?.profile?.protocol == "ikev2") setStatus(connection.message)
            }
        }
        if (app.session == null) renderLogin() else {
            renderCatalog()
            refresh()
        }
        if (app.activeVpn == null) recoverPreviousLease()
    }

    override fun onResume() {
        super.onResume()
        val active = app.activeVpn
        if (active?.tunnel != null && app.wireGuard.getState(active.tunnel) == Tunnel.State.DOWN) {
            app.activeVpn = null
            TunnelForegroundService.stop(this)
            releaseLater(active.lease)
            if (::content.isInitialized) renderCatalog()
            setStatus("اتصال VPN توسط سیستم قطع شد.")
            return
        }
    }

    override fun onDestroy() {
        ikeEngine.close()
        worker.shutdown()
        super.onDestroy()
    }

    private fun renderLogin() {
        content.removeAllViews()
        heading("MikroLink")
        body("برای دیدن VPNهای مجاز، نشانی سرور و حساب خود را وارد کنید.")
        val url = input("نشانی سایت (https://example.com)", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI)
        val username = input("نام کاربری", InputType.TYPE_CLASS_TEXT)
        val password = input("رمز عبور", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
        val button = action("ورود") {
            if (busy) return@action
            val address = url.text.toString().trim()
            val user = username.text.toString().trim()
            val pass = password.text.toString()
            if (user.isBlank() || pass.isBlank()) {
                setStatus("نام کاربری و رمز عبور را وارد کنید.")
                return@action
            }
            busy = true
            setStatus("در حال ورود...")
            async({
                val api = ApiClient.fromUserInput(address)
                val session = api.login(user, pass)
                Triple(api, session, api.configs(session.token))
            }) { result ->
                busy = false
                result.onSuccess { (api, session, list) ->
                    app.api = api
                    app.session = session
                    profiles = list
                    password.text.clear()
                    renderCatalog()
                }.onFailure { setStatus(friendlyError(it)) }
            }
        }
        button.isAllCaps = false
        content.addView(button)
        if (app.activeVpn != null) content.addView(action("قطع اتصال IKEv2 قبلی") { disconnect() })
        status = statusView()
    }

    private fun renderCatalog() {
        content.removeAllViews()
        heading("MikroLink")
        body("کانفیگ‌هایی که برای حساب شما مجاز شده‌اند")
        status = statusView()
        val active = app.activeVpn
        if (active != null) {
            val box = card()
            box.addView(label("اتصال فعلی: ${active.profile.name}", 19f, ink, true))
            box.addView(label("${protocolTitle(active.profile.protocol)} · اعتبار تا ${active.lease.expiresAt}", 13f, muted))
            box.addView(action("قطع اتصال") { disconnect() })
            if (active.profile.protocol == "ikev2") updateIkeStatus()
            else setStatus("تونل WireGuard فعال است؛ در حال بررسی پاسخ سرور.")
        }
        if (profiles.isEmpty()) body("فعلاً کانفیگ مجازی برای شما ثبت نشده است.")
        for (profile in profiles) {
            val box = card()
            box.addView(label(profile.name, 18f, ink, true))
            box.addView(label(protocolTitle(profile.protocol), 14f, blue, true))
            if (profile.description.isNotBlank()) box.addView(label(profile.description, 13f, muted))
            val availability = availability(profile.protocol)
            if (availability != null) box.addView(label(availability, 12f, muted))
            val button = action(if (active?.profile?.id == profile.id) "در حال استفاده" else "اتصال") {
                beginConnect(profile)
            }
            button.isEnabled = !busy && active == null && availability == null
            box.addView(button)
        }
        content.addView(action("به‌روزرسانی لیست") { refresh() })
        content.addView(action("خروج از حساب") {
            if (busy) setStatus("لطفاً تا پایان عملیات صبر کنید.")
            else if (app.activeVpn != null) setStatus("ابتدا اتصال را قطع کنید.")
            else {
                app.session = null
                app.api = null
                profiles = emptyList()
                renderLogin()
            }
        })
    }

    private fun availability(protocol: String): String? = when (protocol) {
        "wireguard" -> null
        "ikev2" -> null
        "openvpn" -> "موتور OpenVPN هنوز به این نسخه از برنامه وصل نشده است."
        else -> "پروتکل ناشناخته است."
    }

    private fun beginConnect(profile: VpnProfile) {
        if (busy || app.activeVpn != null) return
        availability(profile.protocol)?.let { setStatus(it); return }
        if (profile.protocol == "wireguard" || profile.protocol == "ikev2") {
            val permission = VpnService.prepare(this)
            if (permission != null) {
                if (profile.protocol == "wireguard") {
                    pendingWgProfile = profile
                    startActivityForResult(permission, REQUEST_WG_VPN)
                } else {
                    pendingIkeProfile = profile
                    startActivityForResult(permission, REQUEST_IKE_VPN)
                }
                return
            }
        }
        fetchLease(profile)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            REQUEST_WG_VPN -> {
                val profile = pendingWgProfile
                pendingWgProfile = null
                if (resultCode == RESULT_OK && profile != null) fetchLease(profile)
                else setStatus("اجازهٔ VPN داده نشد.")
            }
            REQUEST_IKE_VPN -> {
                val profile = pendingIkeProfile
                pendingIkeProfile = null
                if (resultCode == RESULT_OK && profile != null) fetchLease(profile)
                else {
                    setStatus("اجازهٔ VPN داده نشد.")
                }
            }
        }
    }

    private fun fetchLease(profile: VpnProfile) {
        val api = app.api ?: return
        val session = app.session ?: return
        val pair = if (profile.protocol == "wireguard") KeyPair() else null
        busy = true
        setStatus("در حال دریافت مجوز اتصال...")
        async({
            api.lease(session.token, profile.id, app.deviceId, pair?.publicKey?.toBase64())
        }) { result ->
            busy = false
            result.onSuccess { lease ->
                try {
                    app.leaseRecovery.save(session.baseUrl, profile, lease)
                } catch (e: Exception) {
                    releaseLater(lease, session.baseUrl)
                    setStatus(friendlyError(e))
                    return@onSuccess
                }
                if (lease.protocol != profile.protocol) {
                    releaseLater(lease)
                    setStatus("پروتکل پاسخ سرور با کانفیگ انتخابی یکی نیست.")
                } else if (pair != null) {
                    startWireGuard(profile, lease, pair)
                } else if (profile.protocol == "ikev2") {
                    startIkeSession(profile, lease)
                } else {
                    releaseLater(lease)
                    setStatus("موتور این پروتکل در دسترس نیست.")
                }
            }.onFailure { setStatus(friendlyError(it)) }
        }
    }

    private fun startWireGuard(profile: VpnProfile, lease: VpnLease, pair: KeyPair) {
        busy = true
        setStatus("در حال راه‌اندازی WireGuard...")
        try {
            TunnelForegroundService.start(this)
        } catch (e: Exception) {
            busy = false
            releaseLater(lease)
            setStatus(friendlyError(e))
            return
        }
        async({
            val config = WireGuardEngine.makeConfig(lease.configuration, pair)
            val tunnel = NamedTunnel("mikrolink")
            val state = app.wireGuard.setState(tunnel, Tunnel.State.UP, config)
            if (state != Tunnel.State.UP) error("تونل فعال نشد")
            tunnel
        }) { result ->
            busy = false
            result.onSuccess { tunnel ->
                app.activeVpn = ActiveVpn(profile, lease, tunnel, app.session!!.baseUrl)
                renderCatalog()
                setStatus("تونل فعال شد؛ در حال بررسی handshake سرور...")
                checkWireGuardHandshake(tunnel, 0)
                scheduleExpiry(lease)
            }.onFailure {
                TunnelForegroundService.stop(this)
                releaseLater(lease)
                setStatus(friendlyError(it))
            }
        }
    }

    private fun checkWireGuardHandshake(tunnel: NamedTunnel, attempt: Int) {
        if (app.activeVpn?.tunnel !== tunnel) return
        async({
            val stats = app.wireGuard.getStatistics(tunnel)
            stats.peers().any { peer -> (stats.peer(peer)?.latestHandshakeEpochMillis() ?: 0L) > 0L }
        }) { result ->
            if (app.activeVpn?.tunnel !== tunnel) return@async
            when {
                result.getOrDefault(false) -> setStatus("WireGuard متصل است.")
                attempt < 16 -> main.postDelayed({ checkWireGuardHandshake(tunnel, attempt + 1) }, 3_000)
                else -> setStatus("تونل فعال است، اما هنوز پاسخی از سرور ثبت نشده است.")
            }
        }
    }

    private fun startIkeSession(profile: VpnProfile, lease: VpnLease) {
        busy = true
        setStatus("در حال راه‌اندازی IKEv2 با strongSwan…")
        async({ ikeEngine.connect(profile, lease) }) { result ->
            busy = false
            result.onSuccess {
                app.activeVpn = ActiveVpn(profile, lease, null, app.session!!.baseUrl)
                renderCatalog()
                setStatus("IKEv2 در حال اتصال است…")
                scheduleExpiry(lease)
            }.onFailure {
                releaseLater(lease)
                setStatus(friendlyError(it))
            }
        }
    }

    private fun updateIkeStatus() {
        setStatus("وضعیت IKEv2 از موتور strongSwan دریافت می‌شود.")
    }

    private fun disconnect() {
        val active = app.activeVpn ?: return
        if (busy) return
        busy = true
        setStatus("در حال قطع اتصال...")
        async({
            if (active.tunnel != null) app.wireGuard.setState(active.tunnel, Tunnel.State.DOWN, null)
            else if (active.profile.protocol == "ikev2") ikeEngine.disconnect(active.profile.id)
            runCatching { ApiClient.fromUserInput(active.baseUrl).release(active.lease) }
                .onSuccess { app.leaseRecovery.clearIfLease(active.lease.id) }
                .exceptionOrNull()
        }) { result ->
            busy = false
            result.onSuccess { releaseError ->
                app.activeVpn = null
                TunnelForegroundService.stop(this)
                if (app.session == null) renderLogin() else renderCatalog()
                setStatus(if (releaseError == null) "اتصال قطع شد." else "اتصال قطع شد؛ آزادسازی مجوز روی سرور انجام نشد.")
            }.onFailure { setStatus(friendlyError(it)) }
        }
    }

    private fun scheduleExpiry(lease: VpnLease) {
        val wait = runCatching { Instant.parse(lease.expiresAt).toEpochMilli() - System.currentTimeMillis() }
            .getOrDefault(0L).coerceAtLeast(0L)
        main.postDelayed({
            if (app.activeVpn?.lease?.id == lease.id) {
                setStatus("اعتبار اتصال پایان یافت.")
                disconnect()
            }
        }, wait)
    }

    private fun refresh() {
        val api = app.api ?: return
        val session = app.session ?: return
        if (busy) return
        busy = true
        setStatus("در حال به‌روزرسانی...")
        async({ api.configs(session.token) }) { result ->
            busy = false
            result.onSuccess {
                profiles = it
                renderCatalog()
                setStatus("لیست به‌روز شد.")
            }.onFailure { setStatus(friendlyError(it)) }
        }
    }

    private fun releaseLater(lease: VpnLease, baseUrl: String? = app.session?.baseUrl) {
        val origin = baseUrl ?: runCatching { app.leaseRecovery.read()?.baseUrl }.getOrNull() ?: return
        worker.execute {
            runCatching { ApiClient.fromUserInput(origin).release(lease) }
                .onSuccess { app.leaseRecovery.clearIfLease(lease.id) }
        }
    }

    private fun recoverPreviousLease() {
        val saved = runCatching { app.leaseRecovery.read() }.getOrNull() ?: return
        if (saved.profile.protocol != "ikev2") {
            releaseLater(saved.lease, saved.baseUrl)
            return
        }
        val expired = runCatching { Instant.parse(saved.lease.expiresAt).toEpochMilli() <= System.currentTimeMillis() }
            .getOrDefault(true)
        if (expired) {
            runCatching { ikeEngine.disconnect(saved.profile.id) }
            releaseLater(saved.lease, saved.baseUrl)
            return
        }
        app.activeVpn = ActiveVpn(saved.profile, saved.lease, null, saved.baseUrl)
        if (app.session == null) renderLogin() else renderCatalog()
        setStatus("اتصال IKEv2 قبلی بازیابی شد؛ وضعیت از strongSwan دریافت می‌شود.")
        scheduleExpiry(saved.lease)
    }

    private fun <T> async(work: () -> T, done: (Result<T>) -> Unit) {
        worker.execute {
            val result = runCatching(work)
            runOnUiThread { if (!isFinishing && !isDestroyed) done(result) }
        }
    }

    private fun friendlyError(error: Throwable): String = when (error) {
        is ApiException -> error.message ?: "خطای ارتباط با سرور"
        else -> error.message?.take(180) ?: "عملیات انجام نشد."
    }

    private fun protocolTitle(protocol: String): String = when (protocol) {
        "wireguard" -> "WireGuard"
        "openvpn" -> "OpenVPN"
        "ikev2" -> "IKEv2/IPsec"
        else -> protocol
    }

    private fun heading(text: String) {
        val hero = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(14), dp(14), dp(14))
            background = GradientDrawable().apply {
                cornerRadius = dp(20).toFloat()
                setColor(0x33243f5d)
                setStroke(dp(1), 0x665b8cff)
            }
        }
        val mark = ImageView(this).apply {
            setImageResource(R.drawable.ic_mikrolink_mark)
            layoutParams = LinearLayout.LayoutParams(dp(54), dp(54)).apply { marginEnd = dp(12) }
            contentDescription = "MikroLink"
        }
        val copy = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.RIGHT }
        copy.addView(label(text, 27f, ink, true).apply { setPadding(0, 0, 0, 0) })
        copy.addView(label("SECURE VPN CONTROL", 11f, accent, true).apply { setPadding(0, dp(3), 0, 0); letterSpacing = 0.12f })
        hero.addView(mark)
        hero.addView(copy, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        content.addView(hero, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(18) })
    }

    private fun body(text: String) {
        content.addView(label(text, 15f, muted).apply { setPadding(0, 0, 0, dp(18)) })
    }

    private fun label(text: String, size: Float, color: Int, bold: Boolean = false): TextView =
        TextView(this).apply {
            this.text = text
            textSize = size
            setTextColor(color)
            if (bold) setTypeface(typeface, Typeface.BOLD)
            gravity = Gravity.RIGHT
            setPadding(0, dp(3), 0, dp(3))
        }

    private fun input(hint: String, type: Int): EditText = EditText(this).also {
        it.hint = hint
        it.inputType = type
        it.textDirection = if (hint.contains("نشانی")) View.TEXT_DIRECTION_LTR else View.TEXT_DIRECTION_RTL
        it.setSingleLine(true)
        it.setTextColor(ink)
        it.setHintTextColor(muted)
        it.textSize = 15f
        it.setPadding(dp(14), 0, dp(14), 0)
        it.background = GradientDrawable().apply {
            cornerRadius = dp(14).toFloat()
            setColor(0x66243f5d)
            setStroke(dp(1), 0x665b8cff)
        }
        val params = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(54))
        params.bottomMargin = dp(12)
        content.addView(it, params)
    }

    private fun action(text: String, click: () -> Unit): Button = Button(this).apply {
        this.text = text
        isAllCaps = false
        setTextColor(0xff06111d.toInt())
        textSize = 15f
        typeface = Typeface.DEFAULT_BOLD
        stateListAnimator = null
        background = GradientDrawable().apply {
            cornerRadius = dp(12).toFloat()
            setColor(accent)
        }
        setOnClickListener { click() }
        val params = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48))
        params.topMargin = dp(10)
        layoutParams = params
    }

    private fun card(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(16), dp(14), dp(16), dp(14))
        background = GradientDrawable().apply {
            cornerRadius = dp(16).toFloat()
            setColor(surface)
            setStroke(dp(1), 0x664b6a86)
        }
        val params = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        params.bottomMargin = dp(12)
        content.addView(this, params)
    }

    private fun statusView(): TextView = label("", 14f, ink).apply {
        setPadding(0, dp(8), 0, dp(16))
        content.addView(this)
    }

    private fun setStatus(message: String) { if (::status.isInitialized) status.text = message }
    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    companion object {
        private const val REQUEST_WG_VPN = 100
        private const val REQUEST_IKE_VPN = 101
    }
}
