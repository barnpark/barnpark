import mongoose from "mongoose";
import { bumpMapOnChange } from "../lib/mapcache.js";

const schema = new mongoose.Schema({
  hotel:     { type: mongoose.Schema.Types.ObjectId, ref: "Hotel", required: true, index: true },
  ref:       String,                 // เลขการจองที่อ้างอิง (ยืนยันว่าเคยพักจริง)
  guestName: String,
  rating:    { type: Number, min: 1, max: 5, default: 5 },
  text:      String,
  approved:  { type: Boolean, default: false }, // โรงแรมอนุมัติก่อนแสดง (กันสแปม)
}, { timestamps: true });

bumpMapOnChange(schema, []); // คะแนนรีวิวบนแผนที่หน้าแรกอัปเดตทันทีเมื่ออนุมัติ/ลบรีวิว (lib/mapcache.js)
schema.index({ hotel: 1, ref: 1 });
export default mongoose.model("Review", schema);
