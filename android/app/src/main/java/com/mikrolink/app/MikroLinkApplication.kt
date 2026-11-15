package com.mikrolink.app

import com.wireguard.android.backend.GoBackend
import com.wireguard.android.backend.Tunnel
import org.strongswan.android.logic.StrongSwanApplication
import java.util.UUID

data class ActiveVpn(val profile: VpnProfile, val lease: VpnLease, val tunnel: Tunnel?, val baseUrl: String)

class MikroLinkApplication : StrongSwanApplication() {
    var session: LoginSession? = null
    var api: ApiClient? = null
    var activeVpn: ActiveVpn? = null

    val wireGuard by lazy { GoBackend(this) }
    val leaseRecovery by lazy { LeaseRecoveryStore(this) }

    val deviceId: String by lazy {
        val prefs = getSharedPreferences("device", MODE_PRIVATE)
        prefs.getString("id", null) ?: UUID.randomUUID().toString().also {
            prefs.edit().putString("id", it).apply()
        }
    }
}
