import mongoose from "mongoose";

const schema = new mongoose.Schema({
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, select: false },
  role:         { type: String, enum: ["owner", "staff", "admin"], default: "staff" },
  hotel:        { type: mongoose.Schema.Types.ObjectId, ref: "Hotel" }, // null สำหรับ admin
  name:         String,
  otpHash:      { type: String, select: false }, // รหัส OTP (hash) สำหรับยืนยันตอนล็อกอิน
  otpExpires:   Date,
  otpTries:     { type: Number, default: 0 },     // นับครั้งที่กรอก OTP ผิด (กัน brute-force)
  resetHash:    { type: String, select: false }, // รหัสตั้งรหัสผ่านใหม่ (ลืมรหัสผ่าน) — hash
  resetExpires: Date,
  resetTries:   { type: Number, default: 0 },
}, { timestamps: true });

export default mongoose.model("User", schema);
