# Security policy

MikroLink handles VPN credentials and router automation, so security reports should not be filed as public issues.

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** action in this repository's Security tab. Include affected versions, reproduction steps, and the expected impact. Do not include real VPN credentials, private keys, router exports, public IP addresses, or production domain names.

## Repository data policy

- Real domains, IP addresses, usernames, passwords, tokens, signing keys, router exports, and deployment manifests are not accepted in the repository.
- Examples use reserved documentation domains such as `vpn.example.com` and non-secret placeholders.
- Generated APK/AAB files, RouterOS scripts containing secrets, local state, keystores, SDK paths, and upstream working trees are excluded by `.gitignore`.
- Release binaries are produced by GitHub Actions from tagged source. Signing material must be provided only through GitHub Actions secrets.

If a credential is committed accidentally, revoke and rotate it immediately; deleting it in a later commit is not sufficient.
