# MikroLink Android

Android 8.0 (API 26) is the minimum supported OS. Open this directory in Android Studio with Android SDK 35 and JDK 17, then run `:app:assembleDebug`. The build needs access to Google Maven and Maven Central. A debug APK has now been built at `app/build/outputs/apk/debug/app-debug.apk`; it is a debug-signed development artifact and has not been tested on a physical Android device.

## Implemented connection paths

| Protocol | Android version | Status |
| --- | --- | --- |
| WireGuard | 8.0+ | Uses the official embeddable `com.wireguard.android:tunnel` userspace backend. The private key is generated on the phone and is not sent to the server. The UI first reports the tunnel as active, then reports a connection after a handshake appears in backend statistics. |
| IKEv2/IPsec | 8.0+ | Uses the embedded strongSwan Android client and `CharonVpnService`; EAP credentials and the optional CA certificate come from the short-lived lease. This path requires real-device/router interoperability testing. |
| OpenVPN | 8.0+ | Disabled until an in-app OpenVPN native engine and `VpnService` adapter are integrated. |

The disabled paths are shown as unavailable in the catalog. The app never reports a protocol as connected without starting its actual tunnel.

## API contract

The user enters an HTTPS origin and credentials. TLS uses Android's normal certificate validation; HTTP and redirects are rejected. The app calls:

- `POST /v1/auth/login` with `username`, `password`; response `token`, `expiresAt`.
- `GET /v1/configs` with the bearer token; response is an array of `id`, `name`, `protocol`, `description`.
- `POST /v1/configs/{id}/lease` with `deviceId` and, for WireGuard, `publicKey`; response is `id`, `protocol`, `configuration`, `expiresAt`, `releaseToken`.
- `DELETE /v1/leases/{id}` with `Authorization: Lease <releaseToken>` when disconnected or after failed setup. The release token remains usable after the login bearer token expires.

The WireGuard configuration object must contain `address` (CIDR), `dns` (one IP), `peerPublicKey`, `endpoint`, `allowedIps`, and numeric `persistentKeepalive`. No private key is returned. IKEv2 uses `server`, `identity`, `username`, `password`, and optional `caCertificatePem` in PEM format; when the CA field is null, Android's system trust store is used.

## Production work still required

1. Build and run on real devices across API 26, 30, 33, and current Android. Test VPN consent, background operation, network handover, lease expiry, and RouterOS interoperability.
2. Integrate OpenVPN 3 Core or another in-app OpenVPN engine with a single packaged `VpnService`; the current source intentionally keeps OpenVPN disabled. Check the chosen engine's license before distribution.
3. Add a persistent secure login flow if long-lived sign-in is desired. The current bearer token is kept in memory and a fresh login is required after process restart. Lease-release metadata is encrypted with Android Keystore.

The [official WireGuard Android library](https://github.com/WireGuard/wireguard-android) is Apache 2.0 licensed. The [strongSwan Android client](https://github.com/strongswan/strongswan/tree/master/src/frontends/android) and [OpenVPN for Android](https://github.com/schwabe/ics-openvpn) are source integrations with separate license obligations. Android's [VPN API guidance](https://developer.android.com/develop/connectivity/vpn) describes consent and foreground service behavior.
