import mongoose from "mongoose";

// ความเห็นจากที่พักถึงทีม Barn Park — ส่งเองได้ทุกเมื่อ (LINE / เว็บหลังบ้าน) + แบบสอบถามรายเดือน (กดคะแนน 1 คลิกใน LINE)
const schema = new mongoose.Schema({
  hotel:      { type: mongoose.Schema.Types.ObjectId, ref: "Hotel", index: true },
  hotelName:  String,
  source:     { type: String, default: "line" },   // line | web | monthly
  category:   { type: String, default: "other" },  // bug | idea | praise | other
  rating:     { type: Number },                     // 1–5 ความพึงพอใจ (แบบสอบถามรายเดือน / ให้คะแนนจากเว็บ)
  month:      String,                               // "2026-10" — เดือนของแบบสอบถาม
  text:       { type: String, default: "" },
  image:      { type: String, select: false },      // ภาพหน้าจอ (data URL) — ดึงเฉพาะตอนแอดมินเปิดดู
  hasImage:   { type: Boolean, default: false },
  senderName: String,
  lineUserId: String,                               // ใช้ตอบกลับทาง LINE
  user:       { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  status:     { type: String, default: "new" },     // new | planned | done | wontfix
  reply:      { type: String, default: "" },
  repliedAt:  Date,
}, { timestamps: true });

schema.index({ source: 1, month: 1, lineUserId: 1 });

export default mongoose.model("Feedback", schema);
