# MikroLink release process

The repository never stores APKs, container archives, keystores, passwords, or deployment manifests. GitHub Actions builds all release files from a version tag.

## One-time repository setup

1. In **Settings → Actions → General**, allow GitHub Actions to read and write repository contents and packages.
2. Create the Android release keystore on a trusted offline computer. Keep this file backed up; losing it prevents seamless upgrades of already-installed APKs.
3. Add the following encrypted Actions secrets in **Settings → Secrets and variables → Actions**:

   - `ANDROID_SIGNING_KEY_BASE64`: base64 encoding of the complete keystore file
   - `ANDROID_KEYSTORE_PASSWORD`: keystore password
   - `ANDROID_KEY_ALIAS`: key alias
   - `ANDROID_KEY_PASSWORD`: key password

Never commit the keystore or put any of these values in an issue, workflow, manifest, or chat message.

The release workflow reads these values only from GitHub Actions Secrets; the keystore file is never uploaded to the repository or attached to a release.

## Publish a version

Run all checks on `main`, then create and push an annotated semantic-version tag:

```bash
git tag -a v0.1.0 -m "MikroLink 0.1.0"
git push origin v0.1.0
```

The Release workflow tests the server and RouterOS generator, builds signed Android APKs, creates RouterOS container archives for each supported architecture, publishes a multi-architecture image to GitHub Container Registry, generates checksums and an SBOM/provenance attestation, and finally creates the GitHub Release.

Expected file names include:

```text
MikroLink-0.1.0-android-arm64-v8a.apk
MikroLink-0.1.0-android-armeabi-v7a.apk
MikroLink-0.1.0-android-x86_64.apk
MikroLink-0.1.0-android-universal.apk
MikroLink-0.1.0-routeros-x86_64.tar
MikroLink-0.1.0-routeros-arm64.tar
SHA256SUMS
```

Do not replace the signing keystore between releases. Use a new version such as `v0.1.1` for the next release; never move an already-published tag to unrelated source code.

---

# فرایند انتشار MikroLink

هیچ APK، آرشیو کانتینر، keystore، رمز یا تنظیمات واقعی استقرار داخل مخزن نگهداری نمی‌شود. تمام فایل‌های انتشار توسط GitHub Actions و از روی tag نسخه ساخته می‌شوند.

## تنظیم یک‌باره مخزن

1. در مسیر **Settings → Actions → General** اجازه خواندن و نوشتن محتوا و packageها را برای GitHub Actions فعال کنید.
2. کلید امضای Android را روی یک رایانه امن بسازید و چند نسخه پشتیبان امن از آن نگه دارید. گم‌شدن این کلید، به‌روزرسانی مستقیم APKهای نصب‌شده را غیرممکن می‌کند.
3. در مسیر **Settings → Secrets and variables → Actions** این Secretهای رمزگذاری‌شده را اضافه کنید:

   - `ANDROID_SIGNING_KEY_BASE64`: محتوای کامل فایل keystore به‌شکل base64
   - `ANDROID_KEYSTORE_PASSWORD`: رمز keystore
   - `ANDROID_KEY_ALIAS`: نام کلید
   - `ANDROID_KEY_PASSWORD`: رمز کلید

فایل keystore یا مقدار این Secretها را هرگز داخل مخزن، Issue، workflow، manifest یا پیام چت قرار ندهید.

Workflow انتشار این مقادیر را فقط از GitHub Actions Secrets می‌خواند؛ فایل keystore هرگز به مخزن یا خود Release اضافه نمی‌شود.

## انتشار نسخه

پس از موفق‌شدن تست‌های شاخه `main`، یک tag نسخه استاندارد بسازید و ارسال کنید:

```bash
git tag -a v0.1.0 -m "MikroLink 0.1.0"
git push origin v0.1.0
```

Workflow انتشار به‌ترتیب تست‌ها را اجرا می‌کند، APKهای امضاشده Android و آرشیو کانتینر RouterOS را برای معماری‌های مختلف می‌سازد، image چندمعماری را در GitHub Container Registry منتشر می‌کند، checksum و SBOM/provenance می‌سازد و در پایان GitHub Release را ایجاد می‌کند.

کلید امضا را بین نسخه‌ها تغییر ندهید. برای انتشار بعدی نسخه‌ای مانند `v0.1.1` بسازید و tag منتشرشده را روی کد دیگری جابه‌جا نکنید.

