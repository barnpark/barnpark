// ===== สร้างการจองห้อง (ใช้ร่วมกัน: หน้าจองบนเว็บ POST /api/public/book + บอท LINE OA ของโรงแรม) =====
// ตรวจทุกอย่างฝั่งเซิร์ฟเวอร์: ห้องว่าง ราคาตามฤดู ขั้นต่ำคืน วิธีชำระที่ที่พักเปิด กันจองซ้อน
// คืน { status, body } — status 200 = สำเร็จ (body เหมือนที่หน้าเว็บได้รับ) อื่น ๆ = body.error
import mongoose from "mongoose";
import RoomType from "../models/RoomType.js";
import Booking from "../models/Booking.js";
import Service from "../models/Service.js";
import PromoCode from "../models/PromoCode.js";
import { notifyBooking, holdDeadline } from "./notify.js";
import { evalPromo } from "./promo.js";
import { rateFor } from "./pricing.js";
import { breakfastOf } from "./stay.js";
import { mkRef } from "./security.js";
import { resolvePayChoice } from "./pay.js";
import { sellsAddon } from "./activity.js";
import { receiptUrl } from "./receipt.js";
import { usedPeak } from "./availability.js";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const todayTH = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const int = (v, lo, hi, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const fail = (status, body) => ({ status, body });
const addDays = (ymd, n) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// เช้าที่มีอาหารเช้าได้ = เช้าหลังแต่ละคืน (din+1 … dout) · วันที่ใช้บริการเสริมได้ = din … dout
export const stayMornings = (din, dout) => { const out = []; if (!YMD.test(String(din)) || !YMD.test(String(dout))) return out; for (let d = addDays(din, 1); d <= dout && out.length < 60; d = addDays(d, 1)) out.push(d); return out; };
export const stayDays = (din, dout) => (YMD.test(String(din)) ? [din, ...stayMornings(din, dout)] : []);

// opts.lineUserId = จองผ่านแชท LINE OA ของโรงแรม (เก็บไว้แจ้งแขกตอนที่พักยืนยันรับเงิน · ไม่ push ใบยืนยันซ้ำเพราะบอทตอบในแชทแล้ว)
export async function createRoomBooking(h, input = {}, opts = {}) {
  const { roomTypeId, din, dout, name, tel, email, pax, note, notify, rooms = 1, extraBed = 0, payRef = "", paid = false, payMethod = "", promoCode = "", addons = [], breakfast: wantBf = false, breakfastPax, breakfastDates } = input;
  if (h.approved === false) return fail(403, { error: "ที่พักนี้ยังไม่เปิดรับจอง (รอการอนุมัติ)" });
  if (!name || !tel) return fail(400, { error: "กรุณากรอกชื่อและเบอร์โทร" });
  // วิธีชำระ: ต้องเป็นช่องทางที่ที่พักเปิดไว้ (พร้อมเพย์ / โอนเข้าบัญชี / จ่ายที่เคาน์เตอร์)
  const pc = resolvePayChoice(h, payMethod, !!paid);
  if (pc.error) return fail(400, { error: pc.error });
  if (!YMD.test(String(din || "")) || !YMD.test(String(dout || "")) || dout <= din) return fail(400, { error: "invalid dates" });
  if (din < todayTH()) return fail(400, { error: "วันเช็คอินผ่านมาแล้ว กรุณาเลือกวันใหม่" });
  if (!mongoose.isValidObjectId(roomTypeId)) return fail(404, { error: "room not found" });
  const t = await RoomType.findOne({ _id: roomTypeId, hotel: h._id, hidden: { $ne: true } });
  if (!t) return fail(404, { error: "room not found" });

  const want = int(rooms, 1, 20, 1);
  const eb = int(extraBed, 0, 5, 0);
  // นับรายคืน: คืนที่แน่นที่สุดในช่วงต้องเหลือห้องพอ (ไม่ใช่นับจำนวนการจองที่ทับช่วง)
  const booked = await usedPeak(t._id, din, dout);
  if (booked + want > t.qty) return fail(409, { error: "ห้องช่วงวันดังกล่าวไม่ว่างพอ" });

  const nights = Math.max(1, Math.round((new Date(dout) - new Date(din)) / 86400000));
  const rate = rateFor(t, din); // ราคาตามฤดู
  if (rate.minNights && nights < rate.minNights) return fail(400, { error: `ห้องนี้ต้องพักอย่างน้อย ${rate.minNights} คืนในช่วงนี้` });
  const per = (rate.price + eb * (t.extraBedPrice || 0)) * nights;
  // อาหารเช้า: รวมในราคาห้อง หรือแขกเลือกเพิ่ม (ราคาต่อท่าน/เช้า — คิดจากราคาจริงของห้อง ไม่เชื่อยอดจากหน้าเว็บ)
  // breakfastDates = เช้าที่จะทาน (เช้าหลังแต่ละคืน: din+1 … dout) — ไม่ส่งมา = ทุกเช้า (หน้าเว็บรุ่นเดิม)
  const bf = breakfastOf(t);
  let bfMode = "", bfPax = 0, bfTotal = 0, bfDates = [];
  if (bf.mode === "included") bfMode = "included";
  else if (bf.mode === "optional" && wantBf) {
    const mornings = stayMornings(din, dout);
    bfDates = Array.isArray(breakfastDates) ? [...new Set(breakfastDates.map(String))].filter((d) => mornings.includes(d)).sort() : mornings;
    if (bfDates.length) {
      bfPax = int(breakfastPax ?? pax, 1, want * (Math.max(1, t.capacity || 2) + eb), 1);
      bfTotal = bf.price * bfPax * bfDates.length; bfMode = "added";
    } else bfDates = [];
  }
  // บริการเสริม (ขายพ่วง) — ตรวจราคากับบริการจริงของโรงแรม
  let addonTotal = 0, addonList = [];
  if (Array.isArray(addons) && addons.length) {
    const svcs = (await Service.find({ hotel: h._id, hidden: { $ne: true } })).filter(sellsAddon); // ปิดขาย/ขายเดี่ยวอย่างเดียว ซื้อพ่วงไม่ได้
    const days = stayDays(din, dout);
    for (const a of addons.slice(0, 100)) {
      const q = int(a && a.qty, 0, 50, 0); if (!q) continue;
      const sv = svcs.find((s) => String(s._id) === String(a.serviceId) || s.name === a.name);
      // วันที่ใช้บริการ (ถ้าระบุ) ต้องอยู่ในช่วงเข้าพัก din … dout · ไม่ระบุ = ไม่กำหนดวัน (หน้าเว็บรุ่นเดิม)
      const date = a && a.date ? String(a.date) : "";
      if (date && !days.includes(date)) return fail(400, { error: `วันที่ของ “${(sv && sv.name) || "บริการเสริม"}” ต้องอยู่ในช่วงเข้าพัก` });
      if (sv && sv.price) { addonTotal += sv.price * q; addonList.push({ name: sv.name, price: sv.price, qty: q, ...(date ? { date } : {}) }); }
    }
    addonList.sort((x, y) => String(x.date || "").localeCompare(String(y.date || "")));
  }
  // ส่วนลดจากโค้ดโปรโมชัน (คิดจากยอดห้องรวม แล้วเฉลี่ยลงต่อห้อง)
  let perDiscount = 0, appliedPromo = null;
  if (promoCode) {
    const pr = await evalPromo(h._id, promoCode, nights, per * want);
    if (pr.ok) { perDiscount = Math.round(pr.discount / want); appliedPromo = pr.promo; }
  }
  const ref = mkRef("BP");
  const created = [];
  for (let i = 0; i < want; i++) {
    created.push(await Booking.create({
      hotel: h._id, roomType: t._id, guestName: String(name).trim().slice(0, 100), guestTel: String(tel).trim().slice(0, 30), guestEmail: String(email || "").trim().slice(0, 120),
      channel: "direct", checkin: din, checkout: dout, pax: int(pax, 1, 100, 1),
      amount: Math.max(0, per - perDiscount) + (i === 0 ? addonTotal + bfTotal : 0), extraBed: eb,
      breakfast: bfMode, breakfastPax: i === 0 ? bfPax : 0, breakfastTotal: i === 0 ? bfTotal : 0, breakfastDates: i === 0 ? bfDates : [],
      status: "confirmed", notifyChannel: notify === "none" ? "none" : "email", ref: ref + (i ? "-" + i : ""), note: String(note || "").slice(0, 500), lineUserId: opts.lineUserId || undefined,
      payStatus: pc.payStatus, payMethod: pc.method, payRef: paid ? String(payRef || "").slice(0, 60) : "",
      promoCode: appliedPromo ? appliedPromo.code : "", discount: perDiscount,
      addons: i === 0 ? addonList : [], addonTotal: i === 0 ? addonTotal : 0,
    }));
  }
  if (appliedPromo) { await PromoCode.updateOne({ _id: appliedPromo._id }, { $inc: { usedCount: 1 } }); }
  // ★ กันจองซ้อน (race condition): ตรวจซ้ำหลังบันทึก — ถ้าเกินโควตาให้ถอนคืนแล้วแจ้งเต็ม
  const confirmedCount = await usedPeak(t._id, din, dout); // รวมห้องที่เพิ่งสร้างแล้ว
  if (confirmedCount > t.qty) {
    await Booking.deleteMany({ _id: { $in: created.map((c) => c._id) } });
    return fail(409, { error: "ขออภัย ห้องเพิ่งถูกจองพอดี กรุณาเลือกวันหรือห้องใหม่" });
  }
  notifyBooking(created[0]._id, { quietGuestLine: !!opts.lineUserId }).catch((e) => console.error("notify", e));
  return { status: 200, created, body: {
    ok: true, ref, amount: Math.max(0, per - perDiscount) * want + addonTotal + bfTotal, rooms: want, discount: perDiscount * want, addonTotal,
    breakfast: bfMode, breakfastPax: bfPax, breakfastTotal: bfTotal, breakfastDates: bfDates, addons: addonList, nights, checkin: din, checkout: dout, roomName: t.name,
    payStatus: created[0].payStatus, payMethod: created[0].payMethod || "", holdUntil: holdDeadline(h, created[0]), receiptUrl: receiptUrl(h, ref),
  } };
}
