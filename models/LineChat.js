import mongoose from "mongoose";

// แชท 1 คนใน LINE OA ของ Barn Park — จำว่าเชื่อมกับโรงแรมไหน + กำลังทำขั้นตอนอะไรค้างอยู่
const ObjectId = mongoose.Schema.Types.ObjectId;

const schema = new mongoose.Schema({
  userId:       { type: String, required: true, unique: true }, // LINE userId (ของ OA Barn Park)
  name:         String,                                          // ชื่อที่แสดงใน LINE
  hotel:        { type: ObjectId, ref: "Hotel", default: null }, // โรงแรมที่กำลังจัดการอยู่
  hotels:       { type: [ObjectId], default: [] },               // ทุกโรงแรมที่เชื่อมไว้ (สลับได้)
  user:         { type: ObjectId, ref: "User" },                 // บัญชีเจ้าของที่ผูกไว้ (ใช้เปิดเว็บหลังบ้าน)
  pendingHotel: { type: ObjectId, ref: "Hotel" },                // สมัครผ่าน LINE แล้ว รออนุมัติ
  // ขั้นตอนที่ทำค้าง (เช่น เพิ่มห้อง → ถามราคา)
  flow:         { type: String, default: "" },
  step:         { type: String, default: "" },
  data:         { type: mongoose.Schema.Types.Mixed, default: {} },
  flowAt:       Date,
  // กันเดารหัส
  codeTries:    { type: Number, default: 0 },
  codeLockUntil: Date,
  // โหมดคุยกับทีมงาน (บอทเงียบชั่วคราว) + กันบอทตอบรัว
  supportUntil: Date,
  lastNudgeAt:  Date,
  menu:         { type: String, default: "" }, // rich menu ที่ผูกล่าสุด: "" | hotel
}, { timestamps: true });

export default mongoose.model("LineChat", schema);
