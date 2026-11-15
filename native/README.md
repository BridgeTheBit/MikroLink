# موتورهای بومی VPN در MikroLink

## وضعیت

موتور WireGuard از کتابخانهٔ آمادهٔ Android استفاده می‌کند و strongSwan از طریق ماژول `android/strongswan` در APK MikroLink ادغام شده است. OpenVPN هنوز عمداً به APK وصل نشده و در رابط کاربری غیرفعال می‌ماند. پوشهٔ محلی `vendor/` در Git نادیده گرفته می‌شود و منابع بالادستی باید با revision ثابت در زمان build دریافت شوند.

| پروژهٔ بالادستی | نسخهٔ بررسی‌شده | ماهیت کد | نیازهای ساخت |
| --- | --- | --- | --- |
| [strongSwan Android](https://github.com/strongswan/strongswan/tree/master/src/frontends/android) | `eab0c41968e18e78e9598596827bf1ce910658ca` | اپ مستقل با `CharonVpnService`، JNI و NDK | کل درخت strongSwan، آماده‌سازی Autotools، OpenSSL، NDK `27.3.13750724`، SDK 37 |
| [OpenVPN for Android](https://github.com/schwabe/ics-openvpn) | `660901ce320539aec476bd04bd1999c396d5e778` | اپ مستقل با `OpenVPNService`؛ flavorهای `skeleton` و `ovpn23`/`ovpn2` | ۷ submodule بومی، NDK `30.0.14904198`، CMake، SWIG، SDK 37؛ نسخهٔ `ovpn23` فعلی نیز OpenVPN 2 را می‌سازد |

نسخه‌ها از HEAD مخزن‌های رسمی در زمان بررسی ثبت شده‌اند. [راهنمای ساخت strongSwan](https://github.com/strongswan/strongswan/blob/master/src/frontends/android/README.ndk) می‌گوید فقط checkout کردن frontend کافی نیست: کتابخانهٔ بومی به فایل‌های پیکربندی تولیدشده از کل سورس و OpenSSL کامپایل‌شده نیاز دارد. [راهنمای توسعهٔ OpenVPN for Android](https://github.com/schwabe/ics-openvpn/blob/master/doc/README.txt) هم دریافت submoduleها و SWIG را لازم می‌داند و زمان قابل توجهی برای اولین build ذکر می‌کند.

## مسیر ادغام در یک APK

1. سورس کامل هر دو پروژه را در نسخه‌های ثبت‌شده دریافت و ابتدا **اپ‌های بالادستی را جداگانه بسازید** تا سازگاری ابزارهای بومی و ABIهای `arm64-v8a`، `armeabi-v7a` و `x86_64` روشن شود.
2. strongSwan در `android/strongswan` به‌صورت Android library استفاده می‌شود؛ Workflow با `scripts/prepare-strongswan.sh` سورس pinned، OpenSSL و خروجی NDK لازم را برای هر ABI آماده می‌کند.
3. `MikroLinkApplication` باید راه‌اندازی لازم `StrongSwanApplication` و `ICSOpenVPNApplication` را انجام دهد. هر دو manifest نام `Application` خود را دارند؛ manifest merge ساده نمی‌تواند هر سه را هم‌زمان به عنوان کلاس اپ نگه دارد. سرویس‌های `CharonVpnService` و `OpenVPNService` باید در manifest APK واحد ثبت شوند و اجازهٔ `BIND_VPN_SERVICE` و اعلان foreground را حفظ کنند.
4. برای IKEv2، دادهٔ lease شامل سرور، identity، نام کاربری، رمز و CA است. آن را به `VpnProfile` داخلی strongSwan تبدیل کنید، پروفایل را در data source آن ذخیره کنید و از مسیر کنترل داخلی/Intent با UUID همان پروفایل برای شروع و قطع استفاده کنید. [مستندات رسمی strongSwan](https://docs.strongswan.org/docs/latest/os/androidVpnClient.html) Intentهای شروع/قطع را توضیح می‌دهد؛ این مسیر در اپ مستقل کار می‌کند و بعد از ادغام باید **در همان package** آزموده شود.
5. برای OpenVPN، متن `.ovpn` و credentialهای lease را در مدل داخلی OpenVPN for Android وارد کنید و سرویس بومی‌اش را از همان APK راه بیندازید. برای مسیر مجوز GPLv3 پایین، ابتدا ماژول را **OpenVPN 3-only** کنید: تارگت‌ها و assetهای OpenVPN 2 را از CMake/Gradle حذف کنید، مسیرهای Java مربوط به اجرای OpenVPN 2 را حذف یا غیرفعال کنید، و در APK خروجی نبودن `libopenvpn.so` و `pie_openvpn.*` را بررسی کنید. انتخاب flavor `ovpn23` به‌تنهایی کافی نیست؛ [CMakeLists بالادستی](https://github.com/schwabe/ics-openvpn/blob/master/main/src/main/cpp/CMakeLists.txt) هر دو هسته را می‌سازد. `remoteExample` فقط اپ جداگانه را با AIDL کنترل می‌کند و شرط «بدون نصب برنامهٔ دیگر» را برآورده نمی‌کند. پروژهٔ بالادستی صریحاً می‌گوید کتابخانهٔ آماده برای embed نیست. [مخزن رسمی](https://github.com/schwabe/ics-openvpn)
6. در هر لحظه فقط یک `VpnService` فعال نگه دارید. تعویض پروتکل باید ابتدا تونل پیشین را ببندد، credential/peer موقت را آزاد کند و سپس رضایت سیستمی Android را برای سرویس جدید بگیرد. وضعیت اتصال باید از موتور واقعی و handshake/accounting خوانده شود.
7. با RouterOS واقعی و گوشی‌های API 26، 29، 30 و 33+ اتصال، قطع، انقضای مجوز، تغییر شبکه، ازسرگیری پس از قتل پردازه و سقف حجم/اتصال را آزمایش کنید. دکمهٔ OpenVPN تا زمان ادغام موتور واقعی غیرفعال می‌ماند.

برای OpenVPN، [OpenVPN 3 Core](https://github.com/OpenVPN/openvpn3) یک API C++ با `TunBuilder` دارد، اما یک adapter آمادهٔ Android `VpnService` برای پروژهٔ MikroLink ارائه نمی‌کند؛ [کد `TunBuilderBase`](https://github.com/OpenVPN/openvpn3/blob/master/openvpn/tun/builder/base.hpp) نشان می‌دهد ساخت TUN و route و DNS بر عهدهٔ اپ میزبان است. کد flavor `ovpn23` در OpenVPN for Android مسیر مرجع کامل‌تری است، ولی همچنان به تبدیل ماژول اپ به library، حذف هستهٔ OpenVPN 2 و ادغام manifest/initialization نیاز دارد.

## مجوز انتشار یک APK متن‌باز

مسیر پیشنهادی برای کد خود MikroLink و **اثر ترکیبی APK، GPLv3** است. [مجوز strongSwan](https://github.com/strongswan/strongswan/blob/master/LICENSE) و [کد اپ OpenVPN for Android](https://github.com/schwabe/ics-openvpn/blob/master/doc/LICENSE.txt) هر دو انتخاب «GPL نسخهٔ ۲ یا هر نسخهٔ بعدی» را می‌دهند؛ برای این ترکیب می‌توان نسخهٔ ۳ را انتخاب کرد. [WireGuard Android](https://github.com/WireGuard/wireguard-android/blob/master/COPYING) تحت Apache 2.0 است؛ طبق [راهنمای GNU](https://www.gnu.org/licenses/license-compatibility.en.html) Apache 2.0 با GPLv3 سازگار است، اما با GPLv2 معمولی سازگار نیست. متن مجوز و اعلان‌های حق نشر هر جزء باید حفظ شوند و سورس متناظر و دستور ساخت APK منتشر شود.

**دام مهم:** مجوز [هستهٔ OpenVPN 2](https://github.com/schwabe/openvpn/blob/icsopenvpn/COPYING) که submodule همین اپ است، فقط GPLv2 است؛ استثنای اتصال به Apache 2.0 آن را به GPLv3 تبدیل نمی‌کند. [CMakeLists اپ](https://github.com/schwabe/ics-openvpn/blob/master/main/src/main/cpp/CMakeLists.txt) حتی برای flavor `ovpn23`، هستهٔ OpenVPN 2 و فایل اجرایی آن را می‌سازد و بسته‌بندی می‌کند. بنابراین APK سه‌موتوره با کد OpenVPN for Android **بدون تغییر** را نمی‌توان صرفاً با برچسب GPLv3 منتشر کرد. پیش از انتشار، این هسته و باینری‌هایش باید از APK حذف شوند یا برای آن اجازهٔ سازگار جداگانه گرفته شود؛ استقلال حقوقی احتمالی یک فایل بومی در همان APK را نباید بدون بررسی تخصصی فرض کرد.

[OpenVPN 3 Core](https://github.com/OpenVPN/openvpn3/blob/master/LICENSE.md) انتخاب AGPLv3 یا MPL 2.0 می‌دهد. مسیر GPLv3 این پروژه می‌تواند شاخهٔ **MPL 2.0** را در «Larger Work» به‌کار ببرد، با رعایت شرایط بخش ۳٫۳ MPL، حفظ اعلان‌های هر فایل و انتشار سورس MPL؛ [راهنمای رسمی Mozilla](https://www.mozilla.org/en-US/MPL/2.0/FAQ/#q14-may-i-combine-mpl-licensed-code-and-lgpl-licensed-code-in-the-same-executable-program) این ترکیب را توضیح می‌دهد. پیش از خروجی نهایی، فهرست وابستگی‌های بومی، فایل‌ها و استثناهای مجوز بررسی شود؛ این یادداشت جای بررسی حقوقی انتشار را نمی‌گیرد.

## نتیجهٔ بررسی محیط

در این workspace، Android SDK و Gradle برای ساخت اپ آماده شده‌اند و strongSwan در منبع/Workflow ساخت ادغام شده است. OpenVPN هنوز موتور packet و adapter داخلی ندارد و در نسخهٔ فعلی غیرفعال است. اتصال IKEv2/strongSwan و WireGuard به endpoint واقعی باید روی دستگاه واقعی آزموده شود.
