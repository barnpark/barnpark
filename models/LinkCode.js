import mongoose from "mongoose";

// รหัสใช้ครั้งเดียว
//  - purpose "link"  : รหัส 6 ตัวให้โรงแรมพิมพ์ใน LINE Barn Park เพื่อเชื่อมบัญชี (อายุ 7 วัน)
//  - purpose "magic" : ลิงก์เข้าเว็บหลังบ้านจาก LINE โดยไม่ต้องกรอกรหัสผ่าน (อายุ 10 นาที)
const schema = new mongoose.Schema({
  code:      { type: String, required: true, unique: true },
  purpose:   { type: String, default: "link" },
  hotel:     { type: mongoose.Schema.Types.ObjectId, ref: "Hotel", required: true },
  user:      { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  expiresAt: { type: Date, required: true },
  usedAt:    Date,
  usedBy:    String, // LINE userId ที่ใช้รหัส
}, { timestamps: true });

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // MongoDB ลบรหัสหมดอายุให้อัตโนมัติ

export default mongoose.model("LinkCode", schema);
