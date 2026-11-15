# MikroLink

MikroLink یک پروژهٔ متن‌باز برای اپ اندروید و مدیریت VPN روی MikroTik RouterOS است. کاربر با نشانی HTTPS، نام کاربری و رمز وارد می‌شود، پروفایل‌های مجاز خود را می‌بیند و برای اتصال، یک مجوز زمان‌دار می‌گیرد. سرویس داخل RouterOS Container از طریق REST خصوصی، WireGuard peer و حساب‌های موقت OpenVPN/IKEv2 را ایجاد و محدودیت‌های زمان، حجم و تعداد اتصال را پیگیری می‌کند. هیچ دامنه، رمز یا اطلاعات شخصی واقعی در مخزن قرار نمی‌گیرد؛ نمونه‌ها از `vpn.example.com` استفاده می‌کنند.

## وضعیت اجرا

| بخش | وضعیت فعلی |
| --- | --- |
| ورود، فهرست پروفایل، مجوز و مدیریت کاربر | پیاده‌سازی شده در `server/` و `android/` |
| WireGuard درون اپ Android 8+ | پیاده‌سازی با کتابخانهٔ رسمی WireGuard؛ APK دیباگ ساخته شده، اما اتصال با روتر/گوشی واقعی هنوز آزموده نشده |
| IKEv2/IPsec با strongSwan درون اپ Android 8+ | strongSwan/CharonVpnService در ماژول داخلی APK ادغام شده؛ آزمون گوشی و روتر واقعی هنوز باقی است |
| OpenVPN درون اپ | موتور بومی هنوز ادغام نشده؛ در اپ غیرفعال نشان داده می‌شود |
| راه‌اندازی RouterOS | مولد اسکریپت در `deploy/`؛ تولید فایل آزموده شده، اجرای آن روی روتر هنوز آزموده نشده است |

## فایل‌ها

- `android/`: اپ Kotlin با حداقل Android 8 (API 26)
- `android/strongswan/`: ماژول strongSwan داخلی برای IKEv2/IPsec
- `server/`: API و کنترل سیاست‌ها با Node.js، قابل بسته‌بندی در image OCI
- `deploy/`: اسکریپت تولید خودکار پیکربندی RouterOS
- `docs/architecture.md`: معماری، مرزهای پشتیبانی و منابع فنی
- `LICENSE` و `NOTICE.md`: مجوز متن‌باز و اجزای بالادستی

## شروع

برای ساخت اپ، [راهنمای Android](android/README.md)؛ برای سرویس و manifest کاربران، [راهنمای سرور](server/README.md)؛ و برای تولید اسکریپت روتر، [راهنمای استقرار](deploy/README.md) را بخوانید. نیاز است دامنه عمومی، مدل/نسخه RouterOS، دیسک روتر و image منتشرشدهٔ سرور مشخص شوند. فعال‌سازی اولیهٔ Container یک تأیید فیزیکی روی میکروتیک می‌خواهد.

آزمون‌های قابل اجرا در این محیط:

```text
node --test deploy/generate-routeros.test.mjs
node --test server/test/service.test.js server/test/config.test.js
```

نسخهٔ نخست WireGuard و IKEv2/IPsec با strongSwan را در منبع و Workflow ساخت دارد؛ OpenVPN هنوز در اپ غیرفعال است. اتصال پروتکل‌ها با CHR واقعی و گوشی‌های واقعی باید پیش از انتشار عمومی آزموده شود.
