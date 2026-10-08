import { Router } from "express";
import PromoCode from "../models/PromoCode.js";
import { requireAuth, canAccessHotel } from "../lib/auth.js";

const r = Router();

r.get("/hotels/:hid/promos", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.hid)) return res.status(403).json({ error: "forbidden" });
  res.json(await PromoCode.find({ hotel: req.params.hid }).sort("-createdAt"));
});

r.post("/hotels/:hid/promos", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.hid)) return res.status(403).json({ error: "forbidden" });
  try {
    const b = req.body || {};
    const doc = await PromoCode.create({
      hotel: req.params.hid, code: b.code, type: b.type || "percent", value: +b.value || 0,
      minNights: +b.minNights || 0, maxUses: +b.maxUses || 0,
      expiresAt: b.expiresAt ? new Date(b.expiresAt) : undefined, active: b.active !== false,
    });
    res.json(doc);
  } catch (e) {
    if (String(e.message || e).includes("duplicate")) return res.status(409).json({ error: "โค้ดนี้มีอยู่แล้ว" });
    res.status(400).json({ error: String(e.message || e) });
  }
});

r.patch("/promos/:id", requireAuth, async (req, res) => {
  const p = await PromoCode.findById(req.params.id);
  if (!p) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, p.hotel)) return res.status(403).json({ error: "forbidden" });
  const { hotel, ...safe } = req.body;
  res.json(await PromoCode.findByIdAndUpdate(req.params.id, safe, { new: true }));
});

r.delete("/promos/:id", requireAuth, async (req, res) => {
  const p = await PromoCode.findById(req.params.id);
  if (!p) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, p.hotel)) return res.status(403).json({ error: "forbidden" });
  await p.deleteOne();
  res.json({ ok: true });
});

export default r;
