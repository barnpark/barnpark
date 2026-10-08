import { Router } from "express";
import Hotel from "../models/Hotel.js";
import RoomType from "../models/RoomType.js";
import Booking from "../models/Booking.js";
import Service from "../models/Service.js";
import { notifyBooking } from "../lib/notify.js";

const r = Router();

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
    out.push({
      roomTypeId: t._id, name: t.name, capacity: t.capacity, basePrice: t.basePrice,
      otaPrice: t.otaPrice, extraBedPrice: t.extraBedPrice, imageUrl: t.imageUrl,
      images: (t.images && t.images.length) ? t.images : (t.imageUrl ? [t.imageUrl] : []),
      qty: t.qty, available: Math.max(0, t.qty - booked),
    });
  }
  res.json(out);
});

// จองตรงจากหน้าแขก — ตรวจห้องว่างฝั่งเซิร์ฟเวอร์ + สร้างหลายห้องได้ + ยิงแจ้งเตือน
r.post("/book", async (req, res) => {
  const { slug, roomTypeId, din, dout, name, tel, email, pax, note, notify, rooms = 1, extraBed = 0, payRef = "", paid = false } = req.body || {};
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
  const per = (t.basePrice + (+extraBed) * (t.extraBedPrice || 0)) * nights;
  const ref = "BP-" + Date.now().toString(36).toUpperCase().slice(-6);
  const created = [];
  for (let i = 0; i < want; i++) {
    created.push(await Booking.create({
      hotel: h._id, roomType: t._id, guestName: name, guestTel: tel, guestEmail: email || "",
      channel: "direct", checkin: din, checkout: dout, pax: +pax || 1, amount: per, extraBed: +extraBed,
      status: "confirmed", notifyChannel: notify || "email", ref: ref + (i ? "-" + i : ""), note: note || "",
      payStatus: paid ? "reported" : "unpaid", payMethod: paid ? "promptpay" : "", payRef: payRef || "",
    }));
  }
  // ★ กันจองซ้อน (race condition): ตรวจซ้ำหลังบันทึก — ถ้าเกินโควตาให้ถอนคืนแล้วแจ้งเต็ม
  const confirmedCount = await Booking.countDocuments(overlapQ);
  if (confirmedCount > t.qty) {
    await Booking.deleteMany({ _id: { $in: created.map((c) => c._id) } });
    return res.status(409).json({ error: "ขออภัย ห้องเพิ่งถูกจองพอดี กรุณาเลือกวันหรือห้องใหม่" });
  }
  notifyBooking(created[0]._id).catch((e) => console.error("notify", e));
  res.json({ ok: true, ref, amount: per * want, rooms: want });
});

export default r;
