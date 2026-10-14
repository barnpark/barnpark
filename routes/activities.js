import { Router } from "express";
import ActivityBooking from "../models/ActivityBooking.js";
import Service from "../models/Service.js";
import Hotel from "../models/Hotel.js";
import { requireAuth, canAccessHotel } from "../lib/auth.js";
import { createActivityBooking } from "../lib/activity.js";

const r = Router();

// การจองกิจกรรมเดี่ยวของโรงแรม (ตั้งแต่วันที่ since)
r.get("/hotels/:hid/activity-bookings", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.hid)) return res.status(403).json({ error: "forbidden" });
  const q = { hotel: req.params.hid };
  if (req.query.since) q.date = { $gte: String(req.query.since) };
  res.json(await ActivityBooking.find(q).sort({ date: 1, time: 1 }).limit(500));
});
// เจ้าของบันทึกการจองกิจกรรมเอง (walk-in/โทร)
r.post("/hotels/:hid/activity-bookings", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.hid)) return res.status(403).json({ error: "forbidden" });
  const h = await Hotel.findById(req.params.hid);
  const svc = await Service.findOne({ _id: req.body.serviceId, hotel: req.params.hid });
  if (!h || !svc) return res.status(404).json({ error: "ไม่พบกิจกรรม" });
  try { res.json(await createActivityBooking(h, svc, { ...req.body, channel: req.body.channel || "walkin", payStatus: req.body.payStatus || "unpaid" })); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
r.patch("/activity-bookings/:id", requireAuth, async (req, res) => {
  const b = await ActivityBooking.findById(req.params.id);
  if (!b) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, b.hotel)) return res.status(403).json({ error: "forbidden" });
  const set = {};
  for (const k of ["payStatus", "status", "note", "guestName", "guestTel"]) if (req.body[k] !== undefined) set[k] = req.body[k];
  res.json(await ActivityBooking.findByIdAndUpdate(b._id, { $set: set }, { new: true }));
});
r.delete("/activity-bookings/:id", requireAuth, async (req, res) => {
  const b = await ActivityBooking.findById(req.params.id);
  if (!b) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, b.hotel)) return res.status(403).json({ error: "forbidden" });
  await b.deleteOne();
  res.json({ ok: true });
});

export default r;
