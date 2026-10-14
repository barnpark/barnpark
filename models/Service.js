import mongoose from "mongoose";

const schema = new mongoose.Schema({
  hotel:       { type: mongoose.Schema.Types.ObjectId, ref: "Hotel", required: true, index: true },
  name:        String,
  description: String,
  price:       Number,
  imageUrl:    String,
  hidden:      { type: Boolean, default: false }, // ปิดขายชั่วคราว
  // ขายแบบไหน: addon = ซื้อพ่วงตอนจองห้อง · standalone = จองกิจกรรมเดี่ยว (ไม่ต้องพัก) · both = ได้ทั้งสองแบบ
  saleMode:    { type: String, default: "addon" },
  unit:        { type: String, default: "ต่อท่าน" },  // หน่วยราคา เช่น ต่อท่าน / ต่อครั้ง / ต่อกลุ่ม
  dailyCap:    { type: Number, default: 0 },          // รับได้กี่ท่านต่อรอบ (หรือต่อวันถ้าไม่มีรอบ) · 0 = ไม่จำกัด
  times:       { type: [String], default: [] },       // รอบเวลา เช่น ["09:00","14:00"] (ว่าง = ไม่มีรอบ)
  sort:        { type: Number, default: 0 },
}, { timestamps: true });

export default mongoose.model("Service", schema);
