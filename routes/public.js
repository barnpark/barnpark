import { Router } from "express";
import Hotel from "../models/Hotel.js";
import RoomType from "../models/RoomType.js";
import Booking from "../models/Booking.js";
import Service from "../models/Service.js";
import { notifyBooking } from "../lib/notify.js";
import { evalPromo } from "../lib/promo.js";
import { rateFor } from "../lib/pricing.js";
import PromoCode from "../models/PromoCode.js";
import Review from "../models/Review.js";

const r = Router();

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
  res.json({
    id: h._id, slug: h.slug, name: h.name, location: h.location, phone: h.phone, lineId: h.lineId,
    brandColor: h.brandColor, brandColor2: h.brandColor2, accentColor: h.accentColor, accentColor2: h.accentColor2,
    fontFamily: h.fontFamily, uiStyle: h.uiStyle, template: h.template || "rich",
    tagline: h.tagline, coverUrl: h.coverUrl, about: h.about,
    promoText: h.promoText, promoImage: h.promoImage,
    promptpayId: h.promptpayId || "", promptpayName: h.promptpayName || h.name,
    allowGuestCancel: h.allowGuestCancel !== false, cancelDays: h.cancelDays ?? 3,
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
  const bk = await Booking.findOne({ hotel: h._id, guestTel: String(tel || "").trim(), ref: new RegExp("^" + String(ref || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
  if (!bk) return res.status(400).json({ error: "ไม่พบการจองที่ตรงกับเลขจอง+เบอร์ (รีวิวได้เฉพาะผู้ที่เคยจอง)" });
  const r5 = Math.max(1, Math.min(5, +rating || 5));
  await Review.create({ hotel: h._id, ref: bk.ref, guestName: (name || bk.guestName || "แขก").trim(), rating: r5, text: String(text || "").slice(0, 500) });
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
  const bookings = await Booking.find({ hotel: h._id, guestTel: String(tel).trim(), ref: new RegExp("^" + String(ref).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
  if (!bookings.length) return res.status(404).json({ error: "ไม่พบการจองที่ตรงกับข้อมูล" });
  const days = h.cancelDays ?? 3;
  const deadline = new Date(bookings[0].checkin); deadline.setDate(deadline.getDate() - days);
  const late = new Date() > deadline;
  for (const b of bookings) { b.status = "cancelled"; await b.save(); }
  res.json({ ok: true, cancelled: bookings.length, freeCancel: !late, cancelDays: days });
});

// บริการเสริม (สาธารณะ)
r.get("/services/:slug", async (req, res) => {
  const h = await Hotel.findOne({ slug: req.params.slug });
  if (!h) return res.json([]);
  res.json(await Service.find({ hotel: h._id }).sort("sort"));
});

// ห้องว่างตามช่วงวันที่ (สาธารณะ) — คืนเฉพาะจำนวน ไม่มีข้อมูลแขก
r.get("/availability", async (req, res) => {
  const { slug, din, dout } = req.query;
  const h = await Hotel.findOne({ slug });
  if (!h) return res.status(404).json({ error: "not found" });
  const rts = await RoomType.find({ hotel: h._id }).sort("sort");
  const out = [];
  for (const t of rts) {
    const booked = await Booking.countDocuments({
      roomType: t._id, status: { $ne: "cancelled" }, checkin: { $lt: dout }, checkout: { $gt: din },
    });
    const rate = rateFor(t, din); // ราคาตามฤดู (ถ้ามี)
    out.push({
      roomTypeId: t._id, name: t.name, capacity: t.capacity,
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
  const { slug, roomTypeId, din, dout, name, tel, email, pax, note, notify, rooms = 1, extraBed = 0, payRef = "", paid = false, promoCode = "", addons = [] } = req.body || {};
  const h = await Hotel.findOne({ slug });
  if (!h) return res.status(404).json({ error: "hotel not found" });
  if (h.approved === false) return res.status(403).json({ error: "ที่พักนี้ยังไม่เปิดรับจอง (รอการอนุมัติ)" });
  if (!name || !tel) return res.status(400).json({ error: "กรุณากรอกชื่อและเบอร์โทร" });
  if (!din || !dout || dout <= din) return res.status(400).json({ error: "invalid dates" });
  const t = await RoomType.findOne({ _id: roomTypeId, hotel: h._id });
  if (!t) return res.status(404).json({ error: "room not found" });

  const want = Math.max(1, +rooms);
  const overlapQ = { roomType: t._id, status: { $ne: "cancelled" }, checkin: { $lt: dout }, checkout: { $gt: din } };
  const booked = await Booking.countDocuments(overlapQ);
  if (booked + want > t.qty) return res.status(409).json({ error: "ห้องช่วงวันดังกล่าวไม่ว่างพอ" });

  const nights = Math.max(1, Math.round((new Date(dout) - new Date(din)) / 86400000));
  const rate = rateFor(t, din); // ราคาตามฤดู
  if (rate.minNights && nights < rate.minNights) return res.status(400).json({ error: `ห้องนี้ต้องพักอย่างน้อย ${rate.minNights} คืนในช่วงนี้` });
  const per = (rate.price + (+extraBed) * (t.extraBedPrice || 0)) * nights;
  // บริการเสริม (ขายพ่วง) — ตรวจราคากับบริการจริงของโรงแรม
  let addonTotal = 0, addonList = [];
  if (Array.isArray(addons) && addons.length) {
    const svcs = await Service.find({ hotel: h._id });
    for (const a of addons) {
      const q = Math.max(0, +a.qty || 0); if (!q) continue;
      const sv = svcs.find((s) => String(s._id) === String(a.serviceId) || s.name === a.name);
      if (sv && sv.price) { addonTotal += sv.price * q; addonList.push({ name: sv.name, price: sv.price, qty: q }); }
    }
  }
  // ส่วนลดจากโค้ดโปรโมชัน (คิดจากยอดห้องรวม แล้วเฉลี่ยลงต่อห้อง)
  let perDiscount = 0, appliedPromo = null;
  if (promoCode) {
    const pr = await evalPromo(h._id, promoCode, nights, per * want);
    if (pr.ok) { perDiscount = Math.round(pr.discount / want); appliedPromo = pr.promo; }
  }
  const ref = "BP-" + Date.now().toString(36).toUpperCase().slice(-6);
  const created = [];
  for (let i = 0; i < want; i++) {
    created.push(await Booking.create({
      hotel: h._id, roomType: t._id, guestName: name, guestTel: tel, guestEmail: email || "",
      channel: "direct", checkin: din, checkout: dout, pax: +pax || 1,
      amount: Math.max(0, per - perDiscount) + (i === 0 ? addonTotal : 0), extraBed: +extraBed,
      status: "confirmed", notifyChannel: notify || "email", ref: ref + (i ? "-" + i : ""), note: note || "",
      payStatus: paid ? "reported" : "unpaid", payMethod: paid ? "promptpay" : "", payRef: payRef || "",
      promoCode: appliedPromo ? appliedPromo.code : "", discount: perDiscount,
      addons: i === 0 ? addonList : [], addonTotal: i === 0 ? addonTotal : 0,
    }));
  }
  if (appliedPromo) { await PromoCode.updateOne({ _id: appliedPromo._id }, { $inc: { usedCount: 1 } }); }
  // ★ กันจองซ้อน (race condition): ตรวจซ้ำหลังบันทึก — ถ้าเกินโควตาให้ถอนคืนแล้วแจ้งเต็ม
  const confirmedCount = await Booking.countDocuments(overlapQ);
  if (confirmedCount > t.qty) {
    await Booking.deleteMany({ _id: { $in: created.map((c) => c._id) } });
    return res.status(409).json({ error: "ขออภัย ห้องเพิ่งถูกจองพอดี กรุณาเลือกวันหรือห้องใหม่" });
  }
  notifyBooking(created[0]._id).catch((e) => console.error("notify", e));
  res.json({ ok: true, ref, amount: Math.max(0, per - perDiscount) * want + addonTotal, rooms: want, discount: perDiscount * want, addonTotal });
});

export default r;
