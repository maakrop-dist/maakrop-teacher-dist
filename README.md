# Maakrop Self-Hosted — Teacher Edition

> **ระบบจัดการชั้นเรียนส่วนตัวสำหรับครู — ติดตั้งง่ายใน 10 นาที จ่ายครั้งเดียวตลอดชีพ**  
> ครบทุกฟีเจอร์ฝั่งครู · 1 บัญชีครูต่อ 1 ไลเซนส์ · ฟรีค่าโฮสต์ 0 บาท/เดือน · ไม่มีลายน้ำ · ไม่ต้องตั้ง Setup Key · ข้อมูลนักเรียนอยู่กับคุณ 100%

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmaakrop-dist%2Fmaakrop-teacher-dist&project-name=maakrop-teacher&repository-name=maakrop-teacher&env=DATABASE_URL,DATABASE_URL_UNPOOLED,DATABASE_URL_SERVICE,BETTER_AUTH_SECRET,MAAKROP_MASTER_KEY&envDescription=Copy%20these%205%20values%20from%20the%20Maakrop%20Teacher%20Setup%20Guide)

---

## คู่มือฉบับอ่านง่าย (ไม่ต้องเป็นสายไอที)

- **คู่มือจับมือทำ + เครื่องมือคัดลอกค่า 1–5 อัตโนมัติ:** https://maakrop.com/help/self-hosted-teacher (หรือเปิดไฟล์ [`GUIDE.html`](./GUIDE.html) บนเครื่องได้ทันที)
- **เปิดกล่องรับ License Key / ย้ายโดเมน:** https://maakrop.com/settings/self-hosted
- **ดูรายละเอียดและสั่งซื้อ (ตลอดชีพ):** https://maakrop.com/pricing#self-hosted-teacher
- **เงื่อนไขการใช้งานไลเซนส์:** [`LICENSE-SELF-HOSTED-TEACHER.md`](./LICENSE-SELF-HOSTED-TEACHER.md)

---

## สรุป 3 บริการฟรีที่ใช้ (ไม่เสียรายเดือน · ไม่ต้องใส่บัตรเครดิต)

1. **Neon (ฟรี)** — ตู้เก็บข้อมูลส่วนตัวของครู (เก็บรายชื่อนักเรียน เช็กชื่อ คะแนน อยู่กับครู 100%)
2. **Vercel (ฟรีแผน Hobby)** — ตัวเปิดเว็บไซต์ 24 ชม. ให้เปิดใช้งานได้จากมือถือและคอมพิวเตอร์ทุกที่
3. **GitHub (ฟรี)** — เก็บไฟล์โปรแกรมของคุณและใช้กดปุ่มอัปเดตเวอร์ชันใหม่ใน 1 คลิก

---

## วิธีติดตั้งง่ายที่สุด (4 ขั้นตอน · ~10 นาที)

### ขั้นที่ 1 — เตรียมรหัสไลเซนส์
- เปิดหน้า https://maakrop.com/settings/self-hosted ขูดการ์ดเพื่อเตรียมรหัสไลเซนส์ที่ขึ้นต้นด้วย `MKTH1...`

### ขั้นที่ 2 — สร้างตู้เก็บข้อมูลบน Neon (3 นาที)
1. เข้า https://console.neon.tech ล็อกอินด้วย Google → กด **New Project** (เลือกโซน **Singapore**)
2. กดปุ่ม **Connect** คัดลอกลิงก์ `postgresql://neondb_owner...` ไปวางในเครื่องมือช่วยสร้างค่าที่ [maakrop.com/help/self-hosted-teacher](https://maakrop.com/help/self-hosted-teacher) (หรือไฟล์ `GUIDE.html`)
3. คัดลอกโค้ด SQL ที่ได้ไปวางในเมนู **SQL Editor** ของ Neon แล้วกดปุ่ม **Run** เพียงครั้งเดียว

### ขั้นที่ 3 — กดปุ่มติดตั้งบน Vercel และวางค่า 5 ช่อง (3 นาที)
1. กดปุ่ม **Deploy with Vercel** ด้านบนสุด (ล็อกอินด้วย GitHub — เนื่องจากเป็น Public Repository จึงสามารถกด Deploy ได้ทันทีโดยไม่ต้องแก้ไขไฟล์ README หรือสร้าง commit เอง)
2. กดคัดลอกค่าจากช่องที่ **1 ถึง 5** ในเครื่องมือช่วยสร้างค่าไปวางในช่องที่มีชื่อตรงกันบนหน้า Vercel:
   - `DATABASE_URL`
   - `DATABASE_URL_UNPOOLED`
   - `DATABASE_URL_SERVICE`
   - `BETTER_AUTH_SECRET`
   - `MAAKROP_MASTER_KEY`
3. กดปุ่ม **Deploy** รอประมาณ 1 นาที ระบบจะติดตั้งโปรแกรมและสร้างตารางให้อัตโนมัติ

### ขั้นที่ 4 — เปิดหน้า `/setup` วางรหัสไลเซนส์ 3 ขั้นตอนง่ายๆ (2 นาที)
1. เปิดเว็บไซต์ของคุณแล้วเติม `/setup` ต่อท้าย (เช่น `https://kru-somchai.vercel.app/setup`)
2. **ขั้นที่ 1:** ติ๊กยอมรับเงื่อนไขแล้ววางรหัสไลเซนส์ `MKTH1...` *(ไม่ต้องตั้ง Setup Key!)*
3. **ขั้นที่ 2:** ตั้งชื่อห้องเรียนและสร้างอีเมล/รหัสผ่านของครู
4. **ขั้นที่ 3:** กด **"ข้ามขั้นตอนนี้และเปิดใช้งานเลย"** ได้ทันที (คีย์รูปภาพ Cloudflare R2 หรือผู้ช่วย AI Gemini ค่อยกลับมาใส่ทีหลังได้ตลอดเวลา)

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
