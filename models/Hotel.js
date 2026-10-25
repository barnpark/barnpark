import mongoose from "mongoose";
import { bumpMapOnChange } from "../lib/mapcache.js";

const otaSchema = new mongoose.Schema({
  channel: String,                 // agoda | booking | trip | airbnb
  status:  { type: Number, default: 0 }, // 0 ยังไม่เชื่อม / 1 เชื่อมแล้ว / 2 ขัดข้อง / 3 โรงแรมส่งคำขอเชื่อมแล้ว (รอทีมงาน)
  propertyId:  String,             // รหัสที่พักใน OTA นั้น (โรงแรมส่งมาทาง LINE)
  requestedAt: Date,
}, { _id: false });

const schema = new mongoose.Schema({
  slug:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  name:        String,
  location:    String,
  phone:       String,
  lineId:      String,             // LINE OA ของที่พักให้แขกทักแชท: @id หรือลิงก์ lin.ee/line.me (ปุ่ม LINE ลอยบนหน้าจอง)
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
  coverData:   { type: String, select: false }, // รูปปกที่อัปผ่าน LINE (data URL) — เสิร์ฟที่ /api/public/img/cover/:id
  logoUrl:     String,                          // โลโก้ที่พัก (หัวเว็บ/ท้ายเว็บ/ไอคอนแท็บ) — /api/public/img/logo/:id/0
  logoData:    { type: String, select: false }, // data URL ของโลโก้ (PNG พื้นใสได้)
  logoAspect:  Number,                          // กว้าง ÷ สูง ของโลโก้ (≥ 2 = โลโก้ตัวหนังสือยาว มีชื่ออยู่ในรูปแล้ว)
  about:       String,
  amenities:   { type: [String], default: [] }, // สิ่งอำนวยความสะดวกของที่พัก (สระว่ายน้ำ ที่จอดรถ ฯลฯ)
  promoText:   String,
  promoImage:  String,
  notifyEmail: String,             // อีเมลรับแจ้งเตือนของโรงแรม
  notifyLineTo: String,            // LINE userId/groupId ของโรงแรม ที่จะรับแจ้งเตือนเมื่อมีจองใหม่
  promptpayId: String,             // เบอร์พร้อมเพย์ (08x) หรือเลขบัตร ปชช. ของโรงแรม สำหรับสร้าง QR รับเงิน
  promptpayName: String,           // ชื่อบัญชี/ชื่อร้าน แสดงคู่ QR
  // ===== วิธีรับเงินจากแขก (ที่พักเปิด/ปิดเองทีละช่องทาง — ดู lib/pay.js) =====
  payPromptpay: { type: Boolean, default: true },  // 📱 พร้อมเพย์ (ต้องมี promptpayId)
  payTransfer:  { type: Boolean, default: true },  // 🏦 โอนเข้าบัญชี (ต้องมีเลขบัญชี)
  payOnsite:    { type: Boolean, default: false }, // 💵 จ่ายที่เคาน์เตอร์ตอนเช็คอิน (ระบบไม่ยกเลิกเอง)
  bankName:        String,         // ธนาคาร เช่น กสิกรไทย
  bankAccountNo:   String,         // เลขบัญชี (ตัวเลขล้วน)
  bankAccountName: String,         // ชื่อบัญชี
  taxId:       String,             // เลขประจำตัวผู้เสียภาษี (สำหรับใบเสร็จ/ใบกำกับภาษี)
  address:     String,             // ที่อยู่โรงแรม (แสดงบนใบเสร็จ + หน้าจอง)
  // ===== ข้อมูลการเข้าพัก (แสดงบนหน้าจอง + อีเมลยืนยัน + หน้ายืนยันการจอง) =====
  checkInTime:  String,            // "14:00" — ไม่ตั้ง default เพื่อไม่แสดงเวลาที่โรงแรมไม่ได้ยืนยัน
  checkOutTime: String,            // "12:00"
  mapUrl:       String,            // ลิงก์ Google Maps (https) — ส่งตำแหน่งผ่าน LINE ได้
  houseRules:   String,            // กฎที่พัก/ข้อควรรู้ (หลายบรรทัด) เช่น ห้ามสูบบุหรี่ในห้อง งดเสียงดังหลัง 22:00
  status:      { type: String, default: "active" }, // active | onboarding | paused
  approved:    { type: Boolean, default: true },      // แอดมินอนุมัติเปิดรับจองหรือยัง (สมัครเอง = false)
  planFee:     { type: Number, default: 800 },
  allowGuestCancel: { type: Boolean, default: true }, // ให้แขกยกเลิกเองได้ไหม
  onMap:       { type: Boolean, default: true },      // แสดงบนแผนที่หน้าแรก Barn Park (ปิดได้ในเว็บหลังบ้าน)
  geo:         { lat: Number, lng: Number },          // พิกัดจาก mapUrl (lib/geo.js คำนวณให้เอง)
  geoFrom:     String,                                // mapUrl ที่ใช้คำนวณ geo ล่าสุด (เปลี่ยนลิงก์ = คำนวณใหม่)
  cancelDays:  { type: Number, default: 3 },          // ยกเลิกฟรีก่อนเช็คอินกี่วัน
  holdHours:   { type: Number, default: 24 },         // ปล่อยห้องที่จองค้างไม่จ่ายอัตโนมัติ (ชม.) · 0 = ปิด
  ota:         { type: [otaSchema], default: [] },
  // ===== ความลับต่อโรงแรม — select:false กันหลุดออก API ปกติ =====
  storageQuotaMB:    Number, // โควตาพื้นที่ของที่พัก (MB) — ว่าง = ค่าเริ่มต้น 20 (env HOTEL_QUOTA_MB) · แอดมินตั้ง (lib/storage.js)
  lineChannelToken:  { type: String, select: false }, // Channel access token ของ LINE OA โรงแรม
  lineChannelSecret: { type: String, select: false }, // Channel secret (ตรวจ signature webhook)
  lineForwardUrl:    { type: String, select: false }, // OA ใช้ร่วมกับระบบอื่น: ข้อความที่ไม่ใช่ของ Barn Park ส่งต่อไป Webhook นี้ (lib/lineforward.js)
}, { timestamps: true });

bumpMapOnChange(schema, ["geo", "geoFrom"]); // แผนที่หน้าแรกอัปเดตทันทีเมื่อที่พักเปลี่ยน (lib/mapcache.js)
export default mongoose.model("Hotel", schema);
