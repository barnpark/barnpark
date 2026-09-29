import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

export function sign(user) {
  return jwt.sign(
    { id: String(user._id), role: user.role, hotel: user.hotel ? String(user.hotel) : null },
    SECRET, { expiresIn: "7d" }
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
