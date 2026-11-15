# MikroLink — راهنمای ساده نصب و استفاده

در این راهنما `vpn.example.com` فقط یک مثال است. آن را با دامنه عمومی خودتان جایگزین کنید. رمز واقعی، کلید API، فایل تولیدشده `.rsc` یا `deploy/site.json` را هیچ‌وقت داخل Git قرار ندهید.

## ۱. انتخاب فایل مناسب اندروید

از بخش آخرین Release در GitHub، APK مناسب گوشی را دریافت کنید:

| انتهای نام فایل | دستگاه مناسب |
| --- | --- |
| `android-arm64-v8a.apk` | تقریباً همه گوشی‌های جدید؛ انتخاب پیشنهادی |
| `android-armeabi-v7a.apk` | گوشی‌های قدیمی ۳۲ بیتی |
| `android-x86_64.apk` | شبیه‌سازهای x86_64 |
| `android-universal.apk` | وقتی معماری گوشی را نمی‌دانید |

حداقل نسخه لازم Android 8.0 یا API 26 است. اجازه نصب از مرورگر یا فایل‌منیجر را موقتاً فعال کنید، APK را نصب کنید و بعد این اجازه را دوباره غیرفعال کنید.

فعلاً داخل برنامه آدرس وارد نکنید؛ ابتدا RouterOS را آماده کنید.

## ۲. آماده‌سازی RouterOS

موارد لازم:

- RouterOS نسخه `7.24.6` یا جدیدتر؛
- بسته‌های هم‌نسخه `container` و `user-manager`؛
- یک دیسک یا Volume پایدار برای اطلاعات کانتینر؛
- IP عمومی و رکورد DNS نوع `A` مثل `vpn.example.com`؛
- پورت‌های TCP شامل `80`، `443`، `1194` و پورت‌های UDP شامل `500`، `4500`، `51820`؛
- بسته‌ماندن پورت `8443` از اینترنت.

بسته‌ها و نام دیسک را بررسی کنید:

```routeros
/system/package/print
/disk/print
```

قابلیت Container را فعال کنید:

```routeros
/system/device-mode/update container=yes
```

در CHR یا ماشین مجازی ابری، بعد از این دستور VM را کاملاً Stop و سپس Start کنید. reboot معمولی RouterOS این تغییر را تأیید نمی‌کند.

## ۳. در دسترس قراردادن image کانتینر

GitHub Actions این image چندمعماری را منتشر می‌کند:

```text
ghcr.io/bridgethebit/mikrolink-control-plane:<VERSION>
```

بسته Container Registry باید **Public** باشد تا RouterOS بدون نام کاربری و رمز آن را دریافت کند. در GitHub وارد صفحه Package شوید و مسیر **Package settings → Change visibility → Public** را انجام دهید.

- برای CHR و x86_64 از `linux/amd64` استفاده می‌شود.
- برای سخت‌افزارهای ARM64 میکروتیک از `linux/arm64` استفاده می‌شود.

در GitHub Release فایل‌های `.tar` جداگانه هر معماری نیز برای نصب آفلاین قرار می‌گیرند.

## ۴. ساخت فایل خصوصی سایت

روی کامپیوتر مدیریت، Node.js 24 را نصب کنید. در پوشه سورس MikroLink، دامنه، نسخه image و نام دیسک را جایگزین کنید:

```powershell
node deploy/create-site.mjs `
  vpn.example.com `
  ghcr.io/bridgethebit/mikrolink-control-plane:0.1.0 `
  disk1 `
  deploy/site.json
```

این فرمان رمزهای تصادفی و متفاوت برای RouterOS، API، توکن و RADIUS می‌سازد. فایل خروجی توسط Git نادیده گرفته می‌شود؛ آن را خصوصی نگه دارید.

## ۵. تولید و اجرای اسکریپت RouterOS

```powershell
node deploy/generate-routeros.mjs `
  deploy/site.json `
  deploy/mikrolink-install.rsc
```

فایل `deploy/mikrolink-install.rsc` را با WinBox یا SFTP روی روتر بفرستید و اجرا کنید:

```routeros
/import file-name=mikrolink-install.rsc
```

اسکریپت به‌صورت خودکار HTTPS و ACME، شبکه خصوصی کانتینر، REST داخلی RouterOS، سرویس‌های WireGuard و OpenVPN و IKEv2، ‏RADIUS/User Manager، فایروال، NAT و کانتینر MikroLink را می‌سازد.

تا پایان دانلود و استخراج image صبر کنید:

```routeros
/container/print detail
/container/start mikrolink-api
```

این آدرس را باز کنید:

```text
https://vpn.example.com/health
```

پاسخ درست:

```json
{"status":"ok","service":"MikroLink"}
```

## ۶. ساخت کاربران VPN

فایل نمونه امن را کپی کنید:

```powershell
Copy-Item server/manifest.example.json server/manifest.json
```

در `server/manifest.json` برای کاربر رمز قوی، `enabled: true`، حجم، تاریخ انقضا، حداکثر اتصال هم‌زمان و کانفیگ‌های مجاز را تنظیم کنید.

کاربران را بدون ورود دستی در RouterOS اعمال کنید:

```powershell
$site = Get-Content deploy/site.json -Raw | ConvertFrom-Json
$env:ADMIN_KEY = $site.adminKey
node server/src/admin-cli.js server/manifest.json https://vpn.example.com
$env:ADMIN_KEY = $null
```

بعد از اجرا، فایل `server/manifest.json` را محافظت یا حذف کنید؛ چون رمز اولیه کاربران داخل آن قرار دارد.

## ۷. ورود در برنامه اندروید

1. MikroLink را باز کنید.
2. فقط آدرس HTTPS را وارد کنید؛ مثل `https://vpn.example.com`.
3. نام کاربری و رمز MikroLink را بنویسید.
4. یکی از پروفایل‌های مجاز را انتخاب کنید.
5. اجازه VPN اندروید را تأیید کنید.

اندروید در هر لحظه فقط یک VPN فعال نگه می‌دارد. کلید خصوصی WireGuard روی خود گوشی ساخته می‌شود و به سرویس مدیریت ارسال نمی‌شود.

## ۸. بررسی سریع اتصال‌ها

WireGuard:

```routeros
/interface/wireguard/peers/print detail
```

IKEv2:

```routeros
/ip/ipsec/active-peers/print
```

OpenVPN:

```routeros
/ppp/active/print
```

قبل از استفاده واقعی، ورود اشتباه، نمایش فقط کانفیگ‌های مجاز، حداکثر اتصال هم‌زمان، محدودیت حجم، انقضا، قطع و اتصال مجدد را آزمایش کنید.

## خطاهای رایج

- **خطای ACME یا گواهی:** رکورد DNS، ساعت/NTP روتر و دسترسی TCP 80 را بررسی کنید.
- **کانتینر اجرا نمی‌شود:** device mode، فضای دیسک، DNS، نسخه بسته‌ها و معماری CPU را بررسی کنید.
- **صفحه health باز نمی‌شود:** TCP 443 و فایروال input را بررسی کنید. پورت 8443 را عمومی نکنید.
- **VPN وصل است ولی اینترنت ندارد:** قوانین forward و masquerade و عضویت رابط اینترنت در لیست `WAN` را بررسی کنید.
- **IKEv2 وصل نمی‌شود:** UDP 500/4500، نام گواهی، RADIUS Accounting و ساعت گوشی و روتر را بررسی کنید.

## انتشار نسخه بعدی

یک tag استاندارد مثل `v0.2.0` بسازید و Push کنید. GitHub Actions فایل‌های Android و RouterOS را می‌سازد، امضا و نام‌گذاری می‌کند، checksum می‌سازد و در Release قرار می‌دهد. APK، فایل کانتینر، اسکریپت `.rsc`، keystore یا رمزها را مستقیماً وارد Git نکنید.

