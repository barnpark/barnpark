import { Router } from "express";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { sign, requireAuth } from "../lib/auth.js";
import { sendOtp, brevoReady } from "../lib/mailer.js";

const r = Router();
const genCode = () => String(Math.floor(100000 + Math.random() * 900000));
const userOut = (u) => ({ id: u._id, email: u.email, role: u.role, hotel: u.hotel, name: u.name });

// ขั้นที่ 1: ตรวจรหัสผ่าน → ส่ง OTP ทางอีเมล (ถ้าตั้ง Brevo แล้ว)
r.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  const u = await User.findOne({ email: (email || "").toLowerCase() }).select("+passwordHash");
  if (!u || !u.passwordHash || !bcrypt.compareSync(password || "", u.passwordHash))
    return res.status(401).json({ error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });

  // ยังไม่ได้ตั้ง Brevo → เข้าตรง (ชั่วคราว ก่อนเปิด OTP)
  if (!brevoReady()) return res.json({ token: sign(u), user: userOut(u) });

  const code = genCode();
  u.otpHash = bcrypt.hashSync(code, 10);
  u.otpExpires = new Date(Date.now() + 5 * 60 * 1000);
  u.otpTries = 0;
  await u.save();
  try { await sendOtp(u.email, code); }
  catch (e) { return res.status(500).json({ error: "ส่ง OTP ไม่สำเร็จ: " + (e.message || e) }); }
  res.json({ step: "otp", email: u.email });
});

// ขั้นที่ 2: ยืนยัน OTP → ออก token
r.post("/verify-otp", async (req, res) => {
  const { email, otp } = req.body || {};
  const u = await User.findOne({ email: (email || "").toLowerCase() }).select("+otpHash");
  if (!u || !u.otpHash || !u.otpExpires || u.otpExpires < new Date())
    return res.status(401).json({ error: "รหัสหมดอายุ กรุณาขอรหัสใหม่" });
  // กัน brute-force: เกิน 5 ครั้งให้ยกเลิกรหัสนี้ ต้องล็อกอินใหม่
  if ((u.otpTries || 0) >= 5) {
    u.otpHash = undefined; u.otpExpires = undefined; u.otpTries = 0; await u.save();
    return res.status(429).json({ error: "กรอกรหัสผิดหลายครั้ง กรุณาเข้าสู่ระบบใหม่เพื่อขอรหัสอีกครั้ง" });
  }
  if (!bcrypt.compareSync(otp || "", u.otpHash)) {
    u.otpTries = (u.otpTries || 0) + 1; await u.save();
    return res.status(401).json({ error: "รหัส OTP ไม่ถูกต้อง (เหลืออีก " + Math.max(0, 5 - u.otpTries) + " ครั้ง)" });
  }
  u.otpHash = undefined; u.otpExpires = undefined; u.otpTries = 0; await u.save();
  res.json({ token: sign(u), user: userOut(u) });
});

r.get("/me", requireAuth, async (req, res) => {
  const u = await User.findById(req.user.id).populate("hotel");
  if (!u) return res.status(404).json({ error: "not found" });
  res.json(userOut(u));
});

export default r;
