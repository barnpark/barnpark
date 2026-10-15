import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import User from "../models/User.js";
import Hotel from "../models/Hotel.js";
import { sign, requireAuth } from "../lib/auth.js";
import { sendOtp, sendResetCode, brevoReady } from "../lib/mailer.js";
import { notifyNewHotel } from "../lib/notify.js";
import { consumeMagic } from "../lib/onboard.js";

const r = Router();
const genCode = () => String(crypto.randomInt(100000, 1000000)); // สุ่มแบบปลอดภัย (ไม่ใช้ Math.random)
const userOut = (u) => ({ id: u._id, email: u.email, role: u.role, hotel: u.hotel, name: u.name });

const slugify = (s) =>
  String(s || "").toLowerCase().trim()
    .replace(/[^a-z0-9ก-๙\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/[ก-๙]/g, "")
    .replace(/^-+|-+$/g, "");

// ลงทะเบียนที่พักใหม่ด้วยตัวเอง (สาธารณะ) — สร้างโรงแรม (onboarding) + บัญชีเจ้าของ
r.post("/register", async (req, res) => {
  const { hotelName, slug, email, password, phone, location } = req.body || {};
  if (!hotelName || !email || !password)
    return res.status(400).json({ error: "กรอกชื่อที่พัก อีเมล และรหัสผ่านให้ครบ" });
  if (String(password).length < 6) return res.status(400).json({ error: "รหัสผ่านอย่างน้อย 6 ตัวอักษร" });
  const em = String(email).toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return res.status(400).json({ error: "อีเมลไม่ถูกต้อง" });
  if (await User.findOne({ email: em })) return res.status(409).json({ error: "อีเมลนี้มีบัญชีแล้ว — ลองเข้าสู่ระบบ" });

  // สร้าง slug ที่ไม่ซ้ำ
  let base = slugify(slug) || slugify(em.split("@")[0]) || "hotel";
  let s = base, n = 1;
  while (await Hotel.findOne({ slug: s })) { n++; s = base + "-" + n; if (n > 50) { s = base + "-" + Date.now().toString(36).slice(-4); break; } }

  const hotel = await Hotel.create({
    name: hotelName, slug: s, location: location || "", phone: phone || "", status: "onboarding", notifyEmail: em,
    approved: false, // รอแอดมินอนุมัติก่อนเปิดรับจอง
    ota: [{ channel: "agoda", status: 0 }, { channel: "booking", status: 0 }, { channel: "trip", status: 0 }],
  });
  const owner = await User.create({
    email: em, role: "owner", name: hotelName, hotel: hotel._id,
    passwordHash: bcrypt.hashSync(String(password), 10),
  });
  notifyNewHotel(hotel, em).catch((e) => console.error("notifyNewHotel", e));
  // ล็อกอินให้เลยรอบแรก (ไม่ต้องกรอกรหัสซ้ำ/ไม่ต้อง OTP) — ลื่นขึ้น
  res.json({ ok: true, email: em, slug: s, bookingUrl: "/book.html?h=" + s, token: sign(owner), user: userOut(owner) });
});

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

// เข้าเว็บหลังบ้านจากลิงก์ใน LINE Barn Park (ใช้ครั้งเดียว อายุ 10 นาที)
r.post("/magic", async (req, res) => {
  const lc = await consumeMagic((req.body || {}).code);
  if (!lc) return res.status(401).json({ error: "ลิงก์หมดอายุหรือถูกใช้ไปแล้ว — ขอลิงก์ใหม่ใน LINE Barn Park (บัญชี → เข้าเว็บหลังบ้าน)" });
  const u = await User.findById(lc.user);
  if (!u || String(u.hotel) !== String(lc.hotel)) return res.status(401).json({ error: "ไม่พบบัญชีของที่พักนี้" });
  res.json({ token: sign(u), user: userOut(u) });
});

// ===== ลืมรหัสผ่าน: ขอรหัส 6 หลักทางอีเมล → ตั้งรหัสผ่านใหม่ =====
// ตอบเหมือนกันเสมอ ไม่บอกว่ามีอีเมลนี้ในระบบหรือไม่ (กันสุ่มหาอีเมล)
r.post("/forgot", async (req, res) => {
  const em = String((req.body || {}).email || "").toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return res.status(400).json({ error: "อีเมลไม่ถูกต้อง" });
  if (!brevoReady()) return res.status(503).json({ error: "ระบบส่งอีเมลยังไม่เปิด — เข้าเว็บหลังบ้านผ่าน LINE Barn Park (บัญชี → เข้าเว็บหลังบ้าน) แล้วตั้งรหัสใหม่ที่ ตั้งค่า → รหัสผ่าน หรือทักทีมงาน" });
  const u = await User.findOne({ email: em });
  if (u) {
    const code = genCode();
    u.resetHash = bcrypt.hashSync(code, 10); u.resetExpires = new Date(Date.now() + 15 * 60 * 1000); u.resetTries = 0;
    await u.save();
    try { await sendResetCode(u.email, code); } catch (e) { console.error("reset mail", e.message); return res.status(500).json({ error: "ส่งอีเมลไม่สำเร็จ ลองใหม่อีกครั้ง" }); }
  }
  res.json({ ok: true, message: "ถ้าอีเมลนี้มีบัญชีอยู่ เราส่งรหัส 6 หลักไปให้แล้ว (อายุ 15 นาที) — เช็กกล่องจดหมาย/สแปม" });
});
r.post("/reset", async (req, res) => {
  const { email, code, password } = req.body || {};
  const em = String(email || "").toLowerCase().trim();
  if (String(password || "").length < 6) return res.status(400).json({ error: "รหัสผ่านใหม่อย่างน้อย 6 ตัวอักษร" });
  const u = await User.findOne({ email: em }).select("+resetHash");
  if (!u || !u.resetHash || !u.resetExpires || u.resetExpires < new Date()) return res.status(401).json({ error: "รหัสหมดอายุหรือไม่ถูกต้อง — ขอรหัสใหม่" });
  if ((u.resetTries || 0) >= 5) {
    u.resetHash = undefined; u.resetExpires = undefined; u.resetTries = 0; await u.save();
    return res.status(429).json({ error: "กรอกรหัสผิดหลายครั้ง — ขอรหัสใหม่อีกครั้ง" });
  }
  if (!bcrypt.compareSync(String(code || ""), u.resetHash)) {
    u.resetTries = (u.resetTries || 0) + 1; await u.save();
    return res.status(401).json({ error: "รหัสไม่ถูกต้อง (เหลืออีก " + Math.max(0, 5 - u.resetTries) + " ครั้ง)" });
  }
  u.passwordHash = bcrypt.hashSync(String(password), 10);
  u.resetHash = undefined; u.resetExpires = undefined; u.resetTries = 0;
  u.otpHash = undefined; u.otpExpires = undefined; u.otpTries = 0;
  await u.save();
  res.json({ ok: true, token: sign(u), user: userOut(u) }); // ยืนยันอีเมลแล้ว → เข้าระบบให้เลย
});
// เปลี่ยนรหัสผ่าน (ล็อกอินอยู่) — บัญชีที่สมัครผ่าน LINE และยังไม่เคยตั้งรหัส ตั้งได้เลยโดยไม่ต้องใส่รหัสเดิม
r.post("/change-password", requireAuth, async (req, res) => {
  const { current = "", password = "" } = req.body || {};
  if (String(password).length < 6) return res.status(400).json({ error: "รหัสผ่านใหม่อย่างน้อย 6 ตัวอักษร" });
  const u = await User.findById(req.user.id).select("+passwordHash");
  if (!u) return res.status(404).json({ error: "ไม่พบบัญชี" });
  if (u.passwordHash && !bcrypt.compareSync(String(current), u.passwordHash)) return res.status(400).json({ error: "รหัสผ่านปัจจุบันไม่ถูกต้อง" });
  u.passwordHash = bcrypt.hashSync(String(password), 10);
  await u.save();
  res.json({ ok: true });
});
r.get("/has-password", requireAuth, async (req, res) => {
  const u = await User.findById(req.user.id).select("+passwordHash email");
  res.json({ hasPassword: !!(u && u.passwordHash), email: u ? u.email : "" });
});

r.get("/me", requireAuth, async (req, res) => {
  const u = await User.findById(req.user.id).populate("hotel");
  if (!u) return res.status(404).json({ error: "not found" });
  res.json(userOut(u));
});

export default r;
