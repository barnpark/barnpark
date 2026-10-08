import mongoose from "mongoose";

const otaSchema = new mongoose.Schema({
  channel: String,                 // agoda | booking | trip
  status:  { type: Number, default: 0 }, // 0 ยังไม่เชื่อม / 1 เชื่อมแล้ว / 2 ขัดข้อง
}, { _id: false });

const schema = new mongoose.Schema({
  slug:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  name:        String,
  location:    String,
  phone:       String,
  lineId:      String,             // @id ของ LINE OA (ไว้ให้แขกแอด/แสดง)
  // ===== ธีมแบรนด์ต่อโรงแรม =====
  brandColor:  { type: String, default: "#0d9488" }, // สีหลัก 1
  brandColor2: { type: String, default: "#2563eb" }, // สีหลัก 2 (คู่ไล่เฉด)
  accentColor: { type: String, default: "#f59e0b" }, // สีรอง 1
  accentColor2:{ type: String, default: "#ec4899" }, // สีรอง 2
  fontFamily:  { type: String, default: "Sarabun" }, // ฟอนต์ (Google Fonts รองรับไทย)
  uiStyle:     { type: String, default: "pill" },    // pill | soft | minimal | sharp
  template:    { type: String, default: "rich" },    // เทมเพลตหน้าจอง: rich|editorial|magazine|split|simple|catalog|classic|bento|fullscreen|immersive
  tagline:     String,
  coverUrl:    String,
  about:       String,
  promoText:   String,
  promoImage:  String,
  notifyEmail: String,             // อีเมลรับแจ้งเตือนของโรงแรม
  notifyLineTo: String,            // LINE userId/groupId ของโรงแรม ที่จะรับแจ้งเตือนเมื่อมีจองใหม่
  promptpayId: String,             // เบอร์พร้อมเพย์ (08x) หรือเลขบัตร ปชช. ของโรงแรม สำหรับสร้าง QR รับเงิน
  promptpayName: String,           // ชื่อบัญชี/ชื่อร้าน แสดงคู่ QR
  taxId:       String,             // เลขประจำตัวผู้เสียภาษี (สำหรับใบเสร็จ/ใบกำกับภาษี)
  address:     String,             // ที่อยู่โรงแรม (แสดงบนใบเสร็จ)
  status:      { type: String, default: "active" }, // active | onboarding | paused
  approved:    { type: Boolean, default: true },      // แอดมินอนุมัติเปิดรับจองหรือยัง (สมัครเอง = false)
  planFee:     { type: Number, default: 800 },
  allowGuestCancel: { type: Boolean, default: true }, // ให้แขกยกเลิกเองได้ไหม
  cancelDays:  { type: Number, default: 3 },          // ยกเลิกฟรีก่อนเช็คอินกี่วัน
  holdHours:   { type: Number, default: 24 },         // ปล่อยห้องที่จองค้างไม่จ่ายอัตโนมัติ (ชม.) · 0 = ปิด
  ota:         { type: [otaSchema], default: [] },
  // ===== ความลับต่อโรงแรม — select:false กันหลุดออก API ปกติ =====
  lineChannelToken:  { type: String, select: false }, // Channel access token ของ LINE OA โรงแรม
  lineChannelSecret: { type: String, select: false }, // Channel secret (ตรวจ signature webhook)
}, { timestamps: true });

export default mongoose.model("Hotel", schema);
