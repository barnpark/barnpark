import { Router } from "express";
import Service from "../models/Service.js";
import { requireAuth, canAccessHotel } from "../lib/auth.js";
import { actor, logAction } from "../lib/team.js";
import { badImageFields } from "../lib/security.js";
import mongoose from "mongoose";
import { storeImageFields, imageUrlsOf, dropImages } from "../lib/filestore.js";

const IMG = ["imageUrl"];
// รูปที่เป็น data URL → อัปขึ้น Supabase (ถ้าตั้งค่าไว้) แล้วเก็บแค่ลิงก์ · คืนข้อความ error หรือ null
async function storeImgs(body, hid, id) {
  try { await storeImageFields(body, IMG, `h/${hid}/svc-${id}`); return null; }
  catch (e) { return "อัปโหลดรูปไม่สำเร็จ: " + (e.message || e); }
}

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
  const body = pickSvc(req.body);
  const who = await actor(req, res, req.params.hid, "services"); if (!who) return;
  const id = new mongoose.Types.ObjectId();
  const upErr = await storeImgs(body, req.params.hid, id); if (upErr) return res.status(502).json({ error: upErr });
  const created = await Service.create({ ...body, _id: id, hotel: req.params.hid });
  await logAction(req.params.hid, who, "service.create", created.name);
  res.json(created);
});

r.patch("/services/:id", requireAuth, async (req, res) => {
  const sv = await Service.findById(req.params.id);
  if (!sv) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, sv.hotel)) return res.status(403).json({ error: "forbidden" });
  const safe = pickSvc(req.body);
  if (badImageFields(safe, ["imageUrl"])) return res.status(400).json({ error: "รูปไม่ถูกต้อง (ใช้ไฟล์รูป หรือลิงก์ https)" });
  const who = await actor(req, res, sv.hotel, "services"); if (!who) return;
  const upErr = await storeImgs(safe, sv.hotel, sv._id); if (upErr) return res.status(502).json({ error: upErr });
  const out = await Service.findByIdAndUpdate(sv._id, { $set: safe }, { new: true });
  await logAction(sv.hotel, who, "service.edit", sv.name, Object.keys(safe).join(", "));
  if (out && safe.imageUrl !== undefined) await dropImages(imageUrlsOf(sv, IMG), imageUrlsOf(out, IMG), `h/${sv.hotel}`); // ลบรูปเก่าที่เลิกใช้
  res.json(out);
});

r.delete("/services/:id", requireAuth, async (req, res) => {
  const sv = await Service.findById(req.params.id);
  if (!sv) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, sv.hotel)) return res.status(403).json({ error: "forbidden" });
  const who = await actor(req, res, sv.hotel, "services"); if (!who) return;
  await sv.deleteOne();
  await logAction(sv.hotel, who, "service.delete", sv.name);
  await dropImages(imageUrlsOf(sv, IMG), [], `h/${sv.hotel}`);
  res.json({ ok: true });
});

export default r;
