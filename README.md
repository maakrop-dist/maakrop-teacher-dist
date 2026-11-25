# Maakrop Self-Hosted — Teacher Edition

> **ระบบจัดการชั้นเรียนส่วนตัวสำหรับครู — ติดตั้งง่ายใน 10 นาที จ่ายครั้งเดียวตลอดชีพ**  
> ครบทุกฟีเจอร์ฝั่งครู · 1 สิทธิ์ใช้งานต่อ 1 บัญชีครู · ฟรีค่าโฮสต์ 0 บาท/เดือน · ไม่มีลายน้ำ · ไม่ต้องตั้ง Setup Key · ข้อมูลนักเรียนอยู่กับคุณ 100%

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmaakrop-dist%2Fmaakrop-teacher-dist&project-name=maakrop-teacher&repository-name=maakrop-teacher&env=DATABASE_URL,DATABASE_URL_UNPOOLED,DATABASE_URL_SERVICE,BETTER_AUTH_SECRET,MAAKROP_MASTER_KEY&envDescription=Copy%20these%205%20values%20from%20the%20Maakrop%20Teacher%20Setup%20Guide)

---

## คู่มือฉบับสมบูรณ์ (ครบทั้ง 9 บท พร้อมแถบสารบัญด้านข้าง)

- **คู่มือฉบับออนไลน์พร้อมภาพประกอบ SVG + ตัวช่วยสร้างค่าอัตโนมัติ:** https://maakrop.com/help/self-hosted-teacher
- **คู่มือฉบับออฟไลน์ครบ 9 บทในเครื่อง:** เปิดไฟล์ [`GUIDE.html`](./GUIDE.html) ด้วยเบราว์เซอร์ได้ทันที
- **เปิดรับรหัสไลเซนส์ / ย้ายโดเมน:** https://maakrop.com/settings/self-hosted
- **ประวัติการสั่งซื้อ & จัดการรหัสรับสิทธิ์หลายที่นั่ง:** https://maakrop.com/shop/orders
- **เปิดใช้งานรหัสรับสิทธิ์ (`MKS-...`):** https://maakrop.com/shop/redeem
- **ดูรายละเอียดและสั่งซื้อ (ตลอดชีพ):** https://maakrop.com/shop/self-hosted-teacher
- **เงื่อนไขการใช้งานไลเซนส์:** [`LICENSE-SELF-HOSTED-TEACHER.md`](./LICENSE-SELF-HOSTED-TEACHER.md)

---

## โครงสร้างคู่มือ 9 บท

### ส่วนที่ 1 · ติดตั้งจำเป็น (ประมาณ 10 นาที)
1. **บทที่ 1 — ภาพรวม & เตรียม 3 บัญชีฟรี:** Neon (ฐานข้อมูล), Vercel (โฮสต์เว็บ), GitHub (เก็บโปรเจกต์และอัปเดต 1 คลิก)
2. **บทที่ 2 — สร้างฐานข้อมูล Neon + รัน SQL & สร้าง 5 ค่าอัตโนมัติ:** สร้าง roles (`app_rls`, `maakrop_service`) + สุ่ม `BETTER_AUTH_SECRET` & `MAAKROP_MASTER_KEY` พร้อมปุ่มดาวน์โหลดไฟล์สำรอง `.txt`
3. **บทที่ 3 — Deploy บน Vercel (Bulk Paste 5 ช่องทีเดียว):** วางค่า Env 5 ช่องทีเดียวแล้วกด Deploy ระบบสร้างตารางอัตโนมัติ
4. **บทที่ 4 — ตั้งค่าหน้า `/setup` ครบ 3 ขั้นตอน:** วางรหัสไลเซนส์ `MKTH1...` *(ไม่ต้องตั้ง Setup Key!)* → สร้างบัญชีครู → กดข้ามส่วนเสริมเพื่อเริ่มใช้งานทันที

### ส่วนที่ 2 · ฟีเจอร์เสริม (ข้ามได้ — กลับมาตั้งค่าทีหลังได้ที่ `/admin/system`)
5. **บทที่ 5 — เก็บรูปภาพ/ไฟล์ด้วย Cloudflare R2 (ฟรี 10 GB)** พร้อมตัวอย่าง CORS JSON
6. **บทที่ 6 — ผู้ช่วย AI แบบ BYOK (Gemini / OpenAI / Claude / AI Gateway)**
7. **บทที่ 7 — อีเมลแจ้งเตือน Resend & เข้าสู่ระบบด้วย Google OAuth**
8. **บทที่ 8 — เกมสดในห้องเรียน (Ably Realtime) & แผนที่เยี่ยมบ้าน (Mapbox)**

### ส่วนที่ 3 · ดูแลระยะยาว
9. **บทที่ 9 — โดเมนส่วนตัว, อัปเดตเวอร์ชันใหม่ 1 คลิก & FAQ**

---

## วิธีอัปเดตเวอร์ชันใหม่ (1 คลิก ข้อมูลไม่หาย)

เปิด GitHub Repository ของคุณ → กดแท็บ **Actions** → เลือก **`Sync Upstream Maakrop Release`** → กดปุ่ม **Run workflow**  
Vercel จะอัปเดตเวอร์ชันและปรับตารางฐานข้อมูลให้อัตโนมัติโดยข้อมูลเดิมอยู่ครบ 100%

---

## ทางเลือกสำหรับติดตั้งบนเครื่องคอมพิวเตอร์ / VPS (ไม่ต้องใช้ Docker)

```bash
git clone https://github.com/maakrop-dist/maakrop-teacher-dist.git maakrop-teacher
cd maakrop-teacher
npm run setup   # วิซาร์ดสร้าง .env และทดสอบฐานข้อมูล (ไม่ต้องสร้าง Setup Key)
npm start       # ดึงชุดรันไทม์ + อัปเดตตาราง + เปิดพอร์ต 3000
```
