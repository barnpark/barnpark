import { Router } from "express";
import Review from "../models/Review.js";
import { requireAuth, canAccessHotel } from "../lib/auth.js";

const r = Router();

r.get("/hotels/:hid/reviews", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.hid)) return res.status(403).json({ error: "forbidden" });
  res.json(await Review.find({ hotel: req.params.hid }).sort("-createdAt"));
});
r.patch("/reviews/:id", requireAuth, async (req, res) => {
  const rv = await Review.findById(req.params.id);
  if (!rv) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, rv.hotel)) return res.status(403).json({ error: "forbidden" });
  res.json(await Review.findByIdAndUpdate(req.params.id, { approved: !!req.body.approved }, { new: true }));
});
r.delete("/reviews/:id", requireAuth, async (req, res) => {
  const rv = await Review.findById(req.params.id);
  if (!rv) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, rv.hotel)) return res.status(403).json({ error: "forbidden" });
  await rv.deleteOne();
  res.json({ ok: true });
});

export default r;
