# Barn Pak — คู่มือขึ้นออนไลน์ (ฉบับทำเอง)

ระบบนี้เป็นเว็บแบบ static (ไฟล์ HTML/JS ล้วน) + ฐานข้อมูล **Supabase** (ฟรี)
ขึ้นออนไลน์จริงได้ด้วยเงิน 0 บาท เชื่อม OTA (Channex) ค่อยเปิดทีหลัง

## ไฟล์ในชุดนี้
- `index.html` — **เว็บหลัก (หน้าขายงาน)**: บริการ + ราคาเริ่มต้น (ระบบจอง / Graphic / LINE OA / เว็บไซต์) + ปุ่ม “เข้าสู่ระบบโรงแรม”
- แบรนด์/สี: โรงแรมปรับสีและคำโปรยเองได้ที่แท็บ **ตั้งค่า** ของ `app.html` → มีผลกับหน้าจองแขกทันที
- `login.html` — เข้าสู่ระบบ (แยกเป็นผู้ดูแล / โรงแรม อัตโนมัติตามสิทธิ์)
- `app.html` — แอปของโรงแรม: แดชบอร์ด, ปฏิทินแก้ได้, ลงจอง, ห้อง&ราคา, รายงาน, ตั้งค่า
- `admin.html` — คอนโซลผู้ดูแลแพลตฟอร์ม: รวมทุกโรงแรม, เจาะดู/แก้แต่ละโรงแรม, การเงิน, แจ้งเตือน
- `book.html` — หน้าจองตรงสำหรับแขก (ลิงก์ `book.html?h=slug-โรงแรม`)
- `style.css`, `lib.js`, `config.js` — ไฟล์ร่วม
- `schema.sql` — โครงฐานข้อมูล + สิทธิ์ (RLS) + ฟังก์ชันจองสาธารณะ

---

## ขั้นที่ 1 — สร้างฐานข้อมูล Supabase
1. ไปที่ https://supabase.com → สมัคร/เข้าสู่ระบบ → **New project** (เลือก Region: Singapore)
2. รอโปรเจกต์สร้างเสร็จ → เมนู **SQL Editor** → **New query**
3. คัดลอกทั้งไฟล์ `schema.sql` ไปวาง → กด **Run** (ต้องขึ้น Success)

## ขั้นที่ 2 — ใส่คีย์ลงใน config.js
1. Supabase → **Project Settings → API**
2. คัดลอก **Project URL** และ **publishable / anon key**
3. เปิด `config.js` แก้ค่า `url` และ `key` ให้ตรง
   (คีย์ตัวนี้ปลอดภัยที่จะอยู่ในเว็บ — **ห้าม** เอา service_role/secret มาใส่)

## ขั้นที่ 3 — สร้างบัญชีเข้าใช้งาน (ทำใน Supabase)
Supabase → **Authentication → Users → Add user** (ตั้งอีเมล+รหัสผ่านเอง) แล้วกลับไป SQL Editor:

**ก) ตั้งตัวเองเป็นผู้ดูแลแพลตฟอร์ม** (แก้อีเมลให้ตรง)
```sql
insert into profiles (id, role, full_name)
select id, 'admin', 'Platform Owner' from auth.users where email='you@example.com'
on conflict (id) do update set role='admin';
```

**ข) สร้างโรงแรม + ผูกบัญชีเจ้าของโรงแรม** (สร้าง user โรงแรมใน Authentication ก่อน)
```sql
insert into hotels (slug,name,location,phone,line_id)
  values ('yhabitat','เดอะ วาย ฮาบิแทท','กาญจนบุรี','034-000-000','@yhabitat');

insert into profiles (id, hotel_id, role, full_name)
  select u.id, h.id, 'owner', 'เจ้าของโรงแรม'
  from auth.users u, hotels h
  where u.email='hotel@example.com' and h.slug='yhabitat'
  on conflict (id) do update set hotel_id=excluded.hotel_id, role='owner';
```
(จะเพิ่มห้องผ่านหน้าเว็บแท็บ “ห้อง & ราคา” ก็ได้ ไม่ต้องรัน SQL)

## รูปภาพ (Storage)
`schema.sql` สร้าง bucket ชื่อ `hotel-media` (สาธารณะ) ให้อัตโนมัติ — โรงแรมอัปรูปหน้าปก/ห้อง/โปรโมชัน/บริการได้จากแท็บ **หน้าเว็บ** และ **ห้อง & ราคา**
ถ้า SQL ส่วน storage รันไม่ผ่าน (บางโปรเจกต์สิทธิ์ต่างกัน) ให้สร้างเองที่ Supabase → **Storage → New bucket** ตั้งชื่อ `hotel-media` แล้วติ๊ก **Public**

## ขั้นที่ 4 — เอาเว็บขึ้นออนไลน์ (เลือกทางใดทางหนึ่ง)

### ทางที่ง่ายสุด: Netlify Drop
1. ไปที่ https://app.netlify.com/drop
2. ลากทั้ง **โฟลเดอร์ `easybooking-app`** ทิ้งลงหน้าเว็บ → ได้ลิงก์ทันที

### หรือ Cloudflare Pages
1. บีบอัดโฟลเดอร์เป็น `.zip` (Cloudflare รับเฉพาะ .zip)
2. Cloudflare → **Workers & Pages → Create → Pages → Upload assets** → อัปโหลด zip

> ⚠️ ก่อน deploy ต้องแก้ `config.js` ให้เป็นคีย์จริงก่อนเสมอ

## ขั้นที่ 5 — ตั้งค่าใน Supabase Auth (สำคัญ)
Supabase → **Authentication → URL Configuration** → ใส่โดเมนเว็บของคุณใน **Site URL**
(เช่น `https://easybooking.netlify.app`) เพื่อให้ระบบล็อกอินทำงานถูกต้อง

## ขั้นที่ 6 — ใช้งาน
- เจ้าของโรงแรมเข้าที่ `.../login.html` → ไป `app.html` อัตโนมัติ
- ผู้ดูแล (คุณ) เข้าที่เดียวกัน → ไป `admin.html` อัตโนมัติ
- ลิงก์จองตรงของโรงแรมอยู่ในแท็บ **ตั้งค่า** ของ `app.html` (เช่น `.../book.html?h=yhabitat`)
  ส่งลิงก์นี้ให้แขก แขกจองเอง → เข้าปฏิทินทันที

---

## ข้อความยืนยันอัตโนมัติ (Edge Function `notify`)
ทำให้ "ทุกการจองใหม่ → ส่งอีเมลยืนยันอัตโนมัติ" โดยไม่ต้องกดเอง (การจองเข้าปฏิทินอัตโนมัติอยู่แล้ว)
ไฟล์อยู่ที่ `supabase/functions/notify/index.ts` · ต้องมี Supabase CLI

ใช้ **Brevo** เป็นตัวส่ง (อีเมล + SMS) — บัญชีเดียวกับที่ใช้อยู่ได้เลย

1) Brevo → **SMTP & API → API Keys** สร้าง API key · และ **verify sender/โดเมน** ที่จะใช้ส่ง
   (ถ้าจะส่ง SMS ต้องเปิดใช้ SMS + ตั้งชื่อผู้ส่งใน Brevo ด้วย)
2) ตั้ง secret (เก็บฝั่งเซิร์ฟเวอร์ ไม่หลุดไปหน้าเว็บ) — ดูรายการเต็มใน `.env.example`:
```
supabase secrets set \
  NOTIFY_SECRET=ใส่ข้อความสุ่มยาว ๆ \
  BREVO_API_KEY=xkeysib-xxxx \
  BREVO_SENDER_EMAIL=noreply@yourdomain.com \
  BREVO_SENDER_NAME="BARN-PARK" \
  BREVO_SMS_SENDER=BARNPARK
```
   (อยากส่งทาง LINE ด้วย เพิ่ม `LINE_CHANNEL_TOKEN=...`)
3) deploy ฟังก์ชัน: `supabase functions deploy notify --no-verify-jwt`
4) ผูกให้ทำงานอัตโนมัติ: Supabase → **Database → Webhooks → Create**
   - Table: `bookings` · Event: **Insert**
   - Type: **Supabase Edge Function** → เลือก `notify`
   - HTTP Headers: เพิ่ม `x-notify-secret` = ค่าเดียวกับ NOTIFY_SECRET
5) ทดสอบ: จอง 1 รายการที่มีอีเมล → ควรได้อีเมลยืนยันภายในไม่กี่วินาที
   - ถ้าอยากให้โรงแรมได้สำเนาด้วย ใส่อีเมลในคอลัมน์ `hotels.notify_email`

> LINE Messaging API / SMS: เพิ่มได้ในไฟล์เดียวกัน (มีจุด TODO ไว้ให้) เมื่อสมัครผู้ให้บริการแล้ว
> "ยืนยันก่อนจอง (OTP)": เป็นอีกฟลोว์หนึ่ง — ส่งรหัสไปเบอร์/LINE แล้วให้ยืนยันก่อนบันทึกการจอง แจ้งได้ถ้าต้องการ

## สิ่งที่ยังไม่รวม (ทำต่อภายหลัง)
- **เชื่อม OTA อัตโนมัติ (Channex)** — เว้นไว้ก่อนตามที่ตั้งใจ; แท็บ “เชื่อม OTA” ขึ้นว่า “เร็ว ๆ นี้”
  ระหว่างนี้รับจอง OTA โดยกรอกที่แท็บ “การจอง”
- อีเมล/LINE ยืนยันอัตโนมัติ, ตัดเงินจริงผ่าน payment gateway — เพิ่มได้เมื่อพร้อม

## หมายเหตุความปลอดภัย
- ข้อมูลแต่ละโรงแรมถูกกันไม่ให้เห็นข้ามกันด้วย Row Level Security (RLS) ใน `schema.sql`
- หน้า `book.html` ให้แขกสร้างการจองได้ผ่านฟังก์ชันที่ควบคุมไว้ (ไม่เห็นข้อมูลแขกคนอื่น)
- **ยังไม่ได้ทดสอบกับฐานข้อมูลจริง** — โปรดทำตามขั้นที่ 1–3 แล้วลองล็อกอิน + กดเพิ่มการจอง 1 รายการเพื่อยืนยันก่อนใช้งานจริง
