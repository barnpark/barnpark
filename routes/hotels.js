import { Router } from "express";
import bcrypt from "bcryptjs";
import Hotel from "../models/Hotel.js";
import User from "../models/User.js";
import RoomType from "../models/RoomType.js";
import Booking from "../models/Booking.js";
import Service from "../models/Service.js";
import { requireAuth, requireAdmin, canAccessHotel } from "../lib/auth.js";

const r = Router();

// สำรองข้อมูลทั้งระบบเป็น JSON (แอดมินเท่านั้น) — กดดาวน์โหลดเก็บไว้เอง
r.get("/admin/export", requireAuth, requireAdmin, async (_req, res) => {
  const [hotels, users, rooms, bookings, services] = await Promise.all([
    Hotel.find().lean(), User.find().select("-passwordHash -otpHash").lean(),
    RoomType.find().lean(), Booking.find().lean(), Service.find().lean(),
  ]);
  res.setHeader("Content-Disposition", 'attachment; filename="barnpark-backup-' + new Date().toISOString().slice(0, 10) + '.json"');
  res.json({ exportedAt: new Date().toISOString(), hotels, users, rooms, bookings, services });
});

// เพิ่มโรงแรมใหม่ + สร้างบัญชีเจ้าของ (admin เท่านั้น)
r.post("/hotels/onboard", requireAuth, requireAdmin, async (req, res) => {
  const { name, slug, location, ownerEmail, ownerPassword, ownerName } = req.body || {};
  if (!name || !slug || !ownerEmail || !ownerPassword)
    return res.status(400).json({ error: "กรอกชื่อโรงแรม, slug, อีเมลและรหัสเจ้าของให้ครบ" });
  const s = String(slug).toLowerCase().trim();
  if (await Hotel.findOne({ slug: s })) return res.status(409).json({ error: "slug นี้ถูกใช้แล้ว" });
  if (await User.findOne({ email: String(ownerEmail).toLowerCase() })) return res.status(409).json({ error: "อีเมลนี้มีบัญชีแล้ว" });
  const hotel = await Hotel.create({
    name, slug: s, location: location || "", status: "onboarding",
    ota: [{ channel: "agoda", status: 0 }, { channel: "booking", status: 0 }, { channel: "trip", status: 0 }],
  });
  await User.create({
    email: String(ownerEmail).toLowerCase(), role: "owner", name: ownerName || name,
    hotel: hotel._id, passwordHash: bcrypt.hashSync(ownerPassword, 10),
  });
  res.json({ ok: true, hotel });
});

// list — admin เห็นทุกที่ / staff เห็นเฉพาะของตัวเอง
r.get("/hotels", requireAuth, async (req, res) => {
  const q = req.user.role === "admin" ? {} : { _id: req.user.hotel };
  res.json(await Hotel.find(q).sort("createdAt"));
});

r.get("/hotels/:id", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.id)) return res.status(403).json({ error: "forbidden" });
  const h = await Hotel.findById(req.params.id);
  if (!h) return res.status(404).json({ error: "not found" });
  res.json(h);
});

r.post("/hotels", requireAuth, requireAdmin, async (req, res) => {
  try { res.json(await Hotel.create(req.body)); }
  catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

r.patch("/hotels/:id", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.id)) return res.status(403).json({ error: "forbidden" });
  const { lineChannelToken, lineChannelSecret, ...safe } = req.body; // secret ผ่าน route แยกเท่านั้น
  res.json(await Hotel.findByIdAndUpdate(req.params.id, safe, { new: true }));
});

// ===== LINE OA ต่อโรงแรม =====
// ดูสถานะการเชื่อม (ไม่คืน token)
r.get("/hotels/:id/line", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.id)) return res.status(403).json({ error: "forbidden" });
  const h = await Hotel.findById(req.params.id).select("+lineChannelToken lineId");
  res.json({ lineId: h?.lineId || "", connected: !!(h && h.lineChannelToken) });
});
// บันทึกการเชื่อม (token เก็บใน DB, select:false ไม่หลุด API ปกติ)
r.patch("/hotels/:id/line", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.id)) return res.status(403).json({ error: "forbidden" });
  const { lineId, lineChannelToken, lineChannelSecret } = req.body || {};
  const set = { lineId };
  if (lineChannelToken !== undefined) set.lineChannelToken = lineChannelToken;
  if (lineChannelSecret !== undefined) set.lineChannelSecret = lineChannelSecret;
  await Hotel.findByIdAndUpdate(req.params.id, set);
  res.json({ ok: true });
});

export default r;
