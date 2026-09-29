import { Router } from "express";
import Service from "../models/Service.js";
import { requireAuth, canAccessHotel } from "../lib/auth.js";

const r = Router();

r.get("/hotels/:hid/services", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.hid)) return res.status(403).json({ error: "forbidden" });
  res.json(await Service.find({ hotel: req.params.hid }).sort("sort"));
});

r.post("/hotels/:hid/services", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.hid)) return res.status(403).json({ error: "forbidden" });
  res.json(await Service.create({ ...req.body, hotel: req.params.hid }));
});

r.patch("/services/:id", requireAuth, async (req, res) => {
  const sv = await Service.findById(req.params.id);
  if (!sv) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, sv.hotel)) return res.status(403).json({ error: "forbidden" });
  const { hotel, ...safe } = req.body;
  res.json(await Service.findByIdAndUpdate(req.params.id, safe, { new: true }));
});

r.delete("/services/:id", requireAuth, async (req, res) => {
  const sv = await Service.findById(req.params.id);
  if (!sv) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, sv.hotel)) return res.status(403).json({ error: "forbidden" });
  await sv.deleteOne();
  res.json({ ok: true });
});

export default r;
