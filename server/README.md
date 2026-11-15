# سرویس مدیریت MikroLink

این سرویس Node.js بدون وابستگی خارجی، حساب کاربران اپ را نگه می‌دارد و از طریق REST روی RouterOS، همتایان WireGuard و اعتبارنامه‌های موقت OpenVPN و IKEv2 را می‌سازد. برای OpenVPN و IKEv2 از بستهٔ **User Manager** خود RouterOS به‌عنوان RADIUS استفاده می‌شود. کانتینر، سرور VPN یا Docker Engine را اجرا نمی‌کند؛ سرورهای VPN روی RouterOS هستند و RouterOS کانتینر OCI این سرویس را اجرا می‌کند.

نمونهٔ استقرار پروژه برای MikroTik CHR روی Amazon EC2 با RouterOS 7.24.6 و دامنهٔ بی‌طرف `vpn.example.com` نوشته شده است. دامنهٔ واقعی باید فقط هنگام استقرار و خارج از مخزن وارد شود. مسیر آماده‌سازی روتر در راهنمای اصلی پروژه و اسکریپت‌های `deploy/` آمده است. برای این سرویس باید `www-ssl`/REST روی HTTPS، User Manager با `use-profiles=yes`، RADIUS برای `ppp,ipsec`، Accounting و Interim Update، و سرورهای WireGuard/OpenVPN/IKEv2 از پیش با اسکریپت فعال شده باشند.

## راه‌اندازی

تصویر را با `docker build -t mikrolink-control-plane ./server` بسازید و به RouterOS به‌صورت OCI import کنید. پوشهٔ دائمی `/data` را mount کنید؛ فایل `/data/state.json` شامل هش رمز عبور، سهمیه‌ها، سوابق مصرف و رمزگذاری اعتبارنامه‌های موقت است. مقدار `TOKEN_SECRET` را پس از راه‌اندازی عوض نکنید، چون توکن‌های اتصال و رمزهای موقت موجود با آن محافظت می‌شوند. از `/data` پشتیبان بگیرید.

متغیرهای ضروری:

| متغیر | مقدار نمونه | کاربرد |
|---|---|---|
| `TOKEN_SECRET` | رشتهٔ تصادفی حداقل ۳۲ کاراکتری | امضای توکن و رمزگذاری اعتبارنامه‌ها |
| `ADMIN_KEY` | رشتهٔ تصادفی حداقل ۳۲ کاراکتری | دسترسی به API مدیریتی |
| `ROUTEROS_URL` | `https://vpn.example.com:8443/rest` | REST میکروتیک؛ فقط HTTPS |
| `ROUTEROS_USER` / `ROUTEROS_PASSWORD` | حساب محدود REST | دسترسی سرویس به روتر |
| `PUBLIC_HOST` | `vpn.example.com` | دامنهٔ VPN و API |
| `WG_SERVER_PUBLIC_KEY` | کلید عمومی اینترفیس `bridge-wg` | ساخت کانفیگ گوشی |

متغیرهای اختیاری و پیش‌فرض:

| متغیر | پیش‌فرض |
|---|---|
| `API_HOST`, `API_PORT` | `0.0.0.0`, `8080` در حالت proxy |
| `API_BEHIND_PROXY` | `1` در تصویر کانتینر؛ فقط برای شبکهٔ داخلی veth پشت reverse proxy HTTPS |
| `API_TLS_CERT`, `API_TLS_KEY` | اگر سرویس مستقیم HTTPS می‌دهد، هر دو مسیر فایل |
| `ROUTEROS_CA_CERT` | در صورت CA خصوصی، مسیر PEM؛ در غیر این صورت trust store سیستم |
| `DATA_FILE` | `/data/state.json` |
| `WG_INTERFACE`, `WG_PORT`, `WG_SUBNET`, `WG_DNS` | `bridge-wg`, `51820`, `10.77.0.0/24`, `1.1.1.1` |
| `OVPN_PORT`, `OVPN_TRANSPORT` | `1194`, `tcp` |
| `OVPN_CA_CERT` | `server/certs/isrgrootx1.pem` در تصویر؛ در صورت تغییر زنجیرهٔ CA مسیر دیگری بدهید |
| `IKEV2_IDENTITY`, `IKEV2_CA_CERT` | دامنهٔ عمومی، بدون CA سفارشی |
| `LEASE_SECONDS`, `RECONCILE_SECONDS` | `86400`, `15` |
| `RADIUS_CLEANUP_SECONDS`, `STATE_RETENTION_SECONDS` | `300`, `2592000`؛ پاک‌سازی حساب‌های موقت و سوابق قدیمی |

اگر RouterOS گواهی عمومی Let's Encrypt دارد، مقدار `ROUTEROS_CA_CERT` لازم نیست. برای OpenVPN، پروفایل تولیدی گواهی سرور را با CA موجود در `OVPN_CA_CERT` و نام `PUBLIC_HOST` بررسی می‌کند. هنگام تغییر صادرکنندهٔ ACME، زنجیرهٔ گواهی روتر و CA پروفایل را با هم بررسی کنید. برای IKEv2 با CA عمومی، کلاینت از trust store اندروید استفاده می‌کند؛ با CA خصوصی، `IKEV2_CA_CERT` را تنظیم کنید.

## ساخت کاربر و فهرست VPN بدون ورود دستی

فایل [manifest.example.json](manifest.example.json) را کپی و کاربران، رمزهای قوی، سهمیه و پروتکل‌های مجاز را تنظیم کنید. سپس از محیطی که به API عمومی HTTPS دسترسی دارد اجرا کنید:

```powershell
$env:ADMIN_KEY = '<کلید-مدیریت>'
node server/src/admin-cli.js server/manifest.json https://vpn.example.com
```

این فرمان درخواست `POST /v1/admin/apply` را با `X-Admin-Key` می‌فرستد. شناسهٔ کانفیگ (`id`) و نام کاربری (`username`) کلید به‌روزرسانی‌اند؛ تکرار فرمان همان کاربران و کانفیگ‌ها را به‌روزرسانی می‌کند. برای کاربر تازه رمز حداقل ۱۰ کاراکتری لازم است؛ در به‌روزرسانی، حذف فیلد `password` رمز فعلی را نگه می‌دارد. `quotaBytes=0` یعنی نامحدود، `expiresAt` زمان ISO 8601 یا `null`، و `allowedConfigs` فهرست شناسه‌های مجاز است. برای شروع دوبارهٔ شمارندهٔ مصرف، فقط هنگام تمدید سهمیه `resetUsage: true` را اضافه کنید؛ مقدار پیش‌فرض `false` است. نمونهٔ کاربر در فایل مثال عمداً غیرفعال است.

## قرارداد اپ

- `POST /v1/auth/login` با `{ "username": "...", "password": "..." }` پاسخ `{token,expiresAt}` می‌دهد. توکن ورود یک ساعت اعتبار دارد.
- `GET /v1/configs` با `Authorization: Bearer <token>`، آرایهٔ `{id,name,protocol,description}` را برمی‌گرداند.
- `GET /v1/me` سهمیه، مصرف و زمان انقضا را برمی‌گرداند.
- `POST /v1/configs/{id}/lease` با Bearer و `{deviceId}`؛ برای WireGuard، `publicKey` ساخته‌شده در گوشی نیز لازم است. پاسخ `{id,protocol,configuration,expiresAt,releaseToken}` است.
- `DELETE /v1/leases/{id}` با `Authorization: Lease <releaseToken>`، اتصال را آزاد می‌کند؛ این توکن حتی پس از انقضای توکن ورود عمل می‌کند. Bearer معتبر نیز پذیرفته می‌شود.

در WireGuard فقط کلید عمومی گوشی به سرور می‌رسد. پاسخ شامل `address`, `dns`, `peerPublicKey`, `endpoint`, `allowedIps`, `persistentKeepalive` است و اپ باید کانفیگ کامل را با کلید خصوصی محلی بسازد. پاسخ OpenVPN شامل `profile`, `username`, `password` و پاسخ IKEv2 شامل `server`, `identity`, `username`, `password`, `caCertificatePem` است. همهٔ پاسخ‌های دارای رمز با `Cache-Control: no-store` ارسال می‌شوند.

## سیاست‌ها و محدودیت فعلی

هر lease از OpenVPN یا IKEv2 یک کاربر RADIUS مستقل با `shared-users=1`، اعتبار زمانی و سقف انتقال می‌سازد. RouterOS با Interim Update مصرف و زمان را اعمال می‌کند. سرویس هر ۱۵ ثانیه شمارندهٔ WireGuard و نشست‌های User Manager را می‌خواند و در رسیدن مصرف مجموع به سهمیه، peer و اعتبارنامه‌ها را غیرفعال می‌کند. از این رو سهمیهٔ مجموع سه پروتکل می‌تواند تا زمان رسیدن گزارش RADIUS و اجرای چرخهٔ بعدی کمی بیشتر مصرف شود. در آزادسازی IKEv2، اعتبارنامه فوراً غیرفعال می‌شود، ولی RouterOS یک فرمان مستند برای حذف **فقط** active peer همان کاربر ندارد؛ قطع نشست فعال به RADIUS disconnect/پایان اعتبار پروفایل وابسته است. روی CHR واقعی، این رفتار باید با تست اتصال و قطع تأیید شود.

برای آزمون بدون روتر، از ریشهٔ پروژه اجرا کنید: `node --test server/test/service.test.js server/test/config.test.js`. این آزمون‌ها قرارداد HTTP، سیاست، ساخت lease، مصرف، پاک‌سازی خطا و آزادسازی را با RouterOS شبیه‌سازی‌شده می‌سنجند؛ آزمون سخت‌افزار و خود تونل انجام نشده است.
