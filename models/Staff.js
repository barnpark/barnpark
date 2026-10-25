import mongoose from "mongoose";

// คนในทีมของที่พัก (รวมผู้จัดการ) — เครื่องของที่พักเข้าระบบด้วยอีเมลเจ้าของครั้งเดียว
// แล้วทุกคนใส่ "รหัสพนักงาน" ของตัวเองก่อนทำรายการ ระบบจึงรู้ว่าใครทำอะไร (lib/team.js)
const schema = new mongoose.Schema({
  hotel:      { type: mongoose.Schema.Types.ObjectId, ref: "Hotel", required: true, index: true },
  name:       { type: String, required: true },
  pinKey:     { type: String, required: true },          // HMAC ของรหัส (ไม่เก็บรหัสจริง) — ไม่ซ้ำในที่พักเดียวกัน
  manager:    { type: Boolean, default: false },         // ผู้จัดการ = ทำได้ทุกอย่าง + จัดการทีม/ตั้งค่าที่พัก
  perms:      { type: [String], default: [] },           // สิทธิ์ของพนักงาน (lib/team.js PERMS)
  active:     { type: Boolean, default: true },          // false = ปิดรหัสนี้ (ใช้ไม่ได้ทันที)
  lastUsedAt: Date,
}, { timestamps: true });

schema.index({ hotel: 1, pinKey: 1 }, { unique: true });
export default mongoose.model("Staff", schema);
