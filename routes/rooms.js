import { Router } from "express";
import RoomType from "../models/RoomType.js";
import { requireAuth, canAccessHotel } from "../lib/auth.js";

const r = Router();

r.get("/hotels/:hid/rooms", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.hid)) return res.status(403).json({ error: "forbidden" });
  res.json(await RoomType.find({ hotel: req.params.hid }).sort("sort"));
});

r.post("/hotels/:hid/rooms", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.hid)) return res.status(403).json({ error: "forbidden" });
  res.json(await RoomType.create({ ...req.body, hotel: req.params.hid }));
});

r.patch("/rooms/:id", requireAuth, async (req, res) => {
  const rt = await RoomType.findById(req.params.id);
  if (!rt) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, rt.hotel)) return res.status(403).json({ error: "forbidden" });
  const { hotel, ...safe } = req.body;
  res.json(await RoomType.findByIdAndUpdate(req.params.id, safe, { new: true }));
});

r.delete("/rooms/:id", requireAuth, async (req, res) => {
  const rt = await RoomType.findById(req.params.id);
  if (!rt) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, rt.hotel)) return res.status(403).json({ error: "forbidden" });
  await rt.deleteOne();
  res.json({ ok: true });
});

export default r;
