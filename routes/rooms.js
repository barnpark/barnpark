import { Router } from "express";
import RoomType from "../models/RoomType.js";
import { requireAuth, canAccessHotel } from "../lib/auth.js";
import { badImageFields } from "../lib/security.js";
import { cleanBreakfast } from "../lib/stay.js";
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
// ฟิลด์ห้องที่แก้ได้ (whitelist) — ย้ายห้องไปที่พักอื่นไม่ได้ · ตัวเลข/ข้อความถูกจำกัดช่วง
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
function pickRoom(b = {}) {
  const o = {};
  if (b.name !== undefined) o.name = String(b.name ?? "").trim().slice(0, 80);
  if (b.description !== undefined) o.description = String(b.description ?? "").slice(0, 300);
  if (b.amenities !== undefined) o.amenities = (Array.isArray(b.amenities) ? b.amenities : []).map((a) => String(a || "").trim().slice(0, 30)).filter(Boolean).slice(0, 20);
  if (b.hidden !== undefined) o.hidden = b.hidden === true || b.hidden === "true";
  if (b.capacity !== undefined) o.capacity = Math.round(num(b.capacity, 1, 50)) || 1;
  if (b.qty !== undefined) o.qty = Math.round(num(b.qty, 0, 500));
  for (const k of ["basePrice", "otaPrice", "extraBedPrice"]) if (b[k] !== undefined) o[k] = num(b[k], 0, 1000000);
  if (b.sort !== undefined) o.sort = Math.round(num(b.sort, -9999, 9999));
  for (const k of ["breakfast", "breakfastPrice", "imageUrl", "images"]) if (b[k] !== undefined) o[k] = b[k]; // ตรวจต่อใน fixBreakfast / badImageFields
  if (b.seasons !== undefined) {
    const ss = Array.isArray(b.seasons) ? b.seasons.slice(0, 50) : [];
    if (!ss.every((x) => x && YMD_RE.test(String(x.from)) && YMD_RE.test(String(x.to)) && x.to >= x.from)) return null;
    o.seasons = ss.map((x) => ({ name: String(x.name || "").slice(0, 60), from: x.from, to: x.to, price: num(x.price, 0, 1000000), minNights: Math.round(num(x.minNights, 0, 60)) }));
  }
  return o;
}

const r = Router();

r.get("/hotels/:hid/rooms", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.hid)) return res.status(403).json({ error: "forbidden" });
  res.json(await RoomType.find({ hotel: req.params.hid }).sort("sort"));
});

r.post("/hotels/:hid/rooms", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.hid)) return res.status(403).json({ error: "forbidden" });
  if (badImageFields(req.body, IMG)) return res.status(400).json({ error: "รูปไม่ถูกต้อง (ใช้ไฟล์รูป หรือลิงก์ https)" });
  const body = pickRoom(req.body);
  if (!body) return res.status(400).json({ error: "ช่วงราคาตามฤดูไม่ถูกต้อง" });
  const bfErr = fixBreakfast(body); if (bfErr) return res.status(400).json({ error: bfErr });
  res.json(await RoomType.create({ ...body, hotel: req.params.hid }));
});

r.patch("/rooms/:id", requireAuth, async (req, res) => {
  const rt = await RoomType.findById(req.params.id);
  if (!rt) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, rt.hotel)) return res.status(403).json({ error: "forbidden" });
  const safe = pickRoom(req.body);
  if (!safe) return res.status(400).json({ error: "ช่วงราคาตามฤดูไม่ถูกต้อง" });
  if (badImageFields(safe, IMG)) return res.status(400).json({ error: "รูปไม่ถูกต้อง (ใช้ไฟล์รูป หรือลิงก์ https)" });
  const bfErr = fixBreakfast(safe); if (bfErr) return res.status(400).json({ error: bfErr });
  res.json(await RoomType.findByIdAndUpdate(rt._id, { $set: safe }, { new: true }));
});

r.delete("/rooms/:id", requireAuth, async (req, res) => {
  const rt = await RoomType.findById(req.params.id);
  if (!rt) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, rt.hotel)) return res.status(403).json({ error: "forbidden" });
  await rt.deleteOne();
  res.json({ ok: true });
});

export default r;
