import { Router } from "express";
import Service from "../models/Service.js";
import { requireAuth, canAccessHotel } from "../lib/auth.js";
import { badImageFields } from "../lib/security.js";

const r = Router();
// ฟิลด์บริการที่แก้ได้ (whitelist) — ย้ายไปที่พักอื่นไม่ได้
const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
function pickSvc(b = {}) {
  const o = {};
  if (b.name !== undefined) o.name = String(b.name ?? "").trim().slice(0, 80);
  if (b.description !== undefined) o.description = String(b.description ?? "").slice(0, 300);
  if (b.unit !== undefined) o.unit = String(b.unit ?? "").trim().slice(0, 30);
  if (b.price !== undefined) o.price = num(b.price, 0, 1000000);
  if (b.imageUrl !== undefined) o.imageUrl = b.imageUrl;
  if (b.hidden !== undefined) o.hidden = b.hidden === true || b.hidden === "true";
  if (b.saleMode !== undefined) o.saleMode = ["addon", "standalone", "both"].includes(b.saleMode) ? b.saleMode : "addon";
  if (b.dailyCap !== undefined) o.dailyCap = Math.round(num(b.dailyCap, 0, 10000));
  if (b.times !== undefined) o.times = (Array.isArray(b.times) ? b.times : []).map(String).filter((t) => /^\d{2}:\d{2}$/.test(t)).slice(0, 24);
  if (b.sort !== undefined) o.sort = Math.round(num(b.sort, -9999, 9999));
  return o;
}

r.get("/hotels/:hid/services", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.hid)) return res.status(403).json({ error: "forbidden" });
  res.json(await Service.find({ hotel: req.params.hid }).sort("sort"));
});

r.post("/hotels/:hid/services", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.hid)) return res.status(403).json({ error: "forbidden" });
  if (badImageFields(req.body, ["imageUrl"])) return res.status(400).json({ error: "รูปไม่ถูกต้อง (ใช้ไฟล์รูป หรือลิงก์ https)" });
  res.json(await Service.create({ ...pickSvc(req.body), hotel: req.params.hid }));
});

r.patch("/services/:id", requireAuth, async (req, res) => {
  const sv = await Service.findById(req.params.id);
  if (!sv) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, sv.hotel)) return res.status(403).json({ error: "forbidden" });
  const safe = pickSvc(req.body);
  if (badImageFields(safe, ["imageUrl"])) return res.status(400).json({ error: "รูปไม่ถูกต้อง (ใช้ไฟล์รูป หรือลิงก์ https)" });
  res.json(await Service.findByIdAndUpdate(sv._id, { $set: safe }, { new: true }));
});

r.delete("/services/:id", requireAuth, async (req, res) => {
  const sv = await Service.findById(req.params.id);
  if (!sv) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, sv.hotel)) return res.status(403).json({ error: "forbidden" });
  await sv.deleteOne();
  res.json({ ok: true });
});

export default r;
