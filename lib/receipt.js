// ===== ใบเสร็จ / ใบยืนยันการจอง (public/receipt.html) — หน้าตาตามธีมและเทมเพลตที่ที่พักเลือก =====
// เปิดด้วยลิงก์ที่มีรหัสลับ (k = HMAC ของเลขจอง) — เดาลิงก์ของคนอื่นไม่ได้ · ส่งให้แขกทางอีเมล/LINE/หน้าเช็กการจอง
import crypto from "crypto";
import Hotel from "../models/Hotel.js";
import RoomType from "../models/RoomType.js";
import Booking from "../models/Booking.js";
import ActivityBooking from "../models/ActivityBooking.js";
import Review from "../models/Review.js";
import { baseUrl } from "./baseurl.js";
import { stayInfo } from "./stay.js";

const SECRET = () => process.env.RECEIPT_SECRET || process.env.JWT_SECRET || "";
const REF_RE = /^(BP|BA)-[A-Z0-9]{6}$/;
const groupRef = (ref) => String(ref || "").toUpperCase().replace(/-\d+$/, "");

// รหัสลับของลิงก์ใบเสร็จ (ผูกกับที่พัก + เลขจอง) · ไม่ได้ตั้ง JWT_SECRET/RECEIPT_SECRET = ไม่ออกลิงก์
export function receiptKey(hotelId, ref) {
  const s = SECRET();
  if (!s) return "";
  return crypto.createHmac("sha256", s).update(`receipt:${hotelId}:${groupRef(ref)}`).digest("base64url").slice(0, 22);
}
export function receiptUrl(h, ref) {
  const k = receiptKey(h._id, ref), B = baseUrl();
  return k && B && h.slug ? `${B}/receipt.html?h=${encodeURIComponent(h.slug)}&ref=${encodeURIComponent(groupRef(ref))}&k=${k}` : "";
}
export function checkKey(h, ref, k) {
  const want = receiptKey(h._id, ref);
  if (!want || typeof k !== "string" || k.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(k));
}

// ข้อมูลสำหรับหน้าใบเสร็จ — เฉพาะที่ต้องพิมพ์ ไม่มีข้อมูลลับ (token/บัญชี/อีเมลแขก)
export async function receiptData(h, rawRef) {
  const ref = groupRef(rawRef);
  if (!REF_RE.test(ref)) return null;
  const st = stayInfo(h);
  const hotel = {
    name: h.name || "", slug: h.slug, address: st.address || h.location || "", phone: h.phone || "", taxId: h.taxId || "",
    logoUrl: h.logoUrl || "", brandColor: h.brandColor, brandColor2: h.brandColor2, accentColor: h.accentColor, accentColor2: h.accentColor2,
    fontFamily: h.fontFamily, uiStyle: h.uiStyle, template: h.template || "rich",
  };
  // นโยบายที่ใช้กับการจองนี้ (แสดงท้ายใบยืนยัน) · cancelDays = null คือยกเลิกออนไลน์ไม่ได้ ต้องติดต่อที่พัก
  const policy = { checkInTime: st.checkInTime, checkOutTime: st.checkOutTime, cancelDays: h.allowGuestCancel !== false ? Math.max(0, h.cancelDays ?? 3) : null };
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  // รีวิวได้เมื่อถึงวันเข้าพัก/ใช้บริการแล้ว การจองไม่ถูกยกเลิก และยังไม่เคยรีวิวเลขจองนี้
  const reviewState = async (day, cancelled) => cancelled || !day || day > today ? "" :
    (await Review.findOne({ hotel: h._id, ref: new RegExp("^" + ref + "(-\\d+)?$") }).select("_id").lean()) ? "done" : "open";
  const base = { ref, hotel, policy, issuedAt: new Date().toISOString() };
  if (ref.startsWith("BA-")) {
    const a = await ActivityBooking.findOne({ hotel: h._id, ref }).lean();
    if (!a) return null;
    return { ...base, review: await reviewState(a.date, a.status === "cancelled"), kind: "act", status: a.status, payStatus: a.payStatus || "", payMethod: a.payMethod || "", guestName: a.guestName || "",
      date: a.date, time: a.time || "", total: a.amount || 0, discount: 0,
      lines: [{ th: a.serviceName, en: a.serviceName, detail: { date: a.date, time: a.time || "" }, qty: a.qty || 1, amount: a.amount || 0 }] };
  }
  const list = (await Booking.find({ hotel: h._id, ref: new RegExp("^" + ref + "(-\\d+)?$") }).lean())
    .sort((x, y) => String(x.ref).length - String(y.ref).length || String(x.ref).localeCompare(String(y.ref)));
  if (!list.length) return null;
  const live = list.filter((b) => b.status !== "cancelled"), use = live.length ? live : list, first = use[0];
  const rt = first.roomType ? await RoomType.findById(first.roomType).select("name").lean() : null;
  const nights = Math.max(1, Math.round((new Date(first.checkout + "T00:00:00Z") - new Date(first.checkin + "T00:00:00Z")) / 864e5));
  const extrasOf = (b) => (b.addonTotal || 0) + (b.breakfastTotal || 0);
  const discount = use.reduce((t, b) => t + (b.discount || 0), 0);
  const roomGross = use.reduce((t, b) => t + (b.amount || 0) - extrasOf(b) + (b.discount || 0), 0); // ค่าห้อง (รวมเตียงเสริม) ก่อนหักส่วนลด
  const lines = [{ th: (rt && rt.name) || "ห้องพัก", en: (rt && rt.name) || "Room", detail: { nights, rooms: use.length, extraBed: first.extraBed || 0, checkin: first.checkin, checkout: first.checkout }, qty: use.length, amount: roomGross }];
  if (first.breakfastTotal) lines.push({ th: "อาหารเช้า", en: "Breakfast", detail: { pax: first.breakfastPax || 0, dates: first.breakfastDates || [], nights }, qty: first.breakfastPax || 1, amount: first.breakfastTotal });
  for (const a of first.addons || []) lines.push({ th: a.name, en: a.name, detail: { date: a.date || "" }, qty: a.qty || 1, amount: (a.price || 0) * (a.qty || 1) });
  return {
    ...base, review: await reviewState(first.checkin, !live.length), kind: "room", status: live.length ? "confirmed" : "cancelled", payStatus: first.payStatus || "", payMethod: first.payMethod || "",
    guestName: first.guestName || "", checkin: first.checkin, checkout: first.checkout, nights, pax: first.pax || 0,
    promoCode: first.promoCode || "", discount, total: use.reduce((t, b) => t + (b.amount || 0), 0), lines,
  };
}

export const findHotelBySlug = (slug) => Hotel.findOne({ slug: String(slug || "") }).select("name slug location phone taxId address allowGuestCancel cancelDays logoUrl brandColor brandColor2 accentColor accentColor2 fontFamily uiStyle template checkInTime checkOutTime mapUrl houseRules").lean();
