import { Router } from "express";
import PromoCode from "../models/PromoCode.js";
import { requireAuth, canAccessHotel } from "../lib/auth.js";
import { actor, logAction } from "../lib/team.js";

const r = Router();

r.get("/hotels/:hid/promos", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.hid)) return res.status(403).json({ error: "forbidden" });
  res.json(await PromoCode.find({ hotel: req.params.hid }).sort("-createdAt"));
});

r.post("/hotels/:hid/promos", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.hid)) return res.status(403).json({ error: "forbidden" });
  const who = await actor(req, res, req.params.hid, "promos"); if (!who) return;
  try {
    const b = req.body || {};
    const doc = await PromoCode.create({
      hotel: req.params.hid, code: b.code, type: b.type || "percent", value: +b.value || 0,
      minNights: +b.minNights || 0, maxUses: +b.maxUses || 0,
      expiresAt: b.expiresAt ? new Date(b.expiresAt) : undefined, active: b.active !== false,
    });
    await logAction(req.params.hid, who, "promo.create", doc.code);
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
  // whitelist — ย้ายโค้ดไปที่พักอื่น/รีเซ็ตจำนวนที่ใช้ไปแล้วไม่ได้
  const b = req.body || {}, set = {};
  if (b.active !== undefined) set.active = b.active === true || b.active === "true";
  if (b.type !== undefined) { if (!["percent", "amount"].includes(b.type)) return res.status(400).json({ error: "ประเภทส่วนลดไม่ถูกต้อง" }); set.type = b.type; }
  if (b.value !== undefined) set.value = Math.max(0, Math.min((set.type || p.type) === "percent" ? 100 : 1000000, Number(b.value) || 0));
  if (b.minNights !== undefined) set.minNights = Math.max(0, Math.min(365, parseInt(b.minNights, 10) || 0));
  if (b.maxUses !== undefined) set.maxUses = Math.max(0, Math.min(1000000, parseInt(b.maxUses, 10) || 0));
  if (b.expiresAt !== undefined) { const d = b.expiresAt ? new Date(b.expiresAt) : null; if (d && isNaN(d)) return res.status(400).json({ error: "วันหมดอายุไม่ถูกต้อง" }); set.expiresAt = d; }
  const who = await actor(req, res, p.hotel, "promos"); if (!who) return;
  const out = await PromoCode.findByIdAndUpdate(p._id, { $set: set }, { new: true });
  await logAction(p.hotel, who, "promo.edit", p.code, Object.keys(set).join(", "));
  res.json(out);
});

r.delete("/promos/:id", requireAuth, async (req, res) => {
  const p = await PromoCode.findById(req.params.id);
  if (!p) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, p.hotel)) return res.status(403).json({ error: "forbidden" });
  const who = await actor(req, res, p.hotel, "promos"); if (!who) return;
  await p.deleteOne();
  await logAction(p.hotel, who, "promo.delete", p.code);
  res.json({ ok: true });
});

export default r;
