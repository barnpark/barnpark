import mongoose from "mongoose";

const schema = new mongoose.Schema({
  hotel:     { type: mongoose.Schema.Types.ObjectId, ref: "Hotel", required: true, index: true },
  ref:       String,                 // เลขการจองที่อ้างอิง (ยืนยันว่าเคยพักจริง)
  guestName: String,
  rating:    { type: Number, min: 1, max: 5, default: 5 },
  text:      String,
  approved:  { type: Boolean, default: false }, // โรงแรมอนุมัติก่อนแสดง (กันสแปม)
}, { timestamps: true });

export default mongoose.model("Review", schema);
