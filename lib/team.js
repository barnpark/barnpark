// ===== รหัสพนักงาน: ใครทำอะไร =====
// เครื่องของที่พักเข้าระบบด้วยอีเมลเจ้าของ (ไม่หลุดเอง) · ทุกคน (รวมผู้จัดการ) มีรหัส 4–6 หลักของตัวเอง
// ทุกครั้งที่ทำรายการ (เช็คอิน เพิ่มการจอง ยืนยันรับเงิน แก้ห้อง ฯลฯ) หน้าเว็บถามรหัส แล้วส่งมาใน header x-staff-pin
// เซิร์ฟเวอร์: actor() ตรวจรหัส + สิทธิ์ ก่อนแก้ข้อมูลใด ๆ · logAction() บันทึกประวัติ
// ที่พักที่ยังไม่ตั้งทีม = ทำได้เหมือนเดิมโดยไม่ต้องใส่รหัส (บันทึกว่า "เจ้าของ")
import crypto from "crypto";
import Staff from "../models/Staff.js";
import ActionLog from "../models/ActionLog.js";

export const PERMS = {
  desk:     "🛎 หน้าเคาน์เตอร์ (เช็คอิน/เอาท์ · ทำความสะอาด)",
  bookings: "🧾 การจอง (เพิ่ม/แก้/ยกเลิก · ยืนยันรับเงิน)",
  rooms:    "🛏️ ห้อง & ราคา",
  services: "🧖 บริการเสริม & กิจกรรม",
  promos:   "🎟️ โปรโมชัน",
  reviews:  "⭐ รีวิว",
  reports:  "📈 รายงาน & ส่งออกข้อมูล",
};
export const cleanPerms = (list) => [...new Set((Array.isArray(list) ? list : []).map(String))].filter((p) => PERMS[p]);

export const ACTION_TH = {
  "booking.create": "เพิ่มการจอง", "booking.edit": "แก้การจอง", "booking.paid": "ยืนยันรับเงิน", "booking.cancel": "ยกเลิกการจอง",
  "booking.restore": "กู้คืนการจอง", "booking.delete": "ลบการจอง", "booking.export": "ส่งออกการจอง (CSV)",
  "stay.in": "เช็คอิน", "stay.out": "เช็คเอาท์", "stay.noshow": "บันทึกว่าไม่มา", "stay.undo": "ย้อนสถานะเข้าพัก", "stay.assign": "ให้เลขห้อง",
  "room.hk": "สถานะทำความสะอาด", "room.create": "เพิ่มห้อง", "room.edit": "แก้ห้อง/ราคา", "room.delete": "ลบห้อง",
  "service.create": "เพิ่มบริการ", "service.edit": "แก้บริการ", "service.delete": "ลบบริการ",
  "activity.create": "เพิ่มการจองกิจกรรม", "activity.edit": "แก้การจองกิจกรรม", "activity.delete": "ลบการจองกิจกรรม",
  "promo.create": "สร้างโค้ดโปรโมชัน", "promo.edit": "แก้โค้ดโปรโมชัน", "promo.delete": "ลบโค้ดโปรโมชัน",
  "review.edit": "อนุมัติ/ซ่อนรีวิว", "review.delete": "ลบรีวิว",
  "hotel.settings": "แก้ตั้งค่าที่พัก", "hotel.line": "แก้ตั้งค่า LINE",
  "team.create": "เพิ่มคนในทีม", "team.edit": "แก้คนในทีม", "team.delete": "ลบคนในทีม", "team.recover": "ตั้งรหัสผู้จัดการใหม่ (รหัสผ่านเจ้าของ)",
};

export const validPin = (p) => /^\d{4,6}$/.test(String(p ?? ""));
const SECRET = () => process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16 ? process.env.JWT_SECRET : "";
export const pinReady = () => !!SECRET();
// เก็บเป็น HMAC (ผูกกับที่พัก) — ค้นได้ทันทีโดยไม่ต้องไล่ bcrypt ทีละคน · ข้อมูลหลุดอย่างเดียวเดารหัสไม่ได้ถ้าไม่มี secret
export const pinKey = (hotelId, pin) => crypto.createHmac("sha256", SECRET()).update(String(hotelId) + ":" + String(pin)).digest("hex");

// กันเดารหัส: ผิด 8 ครั้งใน 10 นาที → ล็อกการใส่รหัสของที่พักนั้น 5 นาที (เก็บในหน่วยความจำ — Render รันเครื่องเดียว)
const FAILS = new Map();
const MAX_FAILS = 8, WINDOW = 10 * 60e3, LOCK = 5 * 60e3;
export function pinLocked(hid, now = Date.now()) { const f = FAILS.get(String(hid)); return !!(f && f.until > now); }
export function pinFailed(hid, now = Date.now()) {
  const k = String(hid); let f = FAILS.get(k);
  if (!f || now - f.first > WINDOW) f = { first: now, n: 0, until: 0 };
  f.n++; if (f.n >= MAX_FAILS) { f.until = now + LOCK; f.n = 0; f.first = now; }
  FAILS.set(k, f);
}
export const pinReset = (hid) => FAILS.delete(String(hid));

// สิทธิ์ของคนในทีม: perm = ชื่อสิทธิ์ | array (มีอย่างใดอย่างหนึ่ง) | "manager" | ว่าง (ใครในทีมก็ได้)
export function allowed(s, perm) {
  if (!s) return false;
  if (s.manager) return true;
  if (!perm) return true;
  if (perm === "manager") return false;
  return (Array.isArray(perm) ? perm : [perm]).some((p) => (s.perms || []).includes(p));
}
const permText = (perm) => perm === "manager" ? "ต้องใช้รหัสผู้จัดการ" : "ไม่มีสิทธิ์ " + (Array.isArray(perm) ? perm : [perm]).map((p) => PERMS[p] || p).join(" หรือ ");

// ตรวจว่าใครกำลังทำรายการนี้ — คืน { id, name, manager } หรือส่ง error ไปแล้วคืน null
// ไม่มีรหัส → 428 · รหัสผิด/ไม่มีสิทธิ์ → 403 (ไม่ใช้ 401 เพราะหน้าเว็บจะพาไปหน้าเข้าสู่ระบบ) · needPin = ให้หน้าเว็บถามรหัส
export async function actor(req, res, hotelId, perm) {
  if (req.user?.role === "admin") return { name: "แอดมิน Barn Park", admin: true };
  const team = await Staff.countDocuments({ hotel: hotelId, active: true });
  if (!team) return { name: "เจ้าของ", owner: true }; // ยังไม่ตั้งทีม → ทำงานเหมือนเดิม
  const pin = String(req.get("x-staff-pin") || "").trim();
  if (!pin) { res.status(428).json({ error: "ใส่รหัสพนักงานของคุณ", needPin: true }); return null; }
  if (pinLocked(hotelId)) { res.status(429).json({ error: "ใส่รหัสผิดหลายครั้ง — รอ 5 นาทีแล้วลองใหม่", needPin: true }); return null; }
  const s = validPin(pin) && pinReady() ? await Staff.findOne({ hotel: hotelId, pinKey: pinKey(hotelId, pin), active: true }).lean() : null;
  if (!s) { pinFailed(hotelId); res.status(403).json({ error: "รหัสไม่ถูกต้อง", needPin: true }); return null; }
  if (!allowed(s, perm)) { res.status(403).json({ error: `${s.name}: ${permText(perm)}`, needPin: true }); return null; }
  Staff.updateOne({ _id: s._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
  return { id: s._id, name: s.name, manager: !!s.manager };
}

// บันทึกประวัติ (ไม่ทำให้รายการหลักล้มถ้าบันทึกไม่สำเร็จ)
export async function logAction(hotelId, who, action, ref = "", text = "") {
  try {
    await ActionLog.create({ hotel: hotelId, staff: who?.id || undefined, name: who?.name || "", action, ref: String(ref || "").slice(0, 60), text: String(text || "").slice(0, 200) });
  } catch (e) { console.error("logAction", e.message); }
}
