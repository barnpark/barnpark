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
