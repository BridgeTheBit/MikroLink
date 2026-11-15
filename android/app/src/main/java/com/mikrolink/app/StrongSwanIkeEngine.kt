package com.mikrolink.app

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import org.strongswan.android.data.VpnProfileDataSource
import org.strongswan.android.data.VpnProfileSqlDataSource
import org.strongswan.android.data.VpnType
import org.strongswan.android.logic.CharonVpnService
import org.strongswan.android.logic.VpnStateService
import java.nio.charset.StandardCharsets
import java.util.UUID

enum class IkeConnectionState { DISCONNECTED, CONNECTING, CONNECTED, DISCONNECTING, FAILED }

data class IkeConnectionStatus(val state: IkeConnectionState, val message: String)

/**
 * Host adapter around strongSwan's in-process Android frontend.
 *
 * The server password is passed directly to CharonVpnService and is never
 * written to strongSwan's profile database. Only non-secret profile metadata
 * required by the native service is persisted.
 */
class StrongSwanIkeEngine(context: Context) : VpnStateService.VpnStateListener {
    private val appContext = context.applicationContext
    private var stateService: VpnStateService? = null
    private var observer: ((IkeConnectionStatus) -> Unit)? = null
    private var bound = false

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            val service = (binder as? VpnStateService.LocalBinder)?.service ?: return
            stateService = service
            service.registerListener(this@StrongSwanIkeEngine)
            publishState()
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            stateService = null
            publish(IkeConnectionState.DISCONNECTED, "سرویس IKEv2 در دسترس نیست.")
        }
    }

    fun observe(callback: (IkeConnectionStatus) -> Unit) {
        observer = callback
        if (!bound) {
            bound = appContext.bindService(
                Intent(appContext, VpnStateService::class.java),
                serviceConnection,
                Context.BIND_AUTO_CREATE
            )
        }
        publishState()
    }

    fun connect(profile: VpnProfile, lease: VpnLease) {
        val config = lease.configuration
        val customCa = config.optString("caCertificatePem").takeIf { it.isNotBlank() }
        require(customCa == null) {
            "این نسخه برای IKEv2 به گواهی عمومی معتبر نیاز دارد؛ CA خصوصی هنوز قابل استفاده نیست."
        }

        val server = config.getString("server").trim()
        val identity = config.getString("identity").trim()
        val username = config.getString("username")
        val password = config.getString("password")
        require(server.isNotBlank() && identity.isNotBlank() && username.isNotBlank() && password.isNotBlank()) {
            "تنظیمات IKEv2 ناقص است."
        }

        val uuid = profileUuid(profile.id)
        val dataSource = VpnProfileSqlDataSource().open()
        try {
            dataSource.getVpnProfile(uuid)?.let { dataSource.deleteVpnProfile(it) }
            val nativeProfile = org.strongswan.android.data.VpnProfile().apply {
                setUUID(uuid)
                name = profile.name
                gateway = server
                vpnType = VpnType.IKEV2_EAP
                this.username = username
                remoteId = identity
                // Deliberately do not persist the lease password.
            }
            check(dataSource.insertProfile(nativeProfile) != null) {
                "ذخیرهٔ پروفایل موقت IKEv2 انجام نشد."
            }
        } finally {
            dataSource.close()
        }

        val start = Intent(appContext, CharonVpnService::class.java).apply {
            putExtra(VpnProfileDataSource.KEY_UUID, uuid.toString())
            putExtra(VpnProfileDataSource.KEY_PASSWORD, password)
        }
        appContext.startForegroundService(start)
        publish(IkeConnectionState.CONNECTING, "IKEv2 در حال اتصال است…")
    }

    fun disconnect(profileId: String) {
        appContext.startService(
            Intent(appContext, CharonVpnService::class.java)
                .setAction(CharonVpnService.DISCONNECT_ACTION)
        )
        val dataSource = VpnProfileSqlDataSource().open()
        try {
            dataSource.getVpnProfile(profileUuid(profileId))?.let { dataSource.deleteVpnProfile(it) }
        } finally {
            dataSource.close()
        }
        publish(IkeConnectionState.DISCONNECTING, "IKEv2 در حال قطع شدن است…")
    }

    fun close() {
        observer = null
        stateService?.unregisterListener(this)
        stateService = null
        if (bound) {
            runCatching { appContext.unbindService(serviceConnection) }
            bound = false
        }
    }

    override fun stateChanged() = publishState()

    private fun publishState() {
        val service = stateService ?: return
        val error = service.errorState
        if (error != VpnStateService.ErrorState.NO_ERROR) {
            val text = runCatching { appContext.getString(service.errorText) }
                .getOrDefault("اتصال IKEv2 ناموفق بود.")
            publish(IkeConnectionState.FAILED, text)
            return
        }
        when (service.state) {
            VpnStateService.State.CONNECTED -> publish(IkeConnectionState.CONNECTED, "IKEv2 متصل است.")
            VpnStateService.State.CONNECTING -> publish(IkeConnectionState.CONNECTING, "IKEv2 در حال اتصال است…")
            VpnStateService.State.DISCONNECTING -> publish(IkeConnectionState.DISCONNECTING, "IKEv2 در حال قطع شدن است…")
            VpnStateService.State.DISABLED -> publish(IkeConnectionState.DISCONNECTED, "IKEv2 متصل نیست.")
            null -> publish(IkeConnectionState.DISCONNECTED, "IKEv2 متصل نیست.")
        }
    }

    private fun publish(state: IkeConnectionState, message: String) {
        observer?.invoke(IkeConnectionStatus(state, message))
    }

    private fun profileUuid(profileId: String): UUID = UUID.nameUUIDFromBytes(
        "mikrolink-ikev2:$profileId".toByteArray(StandardCharsets.UTF_8)
    )
}
