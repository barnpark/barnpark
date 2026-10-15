# BARN-PARK (Node/Express + MongoDB + Brevo)

ระบบจองที่พักสำหรับที่พักชุมชนและ SME — สตริกเดียวกับ BARNBARN
Deploy: GitHub → Render · ฐานข้อมูล MongoDB Atlas · อีเมล/SMS ผ่าน Brevo

## โครงสร้าง
```
server.js            Express: เสิร์ฟ API + หน้าเว็บ (public/)
models/              Mongoose: Hotel, RoomType, Booking, Service, User, LineChat, LinkCode, Setting
routes/              auth, hotels, rooms, services, bookings, public
lib/                 db (mongoose), auth (JWT), notify (Brevo + LINE ต่อโรงแรม)
public/              หน้าเว็บ static (index, login, app, admin, book) — เรียก /api
seed.js              สร้าง admin + โรงแรมเดโม + ห้อง
.env.example         รายการ environment variables
render.yaml          บลูพรินต์ deploy Render
```

## รันในเครื่อง
```bash
npm install
cp .env.example .env      # แล้วแก้ค่า MONGODB_URI, JWT_SECRET, BREVO_*
npm run seed              # (ครั้งแรก) สร้างบัญชี admin + โรงแรมเดโม
npm start                 # เปิด http://localhost:3000
```

## ขึ้นออนไลน์ (GitHub → Render)
1. push โค้ดขึ้น GitHub
2. MongoDB Atlas → สร้าง cluster ฟรี → Connect → คัดลอก connection string → เป็นค่า `MONGODB_URI`
3. Render → **New → Web Service** → เลือก repo → Runtime Node
   - Build: `npm install` · Start: `npm start`
   - ใส่ Environment variables ตาม `.env.example` (MONGODB_URI, JWT_SECRET, BREVO_*)
4. deploy เสร็จได้ URL `https://barn-park.onrender.com` (ต่อโดเมนเองภายหลังได้)
5. รัน seed ครั้งแรก: Render → Shell → `npm run seed` (หรือรันจากเครื่องที่ชี้ MONGODB_URI เดียวกัน)

## API ย่อ
- `POST /api/auth/login` → `{token, user}` · `GET /api/auth/me`
- `GET/POST/PATCH /api/hotels...` · `PATCH /api/hotels/:id/line` (เชื่อม LINE OA ต่อโรงแรม)
- `GET/POST /api/hotels/:hid/rooms|services|bookings` · `PATCH/DELETE /api/rooms|services|bookings/:id`
- สาธารณะ (ไม่ต้องล็อกอิน): `GET /api/public/hotel/:slug`, `GET /api/public/availability`, `POST /api/public/book`

## บอท LINE OA "Barn Park" — โรงแรมสมัคร + จัดการที่พักผ่านแชท
- โค้ด: `lib/linebot.js` (ขั้นตอนทั้งหมด), `lib/lineui.js` (การ์ด/ปุ่ม), `lib/line.js` (เรียก LINE API), `lib/richmenu.js` (เมนู 2 ชุด), `lib/onboard.js` (สมัคร/อนุมัติ/รหัสเชื่อม)
- Webhook: `POST /api/line/platform-webhook` (ตั้งใน LINE Developers ของ channel Barn Park) — ต้องมี env `LINE_CHANNEL_TOKEN` + `LINE_CHANNEL_SECRET`
- เมนู LINE: รูปอยู่ที่ `public/richmenu/guest.jpg` (ผู้มาใหม่) และ `hotel.jpg` (โรงแรมที่เชื่อมแล้ว) ขนาด 2500×1686 — ติดตั้งจากหน้าแอดมิน → แท็บ "📲 LINE OA" → ปุ่ม "ติดตั้งเมนู LINE"
  (เปลี่ยนรูปได้ แต่ตำแหน่งปุ่มต้องตรงกับ `MENUS` ใน `lib/richmenu.js` แล้วกดติดตั้งใหม่)
- ลำดับ: สมัครในแชท → แอดมินกด "อนุมัติ" (การ์ดใน LINE หรือหน้าแอดมิน) → ผู้สมัครได้รหัสเชื่อม → กด "เชื่อมเลย" → เมนูจัดการที่พักเปิด
- โรงแรมที่สมัครผ่านเว็บ: เว็บหลังบ้าน → ⚙️ ตั้งค่า → "ขอรหัสเชื่อม LINE" → ส่งรหัสในแชท
- แอดมิน: พิมพ์ "แอดมิน" ในแชท = ดูที่พักรออนุมัติ

## ความปลอดภัย
- LINE OA token ของแต่ละโรงแรมเก็บใน `Hotel.lineChannelToken` (`select:false` — ไม่หลุดผ่าน API ปกติ)
- ห้าม commit `.env` / secret — ตั้งบน Render Environment เท่านั้น
- ตัวจำกัดคำขอ (`lib/ratelimit.js`) ใช้ IP จริงจาก `CF-Connecting-IP` บน Render (Cloudflare ของ Render เขียนทับให้ ปลอมไม่ได้) — แยกตัวนับต่อจุด

## อัปเดต ต.ค. 2026
- **PromptPay QR**: แก้ AID ผิด (เดิมสแกนไม่ขึ้น) → สร้าง QR ฝั่งเซิร์ฟเวอร์ `GET /api/public/promptpay-qr?slug=&amount=` (`lib/promptpay.js`) · เจ้าของดู QR ทดสอบ ฿1 ได้ในเว็บและใน LINE
- **อาหารเช้าต่อห้อง** (`RoomType.breakfast` = none | included | optional + `breakfastPrice` ต่อท่าน/คืน) — คิดราคาฝั่งเซิร์ฟเวอร์ (`lib/stay.js`)
- **ข้อมูลการเข้าพัก**: เวลาเช็คอิน/เอาท์ แผนที่ (ส่งตำแหน่งใน LINE ได้) กฎที่พัก → หน้าจอง + หน้ายืนยันการจอง + อีเมลยืนยัน
- **หน้ายืนยันการจอง** หลังจองเสร็จ (เลขจอง, QR จ่ายทีหลัง, ปุ่มแจ้งโอน `POST /api/public/report-paid`)
- **แจ้งเตือนเข้า LINE Barn Park** ของทุกคนที่เชื่อมที่พัก: จองใหม่ · แขกแจ้งโอน · แขกยกเลิก · ระบบปล่อยห้อง — มีปุ่ม ✅ รับเงิน / 🤝 ให้จ่ายที่ที่พัก (payStatus `onsite` ไม่ถูกปล่อยห้อง)
- **เช็กความครบ** (`lib/checklist.js`): แดชบอร์ดเว็บ · พิมพ์ "เช็กความครบ" ใน LINE · `GET /api/hotels/:id/checklist`
- **แจ้งอัปเดตระบบ** (`lib/announce.js`): หน้าแอดมิน → 📣 แจ้งอัปเดต → ส่งประกาศ + เช็กลิสต์เฉพาะของแต่ละที่ (1 คน = 1 push)
- env ใหม่ (ไม่บังคับ): `LINE_DAILY_DIGEST=1` ส่งสรุปเข้า-ออกรายวันเข้า LINE Barn Park ด้วย
- ⚠️ โควตา LINE OA ฟรี 300 ข้อความ/เดือน — แจ้งเตือนจองใหม่ใช้โควตานี้ ถ้าเต็มระบบจะอีเมลเตือนแอดมิน
- **ความเห็นจากที่พัก (feedback)** (`lib/feedback.js`, `routes/feedback.js`, `models/Feedback.js`): ส่งได้ใน LINE (“ส่งความเห็น” → หัวข้อ → ข้อความ → ภาพหน้าจอ) และเว็บหลังบ้าน (แท็บ 💡 ความเห็น) · แบบสอบถามรายเดือนกดคะแนน 1 คลิก (cron วันที่ `FEEDBACK_DAY`, ค่าเริ่มต้น 1) · หน้าแอดมิน → 💬 Feedback: สรุปคะแนน เปลี่ยนสถานะ ตอบกลับ → แจ้งคนส่งทาง LINE
