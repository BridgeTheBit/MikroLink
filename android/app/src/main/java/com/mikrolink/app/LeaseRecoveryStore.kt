package com.mikrolink.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class SavedLease(val baseUrl: String, val profile: VpnProfile, val lease: VpnLease)

/** Stores only lease release metadata, encrypted with an Android Keystore key. */
class LeaseRecoveryStore(private val context: Context) {
    private val prefs = context.getSharedPreferences("lease_recovery", Context.MODE_PRIVATE)

    fun save(baseUrl: String, profile: VpnProfile, lease: VpnLease) {
        val plain = JSONObject()
            .put("baseUrl", baseUrl)
            .put("profileId", profile.id)
            .put("profileName", profile.name)
            .put("protocol", profile.protocol)
            .put("leaseId", lease.id)
            .put("expiresAt", lease.expiresAt)
            .put("releaseToken", lease.releaseToken)
            .toString().toByteArray(Charsets.UTF_8)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val packed = cipher.iv + cipher.doFinal(plain)
        check(prefs.edit().putString("pending", Base64.encodeToString(packed, Base64.NO_WRAP)).commit()) {
            "Could not save lease recovery metadata"
        }
    }

    fun read(): SavedLease? {
        val encoded = prefs.getString("pending", null) ?: return null
        val packed = Base64.decode(encoded, Base64.DEFAULT)
        require(packed.size > 12) { "Invalid saved lease" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, packed.copyOfRange(0, 12)))
        val obj = JSONObject(String(cipher.doFinal(packed.copyOfRange(12, packed.size)), Charsets.UTF_8))
        val profile = VpnProfile(obj.getString("profileId"), obj.getString("profileName"), obj.getString("protocol"), "")
        val lease = VpnLease(obj.getString("leaseId"), profile.protocol, JSONObject(), obj.getString("expiresAt"), obj.getString("releaseToken"))
        return SavedLease(obj.getString("baseUrl"), profile, lease)
    }

    fun clearIfLease(id: String) {
        val current = runCatching { read() }.getOrNull()
        if (current?.lease?.id == id) prefs.edit().remove("pending").apply()
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return generator.generateKey()
    }

    companion object { private const val KEY_ALIAS = "mikrolink_lease_recovery_v1" }
}
