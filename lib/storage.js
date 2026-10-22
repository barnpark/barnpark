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
