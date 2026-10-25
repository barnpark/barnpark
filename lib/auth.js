import jwt from "jsonwebtoken";
import crypto from "crypto";

// ถ้าลืมตั้ง JWT_SECRET จะสุ่มค่าใหม่ทุกครั้งที่เปิดเซิร์ฟเวอร์ (ปลอดภัย แต่ทุกคนต้องล็อกอินใหม่หลังรีสตาร์ต)
// ห้ามใช้ค่าตายตัว เพราะคนนอกจะปลอมโทเคนแอดมินได้
const SECRET = process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16
  ? process.env.JWT_SECRET
  : crypto.randomBytes(48).toString("hex");

// อายุโทเคน 60 วัน แต่ต่ออายุทุกครั้งที่เปิดเว็บหลังบ้าน (GET /api/auth/me) → เครื่องของที่พักไม่หลุดเองถ้าใช้งานอยู่
export const TOKEN_DAYS = 60;
export function sign(user) {
  return jwt.sign(
    { id: String(user._id), role: user.role, hotel: user.hotel ? String(user.hotel) : null },
    SECRET, { expiresIn: TOKEN_DAYS + "d" }
  );
}

export function requireAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!t) return res.status(401).json({ error: "unauthorized" });
  try { req.user = jwt.verify(t, SECRET); next(); }
  catch { res.status(401).json({ error: "invalid token" }); }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "admin only" });
  next();
}

// ผู้ใช้เข้าถึงโรงแรมนี้ได้ไหม (admin เข้าได้ทุกที่ / staff เฉพาะของตัวเอง)
export function canAccessHotel(user, hotelId) {
  return user.role === "admin" || String(user.hotel) === String(hotelId);
}
