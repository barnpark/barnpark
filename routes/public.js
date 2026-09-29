import { Router } from "express";
import Hotel from "../models/Hotel.js";
import RoomType from "../models/RoomType.js";
import Booking from "../models/Booking.js";
import Service from "../models/Service.js";
import { notifyBooking } from "../lib/notify.js";

const r = Router();

// ข้อมูลโรงแรมสาธารณะ (ไม่คืน token/secret)
r.get("/hotel/:slug", async (req, res) => {
  const h = await Hotel.findOne({ slug: req.params.slug });
  if (!h) return res.status(404).json({ error: "not found" });
  res.json({
    id: h._id, slug: h.slug, name: h.name, location: h.location, phone: h.phone, lineId: h.lineId,
    brandColor: h.brandColor, tagline: h.tagline, coverUrl: h.coverUrl, about: h.about,
    promoText: h.promoText, promoImage: h.promoImage,
  });
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
      qty: t.qty, available: Math.max(0, t.qty - booked),
    });
  }
  res.json(out);
});

// จองตรงจากหน้าแขก — ตรวจห้องว่างฝั่งเซิร์ฟเวอร์ + สร้างหลายห้องได้ + ยิงแจ้งเตือน
r.post("/book", async (req, res) => {
  const { slug, roomTypeId, din, dout, name, tel, email, pax, note, notify, rooms = 1, extraBed = 0 } = req.body || {};
  const h = await Hotel.findOne({ slug });
  if (!h) return res.status(404).json({ error: "hotel not found" });
  if (!name || !tel) return res.status(400).json({ error: "กรุณากรอกชื่อและเบอร์โทร" });
  if (!din || !dout || dout <= din) return res.status(400).json({ error: "invalid dates" });
  const t = await RoomType.findOne({ _id: roomTypeId, hotel: h._id });
  if (!t) return res.status(404).json({ error: "room not found" });

  const want = Math.max(1, +rooms);
  const booked = await Booking.countDocuments({
    roomType: t._id, status: { $ne: "cancelled" }, checkin: { $lt: dout }, checkout: { $gt: din },
  });
  if (booked + want > t.qty) return res.status(409).json({ error: "no availability" });

  const nights = Math.max(1, Math.round((new Date(dout) - new Date(din)) / 86400000));
  const per = (t.basePrice + (+extraBed) * (t.extraBedPrice || 0)) * nights;
  const ref = "BP-" + Date.now().toString(36).toUpperCase().slice(-6);
  const created = [];
  for (let i = 0; i < want; i++) {
    created.push(await Booking.create({
      hotel: h._id, roomType: t._id, guestName: name, guestTel: tel, guestEmail: email || "",
      channel: "direct", checkin: din, checkout: dout, pax: +pax || 1, amount: per, extraBed: +extraBed,
      status: "confirmed", notifyChannel: notify || "email", ref: ref + (i ? "-" + i : ""), note: note || "",
    }));
  }
  notifyBooking(created[0]._id).catch((e) => console.error("notify", e));
  res.json({ ok: true, ref, amount: per * want, rooms: want });
});

export default r;
