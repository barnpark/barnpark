// ===== ห้องว่างแบบนับรายคืน (ใช้ร่วมกัน: หน้าจองเว็บ, จองผ่านบอท, หลังบ้าน, LINE) =====
// ห้องประเภทหนึ่งว่างช่วง [din, dout) ได้ เมื่อ "ทุกคืน" ในช่วงนั้น ห้องที่ถูกใช้ + ที่จะจองเพิ่ม <= qty
// ไม่ใช่นับจำนวนการจองที่ทับช่วง (เดิม) — เช่น จอง จ.→อ. กับ พ.→พฤ. ใช้ห้องคืนละ 1 ห้องเท่านั้น
// วันที่เป็นสตริง YYYY-MM-DD (เวลาไทย) เทียบแบบสตริงได้เลย · คืน d ถูกใช้เมื่อ checkin <= d < checkout
import Booking from "../models/Booking.js";

// แขกไม่มา (stay = noshow) ไม่นับ — ที่พักขายห้องคืนที่เหลือต่อได้
const overlapQ = (din, dout) => ({ status: { $ne: "cancelled" }, stay: { $ne: "noshow" }, checkin: { $lt: dout }, checkout: { $gt: din } });

// list = การจองที่ทับช่วง → จำนวนห้องที่ใช้มากที่สุดในคืนใดคืนหนึ่งของ [din, dout)
// จำนวนห้องเพิ่มขึ้นได้เฉพาะคืนที่มีคนเช็คอิน จึงเช็กแค่คืนแรก + คืนที่มีการเช็คอินในช่วง (ไม่ต้องไล่ทุกวัน)
export function peakOf(list, din, dout) {
  const nights = new Set([din]);
  for (const b of list) if (b.checkin > din && b.checkin < dout) nights.add(b.checkin);
  let peak = 0;
  for (const d of nights) {
    let n = 0;
    for (const b of list) if (b.checkin <= d && d < b.checkout) n++;
    if (n > peak) peak = n;
  }
  return peak;
}

const okRange = (din, dout) => typeof din === "string" && typeof dout === "string" && din < dout;

// ห้องที่ใช้มากสุดต่อคืนของห้องประเภทเดียว
export async function usedPeak(roomTypeId, din, dout) {
  if (!okRange(din, dout)) return 0;
  const list = await Booking.find({ roomType: roomTypeId, ...overlapQ(din, dout) }).select("checkin checkout").lean();
  return peakOf(list, din, dout);
}

// หลายห้องในคิวรีเดียว → { [roomTypeId]: peak }
export async function usedPeaks(roomTypeIds, din, dout) {
  const out = {};
  for (const id of roomTypeIds) out[String(id)] = 0;
  if (!okRange(din, dout) || !roomTypeIds.length) return out;
  const list = await Booking.find({ roomType: { $in: roomTypeIds }, ...overlapQ(din, dout) }).select("roomType checkin checkout").lean();
  const by = {};
  for (const b of list) (by[String(b.roomType)] ||= []).push(b);
  for (const [id, l] of Object.entries(by)) out[id] = peakOf(l, din, dout);
  return out;
}

// จำนวนห้องที่ยังจองได้ตลอดช่วง
export const freeFor = async (rt, din, dout) => Math.max(0, (rt.qty || 0) - (await usedPeak(rt._id, din, dout)));
