import { Router } from "express";
import Hotel from "../models/Hotel.js";
import RoomType from "../models/RoomType.js";
import Booking from "../models/Booking.js";
import Service from "../models/Service.js";
import { evalPromo } from "../lib/promo.js";
import { rateFor } from "../lib/pricing.js";
import Review from "../models/Review.js";
import mongoose from "mongoose";
import { parseDataUrl, fitForLine } from "../lib/images.js";
import ActivityBooking from "../models/ActivityBooking.js";
import { sellsStandalone, availability, createActivityBooking } from "../lib/activity.js";
import { notifyActivity, notifyCancel, notifyPaidReport, holdDeadline, bookingGroup, summarize } from "../lib/notify.js";
import { breakfastOf, roomAmenities, stayInfo, lineContactUrl, lineLabel } from "../lib/stay.js";
import { promptPayPayload, normalizePromptPayId } from "../lib/promptpay.js";
import { payMethodsOf, resolvePayChoice } from "../lib/pay.js";
import { createRoomBooking } from "../lib/booking.js";
import { usedPeaks } from "../lib/availability.js";

// เลขจองต้องตรงเป๊ะ (BP-XXXXXX) — ห้ามค้นแบบขึ้นต้นด้วย ไม่งั้นใส่แค่ "BP-" ก็ยกเลิกทุกการจองของเบอร์นั้นได้
const REF_RE = /^BP-[A-Z0-9]{6}$/;
const refGroup = (ref) => new RegExp("^" + ref + "(-\\d+)?$");

const r = Router();

// ===== เสิร์ฟรูปที่เก็บเป็น data URL เป็นไฟล์รูปจริง (ใช้ในการ์ด LINE + รูปปก) =====
//   /api/public/img/room/<roomId>/<index>   /api/public/img/svc/<serviceId>/0   /api/public/img/cover/<hotelId>/0   /api/public/img/logo/<hotelId>/0
r.get("/img/:kind/:id/:i?", async (req, res) => {
  const { kind, id } = req.params;
  const i = Math.max(0, parseInt(req.params.i || "0", 10) || 0);
  if (!mongoose.isValidObjectId(id)) return res.sendStatus(404);
  let src = "", key = "";
  if (kind === "room") {
    const t = await RoomType.findById(id).select("images imageUrl updatedAt").lean();
    if (t) { src = (t.images && t.images[i]) || (i === 0 ? t.imageUrl : ""); key = id + ":" + i + ":" + new Date(t.updatedAt || 0).getTime(); }
  } else if (kind === "svc") {
    const s = await Service.findById(id).select("imageUrl updatedAt").lean();
    if (s) { src = s.imageUrl || ""; key = id + ":" + new Date(s.updatedAt || 0).getTime(); }
  } else if (kind === "cover") {
    const h = await Hotel.findById(id).select("+coverData updatedAt").lean();
    if (h) { src = h.coverData || ""; key = id + ":c:" + new Date(h.updatedAt || 0).getTime(); }
  } else if (kind === "logo") {
    const h = await Hotel.findById(id).select("+logoData updatedAt").lean();
    if (h) { src = h.logoData || ""; key = id + ":l:" + new Date(h.updatedAt || 0).getTime(); }
  }
  if (!src) return res.sendStatus(404);
  if (/^https?:\/\//i.test(src)) return res.redirect(src);
  const p = parseDataUrl(src);
  if (!p) return res.sendStatus(404);
  const out = req.query.w === "line" ? await fitForLine(key, p.buf, p.type) : p;
  res.set("Content-Type", out.type).set("Cache-Control", "public, max-age=86400").send(out.buf);
});

// QR PromptPay ของที่พัก ตามยอดที่ต้องจ่าย — สร้างฝั่งเซิร์ฟเวอร์ (ไม่พึ่ง CDN, แขกกดค้างบันทึกรูปไปสแกนในแอปธนาคารได้)
//   /api/public/promptpay-qr?slug=<slug>&amount=1800
r.get("/promptpay-qr", async (req, res) => {
  const h = await Hotel.findOne({ slug: String(req.query.slug || "") }).select("promptpayId").lean();
  const id = h && normalizePromptPayId(h.promptpayId);
  if (!id) return res.status(404).json({ error: "ที่พักยังไม่ได้ตั้ง PromptPay" });
  const amt = Math.round(Number(req.query.amount || 0) * 100) / 100;
  if (!(amt >= 0 && amt <= 1000000)) return res.status(400).json({ error: "ยอดเงินไม่ถูกต้อง" });
  let QR;
  try { QR = (await import("qrcode")).default; } catch { return res.status(500).json({ error: "qr unavailable" }); }
  const buf = await QR.toBuffer(promptPayPayload(id, amt), { errorCorrectionLevel: "M", width: 640, margin: 2, color: { dark: "#000000", light: "#FFFFFF" } });
  res.set("Content-Type", "image/png").set("Cache-Control", "public, max-age=600").send(buf);
});

// QR ลิงก์จองของที่พัก (ให้โรงแรมเอาไปพิมพ์/แชร์)
r.get("/qr/:slug.png", async (req, res) => {
  const h = await Hotel.findOne({ slug: req.params.slug }).select("slug").lean();
  if (!h) return res.sendStatus(404);
  let QR;
  try { QR = (await import("qrcode")).default; } catch { return res.sendStatus(404); }
  const proto = String(req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0];
  const base = (process.env.PUBLIC_URL || proto + "://" + req.get("host")).replace(/\/+$/, "");
  const buf = await QR.toBuffer(base + "/book.html?h=" + encodeURIComponent(h.slug), { width: 720, margin: 2, color: { dark: "#0f2540", light: "#ffffff" } });
  res.set("Content-Type", "image/png").set("Cache-Control", "public, max-age=86400").send(buf);
});

// ตรวจโค้ดส่วนลด (สาธารณะ) — ให้หน้าจองเช็กสดก่อนยืนยัน
r.post("/promo", async (req, res) => {
  const { slug, code, nights, subtotal } = req.body || {};
  const h = await Hotel.findOne({ slug });
  if (!h) return res.status(404).json({ error: "not found" });
  const out = await evalPromo(h._id, code, +nights || 1, +subtotal || 0);
  if (!out.ok) return res.status(400).json({ error: out.error });
  res.json({ ok: true, discount: out.discount, label: out.label });
});

// ค่าตั้งสาธารณะของแพลตฟอร์ม (เช่น ลิงก์ LINE ช่วยเหลือของ BARN-PARK) — ตั้งผ่าน env
r.get("/config", (_req, res) => {
  res.json({ supportLineUrl: process.env.SUPPORT_LINE_URL || "" });
});

// ข้อมูลโรงแรมสาธารณะ (ไม่คืน token/secret)
r.get("/hotel/:slug", async (req, res) => {
  const h = await Hotel.findOne({ slug: req.params.slug });
  if (!h) return res.status(404).json({ error: "not found" });
  const pm = payMethodsOf(h);
  res.json({
    id: h._id, slug: h.slug, name: h.name, location: h.location, phone: h.phone,
    lineId: lineLabel(h.lineId), lineUrl: lineContactUrl(h.lineId), // ปุ่ม LINE ให้แขกทักแชทที่พัก
    brandColor: h.brandColor, brandColor2: h.brandColor2, accentColor: h.accentColor, accentColor2: h.accentColor2,
    fontFamily: h.fontFamily, uiStyle: h.uiStyle, template: h.template || "rich",
    tagline: h.tagline, coverUrl: h.coverUrl, about: h.about, amenities: h.amenities || [],
    logoUrl: h.logoUrl || "", logoAspect: h.logoAspect || null,
    promoText: h.promoText, promoImage: h.promoImage,
    // วิธีรับเงินที่ที่พักเปิดไว้ (แสดงเฉพาะช่องทางที่เปิด)
    pay: { promptpay: pm.promptpay, transfer: pm.transfer, onsite: pm.onsite, fallback: pm.fallback },
    bank: pm.bank ? { name: pm.bank.name, no: pm.bank.no, noFmt: pm.bank.noFmt, acct: pm.bank.acct } : null,
    promptpayId: pm.promptpay ? h.promptpayId : "", promptpayName: h.promptpayName || h.name,
    allowGuestCancel: h.allowGuestCancel !== false, cancelDays: h.cancelDays ?? 3, holdHours: h.holdHours ?? 24,
    ...stayInfo(h), // checkInTime, checkOutTime, mapUrl, houseRules, address
    approved: h.approved !== false,
  });
});

// รีวิวที่อนุมัติแล้ว (สาธารณะ) — แสดงบนหน้าจอง
r.get("/reviews/:slug", async (req, res) => {
  const h = await Hotel.findOne({ slug: req.params.slug });
  if (!h) return res.json([]);
  res.json(await Review.find({ hotel: h._id, approved: true }).sort("-createdAt").limit(20));
});
// แขกเขียนรีวิว — ต้องยืนยันด้วยเลขจอง + เบอร์ (กันรีวิวปลอม) · รออนุมัติก่อนแสดง
r.post("/review", async (req, res) => {
  const { slug, ref, tel, rating, text, name } = req.body || {};
  const h = await Hotel.findOne({ slug });
  if (!h) return res.status(404).json({ error: "ไม่พบที่พัก" });
  const R = String(ref || "").trim().toUpperCase().replace(/-\d+$/, "");
  const bk = REF_RE.test(R) ? await Booking.findOne({ hotel: h._id, guestTel: String(tel || "").trim(), ref: refGroup(R) }) : null;
  if (!bk) return res.status(400).json({ error: "ไม่พบการจองที่ตรงกับเลขจอง+เบอร์ (รีวิวได้เฉพาะผู้ที่เคยจอง)" });
  const r5 = Math.max(1, Math.min(5, +rating || 5));
  await Review.create({ hotel: h._id, ref: bk.ref, guestName: String(name || bk.guestName || "แขก").trim().slice(0, 60), rating: r5, text: String(text || "").slice(0, 500) });
  res.json({ ok: true, message: "ขอบคุณสำหรับรีวิว! จะแสดงหลังโรงแรมอนุมัติ" });
});

// แขกยกเลิกการจองเอง (ตรวจด้วยเลขจอง + เบอร์โทร) — ตามนโยบายของโรงแรม
r.post("/cancel", async (req, res) => {
  const { slug, ref, tel } = req.body || {};
  const h = await Hotel.findOne({ slug });
  if (!h) return res.status(404).json({ error: "ไม่พบที่พัก" });
  if (h.allowGuestCancel === false) return res.status(403).json({ error: "ที่พักนี้ไม่เปิดให้ยกเลิกออนไลน์ กรุณาติดต่อที่พักโดยตรง" });
  if (!ref || !tel) return res.status(400).json({ error: "กรุณากรอกเลขการจองและเบอร์โทร" });
  // ค้นทุกห้องภายใต้เลขจองเดียวกัน (BP-XXXX และ BP-XXXX-1 ...)
  const R = String(ref).trim().toUpperCase().replace(/-\d+$/, "");
  const bookings = REF_RE.test(R) ? await Booking.find({ hotel: h._id, guestTel: String(tel).trim(), ref: refGroup(R), status: { $ne: "cancelled" } }) : [];
  if (!bookings.length) {
    // อาจเป็นการจองกิจกรรม (BA-XXXXXX)
    const ab = /^BA-[A-Z0-9]{6}$/.test(R) ? await ActivityBooking.findOne({ hotel: h._id, guestTel: String(tel).trim(), ref: R, status: { $ne: "cancelled" } }) : null;
    if (!ab) return res.status(404).json({ error: "ไม่พบการจองที่ตรงกับข้อมูล" });
    const dl = new Date(ab.date); dl.setDate(dl.getDate() - (h.cancelDays ?? 3));
    ab.status = "cancelled"; await ab.save();
    notifyCancel(h._id, [ab.toObject()], { by: "guest", free: new Date() <= dl }).catch((e) => console.error("notifyCancel", e.message));
    return res.json({ ok: true, cancelled: 1, freeCancel: new Date() <= dl, cancelDays: h.cancelDays ?? 3 });
  }
  const days = h.cancelDays ?? 3;
  const deadline = new Date(bookings[0].checkin); deadline.setDate(deadline.getDate() - days);
  const late = new Date() > deadline;
  for (const b of bookings) { b.status = "cancelled"; b.cancelReason = "guest"; await b.save(); }
  notifyCancel(h._id, bookings.map((b) => b.toObject()), { by: "guest", free: !late }).catch((e) => console.error("notifyCancel", e.message));
  res.json({ ok: true, cancelled: bookings.length, freeCancel: !late, cancelDays: days });
});

// ===== แขกแจ้งโอนภายหลัง (จองแบบจ่ายทีหลังไว้) — ยืนยันด้วยเลขจอง + เบอร์ที่ใช้จอง =====
r.post("/report-paid", async (req, res) => {
  const { slug, ref, tel, payRef = "", method = "" } = req.body || {};
  const h = await Hotel.findOne({ slug });
  if (!h) return res.status(404).json({ error: "ไม่พบที่พัก" });
  if (!ref || !tel) return res.status(400).json({ error: "กรุณากรอกเลขการจองและเบอร์โทร" });
  const R = String(ref).trim().toUpperCase().replace(/-\d+$/, "");
  const phone = String(tel).trim(), pr = String(payRef || "").slice(0, 60);
  // แขกโอนช่องทางไหน (พร้อมเพย์/โอนเข้าบัญชี) — ไม่ระบุ = ใช้ช่องทางที่เลือกไว้ตอนจอง หรือช่องทางออนไลน์แรกที่เปิด
  const pm = payMethodsOf(h);
  const how = (b) => ["promptpay", "transfer"].includes(method) ? method : ["promptpay", "transfer"].includes(b.payMethod) ? b.payMethod : pm.promptpay ? "promptpay" : pm.transfer ? "transfer" : "promptpay";
  if (REF_RE.test(R)) {
    const list = await Booking.find({ hotel: h._id, guestTel: phone, ref: refGroup(R), status: { $ne: "cancelled" } });
    if (!list.length) return res.status(404).json({ error: "ไม่พบการจองที่ตรงกับข้อมูล (หรือถูกยกเลิกไปแล้ว)" });
    const todo = list.filter((b) => ["unpaid", "onsite", ""].includes(b.payStatus || ""));
    for (const b of todo) { b.payMethod = how(b); b.payStatus = "reported"; b.payRef = pr; await b.save(); }
    if (todo.length) notifyPaidReport("room", list[0]._id).catch((e) => console.error("notifyPaidReport", e.message));
    return res.json({ ok: true, updated: todo.length });
  }
  if (/^BA-[A-Z0-9]{6}$/.test(R)) {
    const ab = await ActivityBooking.findOne({ hotel: h._id, guestTel: phone, ref: R, status: { $ne: "cancelled" } });
    if (!ab) return res.status(404).json({ error: "ไม่พบการจองที่ตรงกับข้อมูล (หรือถูกยกเลิกไปแล้ว)" });
    let updated = 0;
    if (["unpaid", "onsite", ""].includes(ab.payStatus || "")) { ab.payMethod = how(ab); ab.payStatus = "reported"; ab.payRef = pr; await ab.save(); updated = 1; notifyPaidReport("act", ab._id).catch((e) => console.error("notifyPaidReport", e.message)); }
    return res.json({ ok: true, updated });
  }
  return res.status(404).json({ error: "ไม่พบการจองที่ตรงกับข้อมูล" });
});

// ===== แขกเช็กการจองของตัวเอง (เลขจอง + เบอร์ที่ใช้จอง) — ดูสถานะ/ยอด/วิธีชำระ แล้วแจ้งโอนหรือยกเลิกต่อได้ =====
r.post("/lookup", async (req, res) => {
  const { slug, ref, tel } = req.body || {};
  const h = await Hotel.findOne({ slug });
  if (!h) return res.status(404).json({ error: "ไม่พบที่พัก" });
  if (!ref || !tel) return res.status(400).json({ error: "กรุณากรอกเลขการจองและเบอร์โทร" });
  const R = String(ref).trim().toUpperCase().replace(/-\d+$/, "");
  const phone = String(tel).trim();
  const notFound = () => res.status(404).json({ error: "ไม่พบการจองที่ตรงกับเลขจอง + เบอร์โทรนี้" });
  if (REF_RE.test(R)) {
    const first = await Booking.findOne({ hotel: h._id, guestTel: phone, ref: refGroup(R) }).lean();
    if (!first) return notFound();
    const group = (await bookingGroup(first)).filter((b) => b.guestTel === phone);
    const t = first.roomType ? await RoomType.findById(first.roomType).select("name").lean() : null;
    const s = summarize(group, t);
    const live = group.filter((b) => b.status !== "cancelled");
    return res.json({
      kind: "room", ref: s.ref, status: live.length ? "confirmed" : "cancelled", cancelReason: live.length ? "" : (first.cancelReason || ""),
      roomName: s.roomName, rooms: s.rooms, checkin: s.checkin, checkout: s.checkout, nights: s.nights, pax: s.pax,
      breakfast: s.breakfast, breakfastPax: s.breakfastPax, breakfastTotal: s.breakfastTotal, addons: s.addons, discount: s.discount,
      amount: s.amount, payStatus: s.payStatus, payMethod: first.payMethod || "", holdUntil: live.length ? holdDeadline(h, live[0]) : null,
      guestName: s.guestName,
    });
  }
  if (/^BA-[A-Z0-9]{6}$/.test(R)) {
    const ab = await ActivityBooking.findOne({ hotel: h._id, guestTel: phone, ref: R }).lean();
    if (!ab) return notFound();
    return res.json({
      kind: "act", ref: ab.ref, status: ab.status, serviceName: ab.serviceName, date: ab.date, time: ab.time, qty: ab.qty,
      amount: ab.amount, payStatus: ab.payStatus, payMethod: ab.payMethod || "", guestName: ab.guestName,
    });
  }
  return notFound();
});

// ===== จองกิจกรรมเดี่ยว (ไม่ต้องพัก) =====
r.get("/activity-avail", async (req, res) => {
  const { slug, id, date } = req.query;
  if (!mongoose.isValidObjectId(id) || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return res.status(400).json({ error: "bad request" });
  const h = await Hotel.findOne({ slug }).lean();
  const svc = h && await Service.findOne({ _id: id, hotel: h._id }).lean();
  if (!svc || !sellsStandalone(svc)) return res.status(404).json({ error: "ไม่พบกิจกรรม" });
  res.json(await availability(svc, date));
});
r.post("/book-activity", async (req, res) => {
  const { slug, serviceId, date, time, qty, name, tel, email, note, paid, payRef, payMethod = "" } = req.body || {};
  const h = await Hotel.findOne({ slug });
  if (!h) return res.status(404).json({ error: "ไม่พบที่พัก" });
  if (h.approved === false) return res.status(403).json({ error: "ที่พักนี้ยังไม่เปิดรับจอง (รอการอนุมัติ)" });
  if (!name || !tel) return res.status(400).json({ error: "กรุณากรอกชื่อและเบอร์โทร" });
  if (!mongoose.isValidObjectId(serviceId)) return res.status(404).json({ error: "ไม่พบกิจกรรม" });
  const svc = await Service.findOne({ _id: serviceId, hotel: h._id });
  if (!svc || !sellsStandalone(svc)) return res.status(404).json({ error: "กิจกรรมนี้ไม่เปิดจองเดี่ยว" });
  // ฟรี = ไม่มีเรื่องชำระ · มีค่าใช้จ่าย = ตรวจวิธีชำระกับที่ที่พักเปิดไว้
  const pc = (svc.price || 0) > 0 ? resolvePayChoice(h, payMethod, !!paid) : { method: "", payStatus: "unpaid" };
  if (pc.error) return res.status(400).json({ error: pc.error });
  try {
    const b = await createActivityBooking(h, svc, { date, time, qty, name, tel, email, note: String(note || "").slice(0, 300), paid: !!paid, payRef: String(payRef || "").slice(0, 60), payStatus: pc.payStatus, payMethod: pc.method });
    notifyActivity(b._id).catch((e) => console.error("notifyActivity", e.message));
    res.json({ ok: true, ref: b.ref, amount: b.amount, qty: b.qty, date: b.date, time: b.time, payStatus: b.payStatus, payMethod: b.payMethod || "" });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// บริการเสริม (สาธารณะ)
r.get("/services/:slug", async (req, res) => {
  const h = await Hotel.findOne({ slug: req.params.slug });
  if (!h) return res.json([]);
  res.json(await Service.find({ hotel: h._id, hidden: { $ne: true } }).sort("sort"));
});

// ห้องว่างตามช่วงวันที่ (สาธารณะ) — คืนเฉพาะจำนวน ไม่มีข้อมูลแขก
r.get("/availability", async (req, res) => {
  const { slug, din, dout } = req.query;
  const h = await Hotel.findOne({ slug });
  if (!h) return res.status(404).json({ error: "not found" });
  const rts = await RoomType.find({ hotel: h._id, hidden: { $ne: true } }).sort("sort");
  const used = await usedPeaks(rts.map((t) => t._id), din, dout); // ห้องที่ใช้มากสุดต่อคืนในช่วง (คิวรีเดียว)
  const out = [];
  for (const t of rts) {
    const booked = used[String(t._id)] || 0;
    const rate = rateFor(t, din); // ราคาตามฤดู (ถ้ามี)
    const bf = breakfastOf(t);
    out.push({
      roomTypeId: t._id, name: t.name, capacity: t.capacity, description: t.description || "", amenities: roomAmenities(t),
      breakfast: bf.mode, breakfastPrice: bf.price,
      basePrice: rate.price, minNights: rate.minNights, season: rate.season,
      otaPrice: t.otaPrice, extraBedPrice: t.extraBedPrice, imageUrl: t.imageUrl,
      images: (t.images && t.images.length) ? t.images : (t.imageUrl ? [t.imageUrl] : []),
      qty: t.qty, available: Math.max(0, t.qty - booked),
    });
  }
  res.json(out);
});

// จองตรงจากหน้าแขก — ตรวจห้องว่างฝั่งเซิร์ฟเวอร์ + สร้างหลายห้องได้ + ยิงแจ้งเตือน
r.post("/book", async (req, res) => {
  const h = await Hotel.findOne({ slug: (req.body || {}).slug });
  if (!h) return res.status(404).json({ error: "hotel not found" });
  const out = await createRoomBooking(h, req.body || {});
  res.status(out.status).json(out.body);
});

export default r;
