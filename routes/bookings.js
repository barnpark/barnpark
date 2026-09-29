import { Router } from "express";
import Booking from "../models/Booking.js";
import RoomType from "../models/RoomType.js";
import { requireAuth, canAccessHotel } from "../lib/auth.js";
import { notifyBooking } from "../lib/notify.js";

const r = Router();

const mkRef = () => "BP-" + Date.now().toString(36).toUpperCase().slice(-6);

r.get("/hotels/:hid/bookings", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.hid)) return res.status(403).json({ error: "forbidden" });
  const since = req.query.since; // "YYYY-MM-DD" optional
  const q = { hotel: req.params.hid };
  if (since) q.checkout = { $gte: since };
  res.json(await Booking.find(q).sort("checkin"));
});

r.post("/hotels/:hid/bookings", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.hid)) return res.status(403).json({ error: "forbidden" });
  const b = req.body || {};
  if (!b.checkin || !b.checkout || b.checkout <= b.checkin) return res.status(400).json({ error: "invalid dates" });
  let amount = b.amount;
  if (amount == null && b.roomType) {
    const t = await RoomType.findById(b.roomType);
    const nights = Math.max(1, Math.round((new Date(b.checkout) - new Date(b.checkin)) / 86400000));
    amount = t ? (t.basePrice + (+b.extraBed || 0) * (t.extraBedPrice || 0)) * nights : 0;
  }
  const created = await Booking.create({ ...b, amount, hotel: req.params.hid, ref: b.ref || mkRef() });
  notifyBooking(created._id).catch((e) => console.error("notify", e));
  res.json(created);
});

r.patch("/bookings/:id", requireAuth, async (req, res) => {
  const bk = await Booking.findById(req.params.id);
  if (!bk) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, bk.hotel)) return res.status(403).json({ error: "forbidden" });
  const { hotel, ...safe } = req.body;
  res.json(await Booking.findByIdAndUpdate(req.params.id, safe, { new: true }));
});

r.delete("/bookings/:id", requireAuth, async (req, res) => {
  const bk = await Booking.findById(req.params.id);
  if (!bk) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, bk.hotel)) return res.status(403).json({ error: "forbidden" });
  await bk.deleteOne();
  res.json({ ok: true });
});

export default r;
