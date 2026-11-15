# معماری MikroLink

## دامنه و اصطلاحات

در این سند «IKEv3» درخواست‌شده به‌صورت **IKEv2/IPsec** تفسیر شده است. [استاندارد IETF برای IKEv2](https://datatracker.ietf.org/doc/rfc7296/) و [مستندات کلاینت Android strongSwan](https://docs.strongswan.org/docs/latest/os/androidVpnClient.html) پروتکل IKEv3 را معرفی نمی‌کنند؛ strongSwan در Android فقط IKEv2 را پشتیبانی می‌کند. اگر منظور از IKEv3 فناوری دیگری است، نام و مشخصات آن باید پیش از پیاده‌سازی آن مسیر روشن شود.

هدف محصول یک **APK واحد** برای Android 8.0 (API 26) به بالا است که WireGuard، OpenVPN و IKEv2 را بدون نصب برنامه جداگانه ارائه کند. وضعیت فعلی کد: ورود و فهرست، WireGuard از Android 8 به بالا، و IKEv2/IPsec با strongSwan و `CharonVpnService` از Android 8 به بالا در منبع ادغام شده‌اند. OpenVPN هنوز موتور داخلی ندارد و در رابط کاربری غیرفعال است. اتصال واقعی هر دو مسیر فعال باید روی گوشی و RouterOS واقعی آزموده شود. Android در نخستین اتصال تأیید سیستمی VPN را می‌گیرد و سرویس VPN باید به foreground منتقل شود. [راهنمای رسمی Android VPN](https://developer.android.com/develop/connectivity/vpn)

## اجزا و مسیر داده

```text
Android app ── HTTPS ──> MikroLink API در RouterOS Container
   │                         │
   │                         ├─ فایل داده پایدار: کاربر، مجوز کانفیگ، سهمیه، زمان، lease
   │                         └─ RouterOS REST API: ساخت/حذف WireGuard peer، ساخت کاربر User Manager، خواندن مصرف
   │                                              │
   │                                              └─ User Manager داخلی RouterOS: RADIUS برای IKEv2 و OpenVPN
   │
   └─ IKEv2 / OpenVPN / WireGuard ──> سرویس‌های VPN خود RouterOS
```

RouterOS Container، اجرای image سازگار با قالب Docker/OCI روی RouterOS است؛ **Docker Engine یا Docker Compose روی روتر نیست**. نمونهٔ استقرار برای CHR روی EC2 با RouterOS 7.24.6 و دامنهٔ بی‌طرف `vpn.example.com` نوشته شده و packageهای `container` و `user-manager`، حافظه/فضای کافی، و فعال‌سازی device-mode با Stop/Start کردن VM را فرض می‌کند. داده API روی دیسک خارجی mount می‌شود. API از طریق veth خصوصی به REST روتر متصل است؛ User Manager خود RouterOS سرور RADIUS است و container آن را از راه REST مدیریت می‌کند. REST مدیریتی روتر در معرض اینترنت قرار نمی‌گیرد. [راهنمای Container](https://manual.mikrotik.com/docs/containers/) · [راهنمای REST API](https://manual.mikrotik.com/docs/developer-guides/rest-api/) · [User Manager](https://help.mikrotik.com/docs/spaces/ROS/pages/2555940/User%2BManager)

### قرارداد API اپ

| عمل | پاسخ/رفتار |
| --- | --- |
| `POST /v1/auth/login` | نام کاربری و رمز؛ پاسخ `token` و `expiresAt`؛ token امضاشده و یک‌ساعته است و refresh endpoint ندارد |
| `GET /v1/configs` | آرایه کانفیگ‌های مجاز و فعال شامل `id`، `name`، `protocol` و `description` |
| `POST /v1/configs/{id}/lease` | ورودی `deviceId` و برای WireGuard، `publicKey`؛ بررسی اعتبار، حجم، تعداد leaseهای فعال و مجوز کانفیگ؛ پاسخ `id`، `protocol`، `configuration`، `expiresAt` و `releaseToken` |
| `DELETE /v1/leases/{id}` | با Bearer معتبر یا `Authorization: Lease <releaseToken>` آزادسازی lease و حذف peer WireGuard یا غیرفعال‌کردن حساب موقت User Manager و تلاش برای قطع نشست؛ توکن اختصاصی lease پس از انقضای توکن یک‌ساعتهٔ ورود هم کار می‌کند |
| `GET /v1/me` | نام کاربری، سهمیه و مصرف بر حسب بایت، سقف اتصالات و تاریخ انقضا |
| `POST /v1/admin/apply` | اعمال manifest کاربران و کانفیگ‌ها با هدر `X-Admin-Key`؛ مسیر مدیریتی، نه مسیر اپ کاربر |

کنترل ظرفیت در قفل store سمت سرور انجام می‌شود. شناسه دستگاه در درخواست lease دریافت می‌شود، اما token فعلی به دستگاه bind نشده و فقط در حافظه اپ نگه‌داری می‌شود. پاسخ lease هرگز credential مدیریتی RouterOS یا کلید خصوصی روتر را برنمی‌گرداند. کلید خصوصی WireGuard در هر تلاش اتصال روی گوشی ساخته می‌شود و به سرور فرستاده نمی‌شود؛ ذخیره‌سازی پایدار آن در Keystore در کد فعلی وجود ندارد. مسیرهای refresh، heartbeat و provision جداگانه در API فعلی وجود ندارند.

## ماتریس اتصال Android

| پروتکل و Android | وضعیت کد اپ | سمت RouterOS | کار باقی‌مانده |
| --- | --- | --- | --- |
| WireGuard، 8+ | کتابخانه رسمی `com.wireguard.android:tunnel` و `GoBackend` به اپ وصل شده‌اند؛ وضعیت اتصال پس از مشاهده handshake گزارش می‌شود | peer با public key تولیدشده روی گوشی؛ خواندن `rx`/`tx` | APK دیباگ ساخته شده، اما اتصال به روتر واقعی هنوز آزموده نشده است. [مخزن رسمی](https://git.zx2c4.com/wireguard-android/about/) · [RouterOS peers](https://manual.mikrotik.com/docs/cli-reference/interface/wireguard/peers/) |
| IKEv2/IPsec، 8+ | ماژول `android/strongswan`، `CharonVpnService` و manifest داخلی strongSwan در APK استفاده می‌شوند؛ lease شامل EAP credentials و CA اختیاری است | IPsec IKEv2 با `eap-radius` و گواهی معتبر با SAN مناسب | آزمون عملی روی API 26، 30، 33+ و RouterOS واقعی؛ strongSwan در build با revision ثابت آماده می‌شود. [strongSwan Android](https://docs.strongswan.org/docs/latest/os/androidVpnClient.html) · [RouterOS IKEv2](https://manual.mikrotik.com/docs/virtual-private-networks/ipsec/) |
| OpenVPN، 8+ | دکمه اتصال غیرفعال است؛ موتور packet و `VpnService` آن در اپ وجود ندارند | سرور OVPN داخلی RouterOS و PPP/RADIUS | ادغام OpenVPN 3 Core با پل JNI/C++ و adapter Android TUN یا راهکار دارای مجوز سازگار، سپس آزمون interoperability لازم است. [Core](https://github.com/OpenVPN/openvpn3) · [RouterOS OpenVPN](https://manual.mikrotik.com/docs/virtual-private-networks/openvpn/) |

Android تنها **یک VPN فعال** در هر user/profile می‌پذیرد. اپ فعلی تا قطع اتصال پیشین، دکمه‌های اتصال جدید را غیرفعال می‌کند. WireGuard و strongSwan هر دو از `VpnService`/foreground service در همان APK استفاده می‌کنند. [VpnService API](https://developer.android.com/reference/android/net/VpnService)

حداقل نسخه نصب اپ Android 8 است؛ این عدد به معنی کارکرد فعلی هر سه پروتکل روی Android 8 نیست. ساخت APK، تست دستگاه، target SDK، foreground service و ABIهای موردنیاز باید بررسی شوند. [مستندات Android](https://developer.android.com/develop/background-work/services/fgs/launch)

### مجوزهای کد ثالث

* `wireguard-android:tunnel` برای embed منتشر شده است؛ مجوز دقیق artifact و وابستگی‌ها باید در build نهایی ثبت شود. [مخزن رسمی](https://git.zx2c4.com/wireguard-android/about/)
* OpenVPN 3 Core تحت **MPL 2.0 یا AGPLv3** عرضه می‌شود؛ انتخاب مجوز و تعهدات فایل‌های تغییریافته و کتابخانه‌های همراه در بسته نهایی باید بررسی شود. [LICENSE upstream](https://github.com/OpenVPN/openvpn3/blob/master/LICENSE.md)
* strongSwan تحت **GPLv2** است و برای بیشتر اجزا امکان مجوز تجاری ارائه می‌کند. ادغام frontend/engine آن با اپ توزیعی باید مطابق مجوز انتخاب‌شده باشد. [مجوز رسمی strongSwan](https://docs.strongswan.org/docs/latest/devs/contributions.html)
* پروژه `ics-openvpn` صریحاً می‌گوید کتابخانه embed نیست و fork آن تابع GPL است؛ برای این معماری به‌عنوان راه دور زدن نصب اپ جداگانه فرض نشده است. [README upstream](https://github.com/schwabe/ics-openvpn)

## سیاست کاربر، حجم و زمان

* **OpenVPN:** RouterOS از PPP/RADIUS داخلی برای احراز هویت و accounting استفاده می‌کند. API برای هر lease نام کاربری و رمز تصادفی جدا در User Manager می‌سازد؛ خود API تعداد leaseهای فعال هر کاربر را محدود می‌کند. ویژگی `only-one` پروفایل PPP هنگام RADIUS نادیده گرفته می‌شود. [PPP AAA](https://manual.mikrotik.com/docs/authentication-authorization-accounting/ppp-aaa/)
* **IKEv2:** RouterOS با `eap-radius` به User Manager داخلی وصل می‌شود. API برای lease حساب موقت، profile و limitation می‌سازد و مصرف را از sessionهای User Manager می‌خواند. RouterOS accounting را با interim update گزارش می‌کند؛ پایان سهمیه و انقضا پس از reconcile دوره‌ای اجرا می‌شوند و ممکن است تأخیر داشته باشند. [IPsec/IKEv2](https://manual.mikrotik.com/docs/virtual-private-networks/ipsec/)
* **WireGuard:** هویت native آن **کلید peer** است، نه username و نشست RADIUS. API برای هر lease یک peer با public key گوشی می‌سازد، شمارنده‌های `rx` و `tx` را دوره‌ای جمع می‌کند و هنگام آزادسازی یا پایان اعتبار peer را حذف می‌کند. یک private key کپی‌شده در چند گوشی را نمی‌توان با شمارنده RouterOS به‌عنوان چند اتصال مستقل شمرد. [WireGuard peers](https://manual.mikrotik.com/docs/cli-reference/interface/wireguard/peers/)
* مصرف هر سه پروتکل در `usedBytes` کاربر جمع می‌شود. reconcile فعلی با فاصله پیش‌فرض ۱۵ ثانیه شمارنده WireGuard و sessionهای User Manager را بررسی می‌کند. صحت قطع نشست، بازنشانی شمارنده پس از reboot و رفتار هنگام خطای RouterOS هنوز به آزمایش واقعی نیاز دارند.

## راه‌اندازی بدون ورود دستی

`deploy/generate-routeros.mjs` از `site.json` اسکریپت نصب RouterOS می‌سازد: WireGuard، OVPN، IPsec/IKEv2، User Manager و RADIUS localhost، veth/container، reverse proxy، NAT و firewall. `server/src/admin-cli.js` کاربران و کانفیگ‌ها را با manifest از مسیر `/v1/admin/apply` می‌سازد. فایل نصب خروجی **حاوی رمزهاست** و باید محرمانه نگه داشته شود. API عمومی از HTTPS/443 منتشر می‌شود؛ REST روتر روی 8443 فقط از نشانی veth کانتینر مجاز است. جزئیات و پیش‌نیازها در `deploy/README.md` آمده‌اند.

استقرار واقعی به مدل MikroTik، نسخه RouterOS، امکان Container، فضای ذخیره‌سازی، دامنه عمومی و گواهی معتبر وابسته است. تست کامل شامل نصب APK روی Android 8 و نسخه جدید، اتصال واقعی هر سه پروتکل به RouterOS، تغییر شبکه، قطع اتصال، quota/expiry و سقف همزمانی است. بدون دستگاه و endpoint واقعی، نتیجه ساخت و تست محلی نباید به‌عنوان «VPN عملیاتی» گزارش شود.
