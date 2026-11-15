# MikroLink — simple installation guide

This guide uses `vpn.example.com` only as an example. Replace it with your own public domain. Never commit real passwords, API keys, generated `.rsc` files, or `deploy/site.json`.

## 1. Pick the Android file

Open the latest GitHub Release and download the APK that matches the phone:

| File suffix | Device |
| --- | --- |
| `android-arm64-v8a.apk` | Almost every modern Android phone (recommended) |
| `android-armeabi-v7a.apk` | Older 32-bit Android phones |
| `android-x86_64.apk` | x86_64 emulators |
| `android-universal.apk` | Use when you do not know the architecture |

Android 8.0 (API 26) or newer is required. Allow installation from your browser or file manager, install the APK, and then turn that permission off again.

Do not enter a server address yet. Complete the RouterOS setup first.

## 2. Prepare RouterOS

You need:

- RouterOS 7.24.6 or newer;
- the matching `container` and `user-manager` packages;
- a persistent disk/volume for container data;
- a public IPv4 address and a DNS `A` record such as `vpn.example.com`;
- inbound TCP `80`, `443`, `1194` and UDP `500`, `4500`, `51820`;
- port `8443` kept private.

Check packages and find the disk name:

```routeros
/system/package/print
/disk/print
```

Enable containers:

```routeros
/system/device-mode/update container=yes
```

On a cloud VM such as CHR, stop and start the VM after this command. A normal RouterOS reboot does not confirm the device-mode change.

## 3. Make the container image available

The release workflow publishes these multi-architecture images:

```text
ghcr.io/bridgethebit/mikrolink-control-plane:<VERSION>
```

The GitHub Container Registry package must be **Public** so RouterOS can pull it without credentials. In GitHub, open the package, select **Package settings → Change visibility → Public**.

Use:

- `linux/amd64` for CHR/x86_64;
- `linux/arm64` for ARM64 MikroTik hardware.

The GitHub Release also contains architecture-specific `.tar` archives for offline/manual import.

## 4. Generate the private site file

Install Node.js 24 on the administrator computer. From the MikroLink source directory, replace the domain, image version, and disk name:

```powershell
node deploy/create-site.mjs `
  vpn.example.com `
  ghcr.io/bridgethebit/mikrolink-control-plane:0.1.0 `
  disk1 `
  deploy/site.json
```

This creates random RouterOS, API, token, and RADIUS secrets. The file is ignored by Git. Keep it private.

## 5. Generate and import the RouterOS script

```powershell
node deploy/generate-routeros.mjs `
  deploy/site.json `
  deploy/mikrolink-install.rsc
```

Upload `deploy/mikrolink-install.rsc` with WinBox or SFTP, then run:

```routeros
/import file-name=mikrolink-install.rsc
```

The script configures HTTPS/ACME, the private container network, RouterOS REST access, WireGuard, OpenVPN, IKEv2, RADIUS/User Manager, firewall rules, NAT, and the MikroLink control-plane container.

Wait for the image to finish downloading and extracting:

```routeros
/container/print detail
/container/start mikrolink-api
```

Confirm the public API:

```text
https://vpn.example.com/health
```

Expected result:

```json
{"status":"ok","service":"MikroLink"}
```

## 6. Create VPN users

Copy the safe example:

```powershell
Copy-Item server/manifest.example.json server/manifest.json
```

Edit `server/manifest.json`. Set a strong password, `enabled: true`, the quota, expiry, maximum connections, and allowed configuration IDs.

Apply it without typing users manually in RouterOS:

```powershell
$site = Get-Content deploy/site.json -Raw | ConvertFrom-Json
$env:ADMIN_KEY = $site.adminKey
node server/src/admin-cli.js server/manifest.json https://vpn.example.com
$env:ADMIN_KEY = $null
```

Protect or delete `server/manifest.json` afterward because it contains initial user passwords.

## 7. Sign in on Android

1. Open MikroLink.
2. Enter only the HTTPS origin, for example `https://vpn.example.com`.
3. Enter the MikroLink username and password.
4. Select an allowed profile.
5. Accept Android's VPN permission dialog.

Only one Android VPN can be active at a time. MikroLink keeps WireGuard private keys on the device and never sends them to the control plane.

## 8. Quick checks

For WireGuard:

```routeros
/interface/wireguard/peers/print detail
```

For IKEv2:

```routeros
/ip/ipsec/active-peers/print
```

For OpenVPN:

```routeros
/ppp/active/print
```

Test login rejection, the allowed-profile list, maximum simultaneous connections, quota enforcement, expiry, disconnect, and reconnect before production use.

## Common problems

- **ACME/certificate error:** verify the DNS `A` record, RouterOS time/NTP, and inbound TCP 80.
- **Container will not start:** verify device mode, free disk space, DNS, package versions, and CPU architecture.
- **API health page does not open:** check TCP 443 and the RouterOS input firewall. Do not expose TCP 8443.
- **VPN connects but has no internet:** check the generated forward and masquerade rules and the RouterOS `WAN` interface list.
- **IKEv2 fails:** verify UDP 500/4500, the certificate name, RADIUS accounting, and device time.

## Updates

Create and push a semantic tag such as `v0.2.0`. GitHub Actions builds, signs, names, checksums, and publishes all Android and RouterOS artifacts. Do not add generated APKs, container archives, `.rsc` files, keystores, or secrets to Git.

