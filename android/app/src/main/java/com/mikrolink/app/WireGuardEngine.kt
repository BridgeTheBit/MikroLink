package com.mikrolink.app

import com.wireguard.android.backend.Tunnel
import com.wireguard.config.Config
import com.wireguard.crypto.KeyPair
import org.json.JSONObject
import java.io.ByteArrayInputStream

class NamedTunnel(private val tunnelName: String) : Tunnel {
    @Volatile var state: Tunnel.State = Tunnel.State.DOWN
        private set

    override fun getName(): String = tunnelName
    override fun onStateChange(newState: Tunnel.State) { state = newState }
}

object WireGuardEngine {
    fun makeConfig(lease: JSONObject, keyPair: KeyPair): Config {
        val address = required(lease, "address")
        val dns = required(lease, "dns")
        val peerPublicKey = required(lease, "peerPublicKey")
        val endpoint = required(lease, "endpoint")
        val allowedIps = required(lease, "allowedIps")
        val keepalive = lease.optInt("persistentKeepalive", 25).coerceIn(0, 3600)
        val text = """
            [Interface]
            PrivateKey = ${keyPair.privateKey.toBase64()}
            Address = $address
            DNS = $dns

            [Peer]
            PublicKey = $peerPublicKey
            Endpoint = $endpoint
            AllowedIPs = $allowedIps
            PersistentKeepalive = $keepalive
        """.trimIndent()
        return Config.parse(ByteArrayInputStream(text.toByteArray(Charsets.UTF_8)))
    }

    private fun required(obj: JSONObject, field: String): String =
        obj.getString(field).also { require(it.isNotBlank() && !it.contains('\n') && !it.contains('\r')) }
}
