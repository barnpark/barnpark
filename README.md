# BARN-PARK (Node/Express + MongoDB + Brevo)

ระบบจองที่พักสำหรับที่พักชุมชนและ SME — สตริกเดียวกับ BARNBARN
Deploy: GitHub → Render · ฐานข้อมูล MongoDB Atlas · อีเมลผ่าน Brevo (ไม่มี SMS)

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
4. deploy เสร็จได้ URL แบบ `https://<ชื่อ-service>.onrender.com` (ตอนนี้ใช้ `https://barnpark.onrender.com` · ต่อโดเมนเองภายหลังได้)
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
- **แจ้งเตือนเข้า LINE Barn Park** ของทุกคนที่เชื่อมที่พัก: จองใหม่ · แขกแจ้งโอน · แขกยกเลิก · ระบบปล่อยห้อง — มีปุ่ม ✅ รับเงิน / 🤝 จ่ายที่เคาน์เตอร์ (payStatus `onsite` ไม่ถูกปล่อยห้อง)
- **เช็กความครบ** (`lib/checklist.js`): แดชบอร์ดเว็บ · พิมพ์ "เช็กความครบ" ใน LINE · `GET /api/hotels/:id/checklist`
- **แจ้งอัปเดตระบบ** (`lib/announce.js`): หน้าแอดมิน → 📣 แจ้งอัปเดต → ส่งประกาศ + เช็กลิสต์เฉพาะของแต่ละที่ (1 คน = 1 push)
- env ใหม่ (ไม่บังคับ): `LINE_DAILY_DIGEST=1` ส่งสรุปเข้า-ออกรายวันเข้า LINE Barn Park ด้วย
- ⚠️ โควตา LINE OA ฟรี 300 ข้อความ/เดือน — แจ้งเตือนจองใหม่ใช้โควตานี้ ถ้าเต็มระบบจะอีเมลเตือนแอดมิน
- **ความเห็นจากที่พัก (feedback)** (`lib/feedback.js`, `routes/feedback.js`, `models/Feedback.js`): ส่งได้ใน LINE (“ส่งความเห็น” → หัวข้อ → ข้อความ → ภาพหน้าจอ) และเว็บหลังบ้าน (แท็บ 💡 ความเห็น) · แบบสอบถามรายเดือนกดคะแนน 1 คลิก (cron วันที่ `FEEDBACK_DAY`, ค่าเริ่มต้น 1) · หน้าแอดมิน → 💬 Feedback: สรุปคะแนน เปลี่ยนสถานะ ตอบกลับ → แจ้งคนส่งทาง LINE

## อัปเดต 15 ต.ค. 2026 — รับเงิน 3 แบบ · ไม่มี SMS · ปุ่ม LINE ที่พัก · หน้าจองใหม่ 10 แบบ
- **วิธีรับเงินต่อที่พัก** (`lib/pay.js`): `payPromptpay` · `payTransfer` (+ `bankName`/`bankAccountNo`/`bankAccountName`) · `payOnsite` — หน้าจองแสดงเฉพาะที่เปิด ไม่เปิดอะไรเลย = "ชำระกับที่พักโดยตรง" · `/api/public/book` รับ `payMethod` (promptpay|transfer|onsite) ตรวจกับที่เปิดจริง · จ่ายที่เคาน์เตอร์ = `payStatus: onsite` ไม่ถูกปล่อยห้อง · ตั้งได้ทั้งเว็บหลังบ้านและ LINE (🎨 ตั้งค่าเว็บ → 💳 วิธีรับเงิน)
- **ไม่มี SMS แล้ว** — แขกได้อีเมล (ถ้ากรอก) + เช็กการจองเองที่ `POST /api/public/lookup` (เลขจอง + เบอร์) / ลิงก์ `book.html?h=<slug>&find=1` · ลบ env `BREVO_SMS_SENDER` ได้
- **ปุ่ม “แชท LINE” ของที่พักลอยทุกหน้า** (`Hotel.lineId` รับ @ID หรือลิงก์ lin.ee/line.me — `cleanLineId`/`lineContactUrl` ใน `lib/stay.js`) · เชื่อม OA ของที่พักเองแล้วยังไม่ใส่ → ดึง @ID จาก `/v2/bot/info` ให้อัตโนมัติ
- **หน้าจอง (book.html) ออกแบบใหม่ทั้ง 10 เทมเพลต**: แก้บั๊ก Immersive ตัวหนังสือขาวบนพื้นขาว · Catalog ล้นจอมือถือ + ตัวกรองใช้งานได้จริง · Classic เมนูล้น · Editorial มือถือ · Fullscreen แถบค้นหาบังจอมือถือ · ตัวอักษรไทยห่าง · ปุ่มขีดเส้นใต้ · โลโก้เป็นตัวอักษรแรกของที่พัก · แผ่นจองเลื่อนขึ้นบนมือถือ + ยอดรวม/ปุ่มติดล่าง · ดูรูปใหญ่ · แถบโปรโมชัน (`promoText`/`promoImage`) · ห้องเต็มไปท้ายรายการ
- **ชุดสี 10 ชุดใหม่** (`public/api.js` + `lib/presets.js`) สีหลักตัดกับตัวหนังสือขาว ≥ 4.5:1 · `applyTheme` คำนวณสีตัวอักษรบนปุ่มให้อัตโนมัติ (`--on-brand`, `--brand-ink`) · ฟอนต์ตกแต่งใช้แค่หัวข้อ · ที่พักที่ใช้ชุดเดิมแบบไม่แก้เอง ได้ชุดใหม่ตอนเซิร์ฟเวอร์เริ่ม (`migratePalettes`)
- **เว็บหลังบ้าน**: ยกเลิกการจองแบบเก็บประวัติ `POST /api/bookings/:id/cancel` (แจ้งแขกทางอีเมล) / กู้คืน `/restore` · ส่งออก CSV `GET /api/hotels/:id/bookings/export?from=&to=` (BOM สำหรับ Excel ไทย กันสูตรแฝง) · เปลี่ยนรหัสผ่าน `POST /api/auth/change-password`
- **ลืมรหัสผ่าน**: `POST /api/auth/forgot` → อีเมลรหัส 6 หลัก (15 นาที, ผิดได้ 5 ครั้ง) → `POST /api/auth/reset` · ตอบเหมือนกันทุกอีเมล (กันสุ่มหาบัญชี) · rate limit 5 ครั้ง/15 นาที
- **ลิงก์แชร์ขึ้นการ์ดสวย**: `lib/og.js` ใส่ og:title / og:description / og:image (รูปปก) ให้ `book.html?h=<slug>`
- เช็กลิสต์เป็น 13 ข้อ (เพิ่ม “ปุ่ม LINE ให้แขกทักแชท” · ข้อ PromptPay เปลี่ยนเป็น “วิธีรับเงินอย่างน้อย 1 ช่องทาง”)
- **ส่วนล่างของหน้าจองต่างกันทั้ง 10 แบบ** (ไม่ใช่แค่ส่วนหัว): หัวข้อ · แกลเลอรี · รีวิว · ทำไมจองตรง · เกี่ยวกับเรา · ข้อมูลเข้าพัก · ติดต่อ · ท้ายเว็บ มีหน้าตาตามบุคลิกของแต่ละเทมเพลต — Rich = แบบมาตรฐาน, Editorial = หัวข้อเลขลำดับ/บทความ, Magazine = โพลารอยด์/บับเบิลแชท, Split = หัวข้อซ้าย-เนื้อหาขวา, Simple = การ์ดคอลัมน์แคบ, Catalog = ตารางแบบ Airbnb, Classic = กรอบ/ลายประดับ, Bento = กล่องไทล์, Fullscreen = แถบรูปเต็มจอ, Immersive = ฉากบนรูป · โค้ด: `fTail({order:[...]})` เลือกลำดับส่วนได้ต่อเทมเพลต, หัวข้อห่อด้วย `.sh`, CSS อยู่ท้าย `<style>` ใน `book.html` (หมวด "ส่วนล่างของหน้า")
- **วิดีโอแนะนำบนหน้าแรก** (`public/index.html`): วิดีโอ 57 วินาที (โลโก้ BARNPARK ของจริง) ใต้ส่วนหัว และลิงก์ “▶ ดูวิดีโอแนะนำ 1 นาที” · ภาษาไทย `public/media/barnpark-ad.mp4` + ปก `barnpark-ad.jpg` · ภาษาอังกฤษ `barnpark-ad-en.mp4` + `barnpark-ad-en.jpg` (720p, ~3 MB) — หน้าแรกเลือกให้เองตามภาษาที่เลือก (`API.lang()`) · ไฟล์เต็ม 1080p อยู่ที่ `easyBooking/BarnPark-Ad-16x9.mp4` และ `BarnPark-Ad-16x9-EN.mp4`
- **โลโก้ BARNPARK ของจริง** (ถอดจากภาพ “BARNPARK — A Sustainable Living Journey” เป็นไฟล์เวกเตอร์): `public/media/barnpark-logo.svg` (เขียว) · `barnpark-logo-white.svg` (ขาว) · `barnpark-mark.svg` (ไอคอนหลังคา+ใบไม้) · `favicon.svg` / `favicon-32.png` / `apple-touch-icon.png` — ใช้บนหน้าแรก (สีเขียวตามโลโก้) · หน้าเข้าสู่ระบบ · หลังบ้าน · แอดมิน · นโยบายความเป็นส่วนตัว · ไฟล์ให้ทีมใช้งานอยู่ที่ `easyBooking/brand/`
- **โลโก้ของแต่ละที่พัก**: `Hotel.logoUrl / logoData / logoAspect` · อัปโหลดได้ 2 ทาง — เว็บหลังบ้าน (ตั้งค่า → 🖼 โลโก้ · รูปหน้าปก) หรือ LINE (🎨 ตั้งค่าเว็บ → 🔖 โลโก้ที่พัก แล้วส่งรูป) · API `POST/DELETE /api/hotels/:id/logo` · เสิร์ฟที่ `/api/public/img/logo/:id/0` · ระบบตัดขอบว่าง ย่อไม่เกิน 600px เก็บเป็น PNG (พื้นใสยังใส) · ขึ้นบนหัวเว็บทุกเทมเพลต (ป้ายขาวมุมมน อ่านออกบนรูปปก/พื้นเข้ม) ท้ายเว็บ รูปวงกลมของเทมเพลต Simple และไอคอนแท็บ (ถ้าโลโก้เกือบจัตุรัส) · โลโก้แนวนอนยาว (≥ 2.2:1) ไม่พิมพ์ชื่อซ้ำ · ไม่มีโลโก้ = ใช้ตัวอักษรแรกของชื่อเหมือนเดิม · ไม่มีรูปปก ลิงก์แชร์ใช้โลโก้เป็นภาพตัวอย่าง

## อัปเดต 18 ต.ค. 2026 — ตัวคำนวณต้นทุน Channex ในหน้าแอดมิน
- หน้าแอดมิน → แท็บ **🧮 ต้นทุน Channex**: ใส่อัตราแลกเปลี่ยน (เว้นว่างไว้ให้กรอกเอง) · จำนวนที่พัก (ค่าเริ่มต้น = ที่พักที่ใช้งานจริงในระบบ) · ราคา Channex (แผน WhiteLabel $130/เดือน + $7 ต่อที่ ลดเป็นขั้นที่ 500/1,000/2,000 ที่ — แก้ได้) · ค่าบริการได้หลายราคา → เห็นค่าที่จ่าย Channex ต่อเดือน/ปี/ที่พัก · ส่วนต่างแต่ละราคา · จำนวนที่พักที่เริ่มคุ้ม · ตารางตามจำนวนที่พัก · กราฟ · รายได้จริงตอนนี้เทียบค่า Channex
- กด “บันทึกให้ทีม” → เก็บใน `Setting` key `calc:channex` ผ่าน `GET/POST /api/admin/calc/channex` (แอดมินเท่านั้น · ตรวจค่าด้วย `lib/calc.js`) ทุกคนที่เข้าหน้าแอดมินเห็นตัวเลขชุดเดียวกัน
- ไฟล์แยกไว้ส่งต่อ: `easyBooking/Channex-Calculator.html` (เปิดในเบราว์เซอร์ได้เลย ไม่ต้องล็อกอิน)
- กราฟในแท็บต้นทุน Channex **ชี้/ลากได้** (เมาส์ นิ้ว หรือปุ่มลูกศร) → เห็นต้นทุน Channex ต่อที่ และส่วนต่างต่อเดือนของแต่ละราคา ณ จำนวนที่พักนั้น
- **ลบที่พักถาวร**: หน้าแอดมิน → รายละเอียดที่พัก → “🗑 ลบที่พักนี้” → แสดงก่อนว่าจะลบอะไรบ้าง (ห้อง การจอง — เตือนถ้ามีการจองที่ยังไม่ถึงวันเช็คเอาท์ — กิจกรรม โปรโมชัน รีวิว บัญชีเจ้าของ/พนักงาน ความเห็น) · ต้องพิมพ์ slug ยืนยัน · ระบบถอดที่พักออกจาก LINE ของทุกคนที่เชื่อมไว้ให้ · API: `GET /api/admin/hotels/:id/delete-preview`, `POST /api/admin/hotels/:id/delete` `{confirm: "<slug>"}` (แอดมินเท่านั้น) · ถ้าแค่หยุดชั่วคราวให้ตั้งสถานะ “พัก” แทน

## อัปเดต 19 ต.ค. 2026 — สั่งงานแก้เว็บผ่าน LINE ให้ Claude Code
- ทีมพิมพ์ **`งาน: <สิ่งที่อยากให้แก้>`** ในแชท LINE Barn Park (เฉพาะ LINE ที่อนุญาตใน `DEV_LINE_USERS` + `ADMIN_LINE_TO`) → Barn Park สั่ง GitHub Actions (`.github/workflows/line-job.yml`) → Claude Code แก้โค้ด รัน `npm test` → push สาขา `line-job/<เลขงาน>` + เปิด **Pull Request** + ไฟล์ zip → แจ้งผลกลับใน LINE · **ไม่ merge เอง** เว็บจริงเปลี่ยนเมื่อเบลล์กด Merge
- พิมพ์ `สถานะงาน` ดู 5 งานล่าสุด · โค้ด: `lib/devjobs.js`, `routes/dev.js` (`POST /api/dev/job-callback` ใช้ header `x-dev-secret`), `models/DevJob.js`, `.github/scripts/`
- `CLAUDE.md` = คู่มือโปรเจกต์ให้ Claude Code (ใช้ได้ทั้งงานจาก LINE และตอนเปิด Claude Code เองบนเครื่อง)
- `npm test` (`test/run.mjs`): ตรวจ syntax ทุกไฟล์ + สคริปต์ในหน้าเว็บ + ชุดทดสอบ `test/*.test.mjs` (ไม่ต้องมีฐานข้อมูล)
- ตั้งค่าครั้งเดียว: ดู **`DEV-AGENT-SETUP.md`** (GitHub secrets + Render env: `GITHUB_TOKEN`, `GITHUB_REPO`, `DEV_LINE_USERS`, `DEV_JOB_SECRET`)
