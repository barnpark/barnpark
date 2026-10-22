// ===== พื้นที่ฐานข้อมูลที่แต่ละที่พักใช้ (หน้าแอดมิน → 💾 พื้นที่) =====
// นับขนาดเอกสารจริงใน MongoDB ด้วย $bsonSize (ต้อง MongoDB 4.4+ — Atlas ใช้ได้)
// รูปทุกรูปเก็บเป็น data URL ในเอกสาร Hotel/RoomType/Service จึงอยู่ในกลุ่ม "รูปและข้อมูลที่พัก"
import mongoose from "mongoose";
import Hotel from "../models/Hotel.js";
import RoomType from "../models/RoomType.js";
import Service from "../models/Service.js";
import Booking from "../models/Booking.js";
import ActivityBooking from "../models/ActivityBooking.js";
import PromoCode from "../models/PromoCode.js";
import Review from "../models/Review.js";
import Feedback from "../models/Feedback.js";
import LinkCode from "../models/LinkCode.js";
import User from "../models/User.js";
import { storeReady, putImage, isDataImg } from "./filestore.js";

// ขนาดที่ใช้ได้ฟรี (Atlas M0 = 512 MB) — เปลี่ยนได้ด้วย env FREE_DB_MB ถ้าอัปเกรดแพ็กเกจ
const LIMIT_MB = () => Number(process.env.FREE_DB_MB) || 512;
const MB = 1024 * 1024;

const PARTS = [
  { key: "content", M: Hotel, by: "$_id" },
  { key: "content", M: RoomType },
  { key: "content", M: Service },
  { key: "bookings", M: Booking },
  { key: "bookings", M: ActivityBooking },
  { key: "other", M: PromoCode },
  { key: "other", M: Review },
  { key: "other", M: Feedback },
  { key: "other", M: LinkCode },
  { key: "other", M: User },
];

const sizeBy = (M, by = "$hotel") => M.aggregate([{ $group: { _id: by, bytes: { $sum: { $bsonSize: "$$ROOT" } }, n: { $sum: 1 } } }]);

export async function storageReport() {
  const hotels = await Hotel.find().select("name slug").sort("createdAt").lean();
  const row = Object.fromEntries(hotels.map((h) => [String(h._id), {
    id: h._id, name: h.name, slug: h.slug, bytes: 0, content: 0, bookings: 0, other: 0, rooms: 0, bookingCount: 0,
  }]));
  let unassigned = 0; // เอกสารที่ไม่ผูกที่พัก (เช่น บัญชีแอดมิน) หรือที่พักถูกลบไปแล้ว
  const results = await Promise.all(PARTS.map((p) => sizeBy(p.M, p.by)));
  results.forEach((groups, i) => {
    const p = PARTS[i];
    for (const g of groups) {
      const r = row[String(g._id)];
      if (!r) { unassigned += g.bytes; continue; }
      r[p.key] += g.bytes; r.bytes += g.bytes;
      if (p.M === RoomType) r.rooms = g.n;
      if (p.M === Booking) r.bookingCount = g.n;
    }
  });

  // ขนาดรวมทั้งฐาน (รวม LINE แชท ตั้งค่า และ index) — Atlas นับโควตาจาก data + index
  let db = null;
  try {
    const s = await mongoose.connection.db.stats();
    db = { dataBytes: s.dataSize || 0, indexBytes: s.indexSize || 0, storageBytes: s.storageSize || 0 };
  } catch (e) { console.warn("dbStats", e.message); }

  const list = Object.values(row).sort((a, b) => b.bytes - a.bytes);
  const hotelBytes = list.reduce((s, r) => s + r.bytes, 0);
  const usedBytes = db ? db.dataBytes + db.indexBytes : hotelBytes + unassigned;
  const limitBytes = LIMIT_MB() * MB;
  const avg = list.length ? hotelBytes / list.length : 0;
  return {
    limitBytes, usedBytes, db, hotelBytes, sharedBytes: Math.max(0, usedBytes - hotelBytes),
    avgBytes: Math.round(avg),
    // ถ้าที่พักใหม่ใช้พื้นที่เฉลี่ยเท่าที่พักตอนนี้ จะรับเพิ่มได้อีกกี่ที่
    moreHotels: avg ? Math.max(0, Math.floor((limitBytes - usedBytes) / avg)) : null,
    hotels: list,
  };
}

// ===== ย้ายรูปที่เก็บเป็น data URL ไป Supabase Storage (หน้าแอดมิน → 💾 พื้นที่ → ย้ายรูปไป Supabase) =====
//   dryRun = นับอย่างเดียว (นับในฐานข้อมูล ไม่ดึงรูปออกมา) · ทำจริงทีละชุด (limit เอกสาร) กัน Render หมดเวลา
//   after = ตัวชี้ต่อจากชุดก่อน (หน้าแอดมินส่งกลับมาเอง) · รันซ้ำได้ปลอดภัย: รูปที่ย้ายแล้วเป็น https ไม่ถูกนับอีก
const MOVE = [
  { kind: "room", M: RoomType, fields: ["images", "imageUrl"], sel: "hotel images imageUrl updatedAt", key: (d) => `h/${d.hotel}/room-${d._id}` },
  { kind: "svc", M: Service, fields: ["imageUrl"], sel: "hotel imageUrl updatedAt", key: (d) => `h/${d.hotel}/svc-${d._id}` },
  { kind: "hotel", M: Hotel, fields: ["coverData", "logoData", "coverUrl", "logoUrl", "promoImage"], sel: "+coverData +logoData",
    key: (d, f) => `h/${d._id}/${/^cover/.test(f) ? "cover" : /^logo/.test(f) ? "logo" : "promo"}` },
];
const DATA_RE = /^data:image\//;
const hasData = (fields) => ({ $or: fields.map((f) => ({ [f]: DATA_RE })) });

export async function migrateImages({ dryRun = true, limit = 10, after = {} } = {}) {
  if (dryRun) {
    const found = { docs: 0, images: 0, bytes: 0 }, byKind = {};
    for (const s of MOVE) {
      const [g] = await s.M.aggregate([
        { $match: hasData(s.fields) },
        { $project: { v: { $concatArrays: s.fields.map((f) => ({ $cond: [{ $isArray: "$" + f }, "$" + f, [{ $ifNull: ["$" + f, ""] }]] })) } } },
        { $unwind: "$v" }, { $match: { v: DATA_RE } },
        { $group: { _id: "$_id", images: { $sum: 1 }, bytes: { $sum: { $strLenBytes: "$v" } } } },
        { $group: { _id: null, docs: { $sum: 1 }, images: { $sum: "$images" }, bytes: { $sum: "$bytes" } } },
      ]);
      byKind[s.kind] = { docs: (g && g.docs) || 0, images: (g && g.images) || 0, bytes: (g && g.bytes) || 0 };
      for (const k of ["docs", "images", "bytes"]) found[k] += byKind[s.kind][k];
    }
    return { dryRun: true, ready: storeReady(), found, byKind };
  }
  if (!storeReady()) throw new Error("ยังไม่ได้ตั้งค่า Supabase (SUPABASE_URL / SUPABASE_SERVICE_KEY) ใน Render");
  let left = Math.max(1, Math.min(50, parseInt(limit, 10) || 10));
  const res = { dryRun: false, docs: 0, moved: 0, failed: 0, skipped: 0, bytesFreed: 0, errors: [], after: {} };
  for (const s of MOVE) {
    const cur = after && mongoose.isValidObjectId(after[s.kind]) ? String(after[s.kind]) : null;
    if (cur) res.after[s.kind] = cur;
    if (left <= 0) continue;
    const q = hasData(s.fields); if (cur) q._id = { $gt: cur };
    const docs = await s.M.find(q).sort("_id").limit(left).select(s.sel).lean();
    left -= docs.length;
    for (const d of docs) {
      res.docs++; res.after[s.kind] = String(d._id);
      const set = {}, done = new Map(); let moved = 0, bytes = 0;
      for (const f of s.fields) {
        const conv = async (v) => {
          if (!isDataImg(v)) return v;
          if (done.has(v)) { moved++; bytes += v.length; return done.get(v); }
          try { const u = await putImage(v, s.key(d, f)); done.set(v, u); moved++; bytes += v.length; return u; }
          catch (e) { res.failed++; if (res.errors.length < 5) res.errors.push(`${s.kind} ${d._id}: ${e.message}`); return v; }
        };
        const v = d[f];
        if (Array.isArray(v) && v.some(isDataImg)) { const out = []; for (const x of v) out.push(await conv(x)); set[f] = out; }
        else if (isDataImg(v)) set[f] = await conv(v);
      }
      // ปก/โลโก้ที่ชี้มาที่ /api/public/img/... → ชี้ไปลิงก์ Supabase ตรง ๆ (หน้าเว็บโหลดเร็วขึ้น ไม่ต้องปลุกเซิร์ฟเวอร์)
      if (s.kind === "hotel") for (const [data, url, kind] of [["coverData", "coverUrl", "cover"], ["logoData", "logoUrl", "logo"]]) {
        if (set[data] && !isDataImg(set[data]) && String(d[url] || "").startsWith(`/api/public/img/${kind}/`)) set[url] = set[data];
      }
      if (!moved) continue;
      const u = await s.M.updateOne({ _id: d._id, updatedAt: d.updatedAt }, { $set: set });
      if (!u || !u.matchedCount) { res.skipped++; continue; } // มีคนแก้เอกสารนี้ระหว่างย้าย → รอบหน้าค่อยย้ายใหม่
      res.moved += moved; res.bytesFreed += bytes;
    }
  }
  res.done = left > 0; // ทุกกลุ่มหมดก่อนครบโควตาของชุดนี้ = ไม่มีเหลือแล้ว
  return res;
}
