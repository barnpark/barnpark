import mongoose from "mongoose";

// การจองกิจกรรมแบบเดี่ยว (ไม่ผูกกับห้องพัก) เช่น นวด ทัวร์ เวิร์กช็อป
const schema = new mongoose.Schema({
  hotel:       { type: mongoose.Schema.Types.ObjectId, ref: "Hotel", required: true, index: true },
  service:     { type: mongoose.Schema.Types.ObjectId, ref: "Service" },
  serviceName: String,
  date:        { type: String, required: true }, // "YYYY-MM-DD"
  time:        { type: String, default: "" },    // รอบเวลา (ถ้ามี)
  qty:         { type: Number, default: 1 },      // จำนวนท่าน/ชุด
  amount:      { type: Number, default: 0 },
  guestName:   String,
  guestTel:    String,
  guestEmail:  String,
  note:        String,
  channel:     { type: String, default: "direct" },     // direct|walkin|phone|line|other
  status:      { type: String, default: "confirmed" },  // confirmed|cancelled
  payStatus:   { type: String, default: "unpaid" },     // unpaid|reported|paid
  payRef:      String,
  payMethod:   { type: String, default: "" },
  ref:         String,
}, { timestamps: true });

schema.index({ hotel: 1, date: 1 });
schema.index({ service: 1, date: 1 });

export default mongoose.model("ActivityBooking", schema);
