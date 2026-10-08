import mongoose from "mongoose";

const schema = new mongoose.Schema({
  hotel:     { type: mongoose.Schema.Types.ObjectId, ref: "Hotel", required: true, index: true },
  code:      { type: String, required: true, uppercase: true, trim: true }, // เช่น DIRECT10
  type:      { type: String, enum: ["percent", "amount"], default: "percent" }, // ลด % หรือ ลดเป็นบาท
  value:     { type: Number, default: 0 },     // 10 (=10%) หรือ 200 (=200 บาท)
  minNights: { type: Number, default: 0 },     // ขั้นต่ำกี่คืนถึงใช้ได้
  expiresAt: { type: Date },                   // วันหมดอายุ (ไม่ใส่ = ไม่มีวันหมด)
  maxUses:   { type: Number, default: 0 },     // ใช้ได้กี่ครั้ง (0 = ไม่จำกัด)
  usedCount: { type: Number, default: 0 },
  active:    { type: Boolean, default: true },
}, { timestamps: true });

schema.index({ hotel: 1, code: 1 }, { unique: true });

export default mongoose.model("PromoCode", schema);
