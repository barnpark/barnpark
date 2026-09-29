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
  brandColor:  { type: String, default: "#0d9488" },
  tagline:     String,
  coverUrl:    String,
  about:       String,
  promoText:   String,
  promoImage:  String,
  notifyEmail: String,             // อีเมลรับแจ้งเตือนของโรงแรม
  status:      { type: String, default: "active" }, // active | onboarding | paused
  planFee:     { type: Number, default: 800 },
  ota:         { type: [otaSchema], default: [] },
  // ===== ความลับต่อโรงแรม — select:false กันหลุดออก API ปกติ =====
  lineChannelToken:  { type: String, select: false }, // Channel access token ของ LINE OA โรงแรม
  lineChannelSecret: { type: String, select: false }, // Channel secret (ตรวจ signature webhook)
}, { timestamps: true });

export default mongoose.model("Hotel", schema);
