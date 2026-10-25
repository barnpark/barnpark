import mongoose from "mongoose";

// ประวัติการทำงาน: ใครทำอะไร เมื่อไร (lib/team.js logAction) — เก็บ ~13 เดือนแล้วลบเอง (ประหยัดพื้นที่ฐานข้อมูล)
const schema = new mongoose.Schema({
  hotel:  { type: mongoose.Schema.Types.ObjectId, ref: "Hotel", required: true },
  staff:  { type: mongoose.Schema.Types.ObjectId, ref: "Staff" },
  name:   String,          // ชื่อคนทำ ณ ตอนนั้น (เปลี่ยนชื่อ/ลบพนักงานภายหลัง ประวัติไม่เปลี่ยน)
  action: String,          // เช่น stay.in, booking.create (lib/team.js ACTION_TH)
  ref:    String,          // เลขจอง / ชื่อห้อง / เลขห้อง ที่เกี่ยวข้อง
  text:   String,          // รายละเอียดสั้น ๆ
}, { timestamps: true });

schema.index({ hotel: 1, createdAt: -1 });
schema.index({ createdAt: 1 }, { expireAfterSeconds: 400 * 86400 });
export default mongoose.model("ActionLog", schema);
