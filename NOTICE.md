# مجوز و اجزای بالادستی MikroLink

کد اختصاصی این پروژه در `android/`، `server/` و `deploy/` با مجوز **GPL-3.0-or-later** منتشر می‌شود؛ متن کامل در [LICENSE](LICENSE) است. این اعلام، مجوز فایل‌های بالادستی را تغییر نمی‌دهد.

- کتابخانهٔ [WireGuard Android](https://github.com/WireGuard/wireguard-android) تحت Apache-2.0 است. هنگام انتشار APK، متن مجوز و اعلان‌های لازم آن باید همراه بسته حفظ شوند.
- کدهای موجود در `native/vendor/strongswan` و `native/vendor/ics-openvpn` فعلاً فقط برای بررسی ادغام هستند و وارد build اپ نمی‌شوند. مجوز و اعلان‌های همان مخازن برای فایل‌هایشان معتبر است.
- گواهی ریشه در `server/certs/isrgrootx1.pem` از [ISRG](https://letsencrypt.org/certificates/) است؛ این فایل کد برنامه نیست.

پیش از انتشار APK شامل موتورهای بومی، فهرست فایل‌ها و کتابخانه‌های بسته‌بندی‌شده و مجوز هرکدام باید تأیید شود. جزئیات مسیر فنی و تعارض هستهٔ OpenVPN 2 در [native/README.md](native/README.md) ثبت شده است.
