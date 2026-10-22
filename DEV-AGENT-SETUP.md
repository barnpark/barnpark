# คู่มือ: สั่งงานแก้เว็บผ่าน LINE ให้ Claude Code ทำ

พิมพ์ในแชท LINE Barn Park ว่า **`งาน: <สิ่งที่อยากให้แก้>`** แล้ว Claude Code จะแก้โค้ดบนเครื่องของ GitHub จากนั้นเปิด **Pull Request** ให้ตรวจ พร้อม **ไฟล์ zip** และแจ้งผลกลับใน LINE

**เว็บจริงไม่เปลี่ยน จนกว่าเบลล์จะกด Merge เอง**

```
LINE "งาน: ..."  →  Barn Park (Render)  →  GitHub Actions + Claude Code  →  Pull Request + zip  →  LINE แจ้งผล
                                                                              ↓
                                                         เบลล์ตรวจ แล้วกด Merge → Render deploy เอง
```

ตั้งค่าครั้งเดียว ใช้เวลาประมาณ 20 นาที รหัสลับทุกตัว เบลล์เป็นคนใส่เองใน GitHub และ Render

---

## ก. GitHub

### 1. เอาไฟล์ชุดนี้ขึ้น repo ของ Barn Park (สาขา `main`)

ไฟล์ที่ต้องมีใน repo:

- `.github/workflows/line-job.yml`
- `.github/scripts/` (3 ไฟล์)
- `CLAUDE.md`
- `test/`
- `lib/devjobs.js`
- `routes/dev.js`
- `models/DevJob.js`

ไฟล์ workflow ต้องอยู่ในสาขา `main` ก่อน ระบบถึงจะสั่งงานได้

> โฟลเดอร์ `.github` เป็นโฟลเดอร์ซ่อน บน Mac ให้กด **Cmd + Shift + .** ใน Finder ให้เห็นก่อนลากขึ้น GitHub
> หรือใช้ GitHub Desktop ซึ่งเห็นไฟล์ซ่อนเอง

### 2. ให้ GitHub Actions เปิด Pull Request ได้

ไปที่ repo → **Settings** → **Actions** → **General** → หัวข้อ **Workflow permissions**

- เลือก **Read and write permissions**
- ติ๊ก **Allow GitHub Actions to create and approve pull requests**
- กด **Save**

### 3. ใส่ token ของ Claude (เลือกแบบใดแบบหนึ่ง)

ไปที่ repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

- **แบบที่ 1: ใช้แพ็กเกจ Claude Pro/Max** (นับรวมในโควตาแพ็กเกจ)
  1. ติดตั้ง Claude Code บน Mac
  2. เปิด Terminal แล้วพิมพ์ `claude setup-token`
  3. คัดลอก token ที่ได้ ไปสร้าง secret ชื่อ `CLAUDE_CODE_OAUTH_TOKEN`
- **แบบที่ 2: ใช้ API key** (จ่ายตามการใช้จริง)
  1. ที่ console.anthropic.com → **API keys** → สร้าง key
  2. สร้าง secret ชื่อ `ANTHROPIC_API_KEY`

### 4. Secret อีก 2 ตัว

| ชื่อ | ค่า |
|---|---|
| `BARNPARK_CALLBACK_URL` | `https://barnpark.onrender.com/api/dev/job-callback` (ถ้าใช้โดเมนอื่น ให้เปลี่ยนส่วนหน้าตามนั้น) |
| `DEV_JOB_SECRET` | รหัสลับยาว ๆ ที่ตั้งเอง อย่างน้อย 16 ตัวอักษร ต้องเป็นค่าเดียวกับที่ใส่ใน Render |

### 5. สร้าง token ให้ Barn Park สั่งงาน GitHub

1. ที่ github.com กดรูปโปรไฟล์ → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
2. **Repository access:** เลือก Only select repositories แล้วเลือก repo ของ Barn Park
3. **Permissions → Repository permissions → Actions:** เลือก Read and write สิทธิ์นี้อย่างเดียวพอ ไม่ต้องให้สิทธิ์อื่น
4. **Expiration:** เลือกวันหมดอายุ แล้วจดไว้ว่าต้องสร้างใหม่เมื่อไร
5. คัดลอก token ไปใส่ใน Render ตามข้อ ข.

---

## ข. Render

ไปที่ service ของ Barn Park → **Environment** → เพิ่มค่าต่อไปนี้ แล้วกด **Save** (Render จะ deploy ใหม่เอง)

| ชื่อ | ค่า |
|---|---|
| `GITHUB_TOKEN` | token จากข้อ 5 |
| `GITHUB_REPO` | ชื่อบัญชี/ชื่อ repo เช่น `bell/barn-park` (ดูได้จาก URL ของ repo) |
| `DEV_JOB_SECRET` | ค่าเดียวกับข้อ 4 |
| `DEV_LINE_USERS` | LINE userId ของทีมที่สั่งงานได้ คั่นด้วย `,` |

- LINE ของเบลล์ (ค่า `ADMIN_LINE_TO`) ได้สิทธิ์อัตโนมัติ
- ให้ทีมพิมพ์ **`ไอดี`** ในแชท LINE Barn Park แล้วส่ง userId ที่บอทตอบมาให้เบลล์
- คนที่ไม่อยู่ในรายชื่อ พิมพ์ "งาน:" ไปก็ไม่มีผลอะไร

---

## ค. ทดสอบงานแรก

1. ในแชท LINE Barn Park พิมพ์: `งาน: เปลี่ยนข้อความใต้วิดีโอหน้าแรกเป็น "ดูวิธีใช้ใน 1 นาที"`
2. บอทตอบ **📥 รับงาน #1 แล้ว**
3. ที่ GitHub แท็บ **Actions** จะเห็น "LINE job (Claude Code)" กำลังทำงาน ใช้เวลาประมาณ 5–15 นาที
4. LINE แจ้งผลพร้อมปุ่ม **🔍 ดูการแก้ / Merge** และ **⬇ ไฟล์ zip**
5. ดูการแก้ในแท็บ **Files changed** ของ Pull Request
   - ถ้าโอเค กด **Merge pull request** แล้ว Render จะ deploy ให้เอง
   - ถ้าไม่โอเค กด **Close pull request** เว็บจริงไม่เปลี่ยน

พิมพ์ **`สถานะงาน`** เพื่อดูงานล่าสุด 5 งาน

**เคล็ดลับการสั่งงาน:** บอกว่าแก้ที่หน้าไหน และอยากให้เป็นแบบไหน เช่น `งาน: หน้าจองแบบ Bento ให้ปุ่ม "จองเลย" ใหญ่ขึ้นบนมือถือ`

งานเสี่ยง Claude Code จะไม่เดา แต่จะตอบกลับว่าทำไมถึงไม่ได้แก้ ได้แก่:

- งานที่ไม่ชัดเจน
- การลบข้อมูล
- การเปลี่ยนระบบจ่ายเงินหรือการล็อกอิน

---

## ง. ถ้ามีปัญหา

| อาการ | วิธีแก้ |
|---|---|
| บอทตอบ "ยังไม่ได้ตั้งค่าระบบรับงาน" | ยังไม่ได้ใส่ `GITHUB_TOKEN` / `GITHUB_REPO` ใน Render |
| "ส่งให้ GitHub ไม่สำเร็จ (404)" | ชื่อ repo ผิด, ไฟล์ `line-job.yml` ยังไม่อยู่ในสาขา main หรือ token ไม่ได้เลือก repo นี้ |
| "ส่งให้ GitHub ไม่สำเร็จ (401/403)" | token หมดอายุ หรือสิทธิ์ Actions ไม่ใช่ Read and write |
| งานเสร็จแต่ "เปิด Pull Request ไม่สำเร็จ" | ทำข้อ ก.2 แล้วสั่งงานใหม่ (ไฟล์ zip ยังดาวน์โหลดได้จากบันทึกการทำงาน) |
| ไม่มีข้อความแจ้งผลใน LINE | ตรวจ `BARNPARK_CALLBACK_URL` และดูว่า `DEV_JOB_SECRET` ตรงกันทั้ง GitHub และ Render แล้วดู log ขั้น "Tell Barn Park the result" ใน GitHub |
| "Claude Code ทำงานไม่จบ" | เปิดบันทึกการทำงาน ดูขั้น "Claude Code does the job" สาเหตุที่พบบ่อยคือ token ผิด, โควตาหมด หรืองานใหญ่เกินไป (ลองแบ่งเป็นงานย่อย) |

---

## จ. ค่าใช้จ่าย

- **GitHub Actions:** repo ส่วนตัวได้นาทีฟรีทุกเดือน ดูยอดที่ Settings → Billing งานหนึ่งใช้ประมาณ 5–15 นาที
- **Claude:**
  - ถ้าใช้ token แบบที่ 1 นับรวมในโควตาแพ็กเกจ
  - ถ้าใช้ API key แบบที่ 2 จ่ายตามการใช้จริง
  - ตั้งเพดานไว้ประมาณ $5 ต่องาน แก้ได้ที่ `MAX_BUDGET_USD` ใน workflow
- **LINE:**
  - ข้อความ "รับงาน" เป็น reply ไม่นับโควตา
  - ข้อความแจ้งผลใช้โควตา 1 ข้อความต่องาน
- จำกัดไว้ไม่เกิน 10 งานต่อชั่วโมงต่อคน

## ฉ. ความปลอดภัย

- **ใครสั่งงานได้:** เฉพาะ LINE ที่อยู่ในรายชื่อ คนอื่นสั่งงานไม่ได้
- **Claude Code มองไม่เห็นรหัสของเว็บจริง** เช่น รหัสฐานข้อมูล หรือรหัส LINE เพราะรหัสพวกนี้อยู่ใน Render เท่านั้น
- **ไฟล์ที่ห้ามแก้:** Claude Code แก้ `.github/`, `render.yaml` และไฟล์ `.env` ไม่ได้ ถ้าเผลอแก้ ระบบจะคืนค่าเดิมให้
- **ข้อจำกัดอื่น:** Claude Code เข้าเว็บภายนอกไม่ได้ และ push เข้า `main` ไม่ได้ ทำได้แค่สาขา `line-job/<เลขงาน>`
- **เว็บจริงจะเปลี่ยนก็ต่อเมื่อเบลล์กด Merge เท่านั้น**
