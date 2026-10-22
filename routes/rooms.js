import { Router } from "express";
import RoomType from "../models/RoomType.js";
import { requireAuth, canAccessHotel } from "../lib/auth.js";
import { badImageFields } from "../lib/security.js";
import { cleanBreakfast } from "../lib/stay.js";
import mongoose from "mongoose";
import { storeImageFields, imageUrlsOf, dropImages } from "../lib/filestore.js";
// ตรวจค่าอาหารเช้าใน body (คืน error หรือ null) — optional ต้องมีราคา > 0
function fixBreakfast(body) {
  if (body.breakfast === undefined && body.breakfastPrice === undefined) return null;
  if (body.breakfast === undefined) { delete body.breakfastPrice; return null; } // ราคาอย่างเดียว ไม่มีโหมด → ไม่ยุ่ง
  const bf = cleanBreakfast(body.breakfast, body.breakfastPrice);
  if (!bf) return "ตั้งค่าอาหารเช้าไม่ถูกต้อง (แบบ “เลือกเพิ่ม” ต้องใส่ราคาต่อท่าน)";
  Object.assign(body, bf);
  return null;
}
const IMG = ["images", "imageUrl"];
// รูปที่เป็น data URL → อัปขึ้น Supabase (ถ้าตั้งค่าไว้) แล้วเก็บแค่ลิงก์ · คืนข้อความ error หรือ null
async function storeImgs(body, hid, id) {
  try { await storeImageFields(body, IMG, `h/${hid}/room-${id}`); return null; }
  catch (e) { return "อัปโหลดรูปไม่สำเร็จ: " + (e.message || e); }
}

const r = Router();

r.get("/hotels/:hid/rooms", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.hid)) return res.status(403).json({ error: "forbidden" });
  res.json(await RoomType.find({ hotel: req.params.hid }).sort("sort"));
});

r.post("/hotels/:hid/rooms", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.hid)) return res.status(403).json({ error: "forbidden" });
  if (badImageFields(req.body, IMG)) return res.status(400).json({ error: "รูปไม่ถูกต้อง (ใช้ไฟล์รูป หรือลิงก์ https)" });
  const { _id, ...body } = req.body || {};
  const bfErr = fixBreakfast(body); if (bfErr) return res.status(400).json({ error: bfErr });
  const id = new mongoose.Types.ObjectId();
  const upErr = await storeImgs(body, req.params.hid, id); if (upErr) return res.status(502).json({ error: upErr });
  res.json(await RoomType.create({ ...body, _id: id, hotel: req.params.hid }));
});

r.patch("/rooms/:id", requireAuth, async (req, res) => {
  const rt = await RoomType.findById(req.params.id);
  if (!rt) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, rt.hotel)) return res.status(403).json({ error: "forbidden" });
  const { hotel, _id, ...safe } = req.body || {};
  if (badImageFields(safe, IMG)) return res.status(400).json({ error: "รูปไม่ถูกต้อง (ใช้ไฟล์รูป หรือลิงก์ https)" });
  const bfErr = fixBreakfast(safe); if (bfErr) return res.status(400).json({ error: bfErr });
  const upErr = await storeImgs(safe, rt.hotel, rt._id); if (upErr) return res.status(502).json({ error: upErr });
  const out = await RoomType.findByIdAndUpdate(req.params.id, safe, { new: true });
  if (out && IMG.some((f) => safe[f] !== undefined)) await dropImages(imageUrlsOf(rt, IMG), imageUrlsOf(out, IMG), `h/${rt.hotel}`); // ลบรูปเก่าที่เลิกใช้
  res.json(out);
});

r.delete("/rooms/:id", requireAuth, async (req, res) => {
  const rt = await RoomType.findById(req.params.id);
  if (!rt) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, rt.hotel)) return res.status(403).json({ error: "forbidden" });
  await rt.deleteOne();
  await dropImages(imageUrlsOf(rt, IMG), [], `h/${rt.hotel}`);
  res.json({ ok: true });
});

export default r;
