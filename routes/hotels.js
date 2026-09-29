import { Router } from "express";
import Hotel from "../models/Hotel.js";
import { requireAuth, requireAdmin, canAccessHotel } from "../lib/auth.js";

const r = Router();

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
