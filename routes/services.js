import { Router } from "express";
import Service from "../models/Service.js";
import { requireAuth, canAccessHotel } from "../lib/auth.js";
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

r.get("/hotels/:hid/services", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.hid)) return res.status(403).json({ error: "forbidden" });
  res.json(await Service.find({ hotel: req.params.hid }).sort("sort"));
});

r.post("/hotels/:hid/services", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.hid)) return res.status(403).json({ error: "forbidden" });
  if (badImageFields(req.body, ["imageUrl"])) return res.status(400).json({ error: "รูปไม่ถูกต้อง (ใช้ไฟล์รูป หรือลิงก์ https)" });
  const { _id, ...body } = req.body || {};
  const id = new mongoose.Types.ObjectId();
  const upErr = await storeImgs(body, req.params.hid, id); if (upErr) return res.status(502).json({ error: upErr });
  res.json(await Service.create({ ...body, _id: id, hotel: req.params.hid }));
});

r.patch("/services/:id", requireAuth, async (req, res) => {
  const sv = await Service.findById(req.params.id);
  if (!sv) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, sv.hotel)) return res.status(403).json({ error: "forbidden" });
  const { hotel, _id, ...safe } = req.body || {};
  if (badImageFields(safe, ["imageUrl"])) return res.status(400).json({ error: "รูปไม่ถูกต้อง (ใช้ไฟล์รูป หรือลิงก์ https)" });
  const upErr = await storeImgs(safe, sv.hotel, sv._id); if (upErr) return res.status(502).json({ error: upErr });
  const out = await Service.findByIdAndUpdate(req.params.id, safe, { new: true });
  if (out && safe.imageUrl !== undefined) await dropImages(imageUrlsOf(sv, IMG), imageUrlsOf(out, IMG), `h/${sv.hotel}`); // ลบรูปเก่าที่เลิกใช้
  res.json(out);
});

r.delete("/services/:id", requireAuth, async (req, res) => {
  const sv = await Service.findById(req.params.id);
  if (!sv) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, sv.hotel)) return res.status(403).json({ error: "forbidden" });
  await sv.deleteOne();
  await dropImages(imageUrlsOf(sv, IMG), [], `h/${sv.hotel}`);
  res.json({ ok: true });
});

export default r;
