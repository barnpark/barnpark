import { Router } from "express";
import Review from "../models/Review.js";
import { requireAuth, canAccessHotel } from "../lib/auth.js";
import { actor, logAction } from "../lib/team.js";

const r = Router();

r.get("/hotels/:hid/reviews", requireAuth, async (req, res) => {
  if (!canAccessHotel(req.user, req.params.hid)) return res.status(403).json({ error: "forbidden" });
  res.json(await Review.find({ hotel: req.params.hid }).sort("-createdAt"));
});
r.patch("/reviews/:id", requireAuth, async (req, res) => {
  const rv = await Review.findById(req.params.id);
  if (!rv) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, rv.hotel)) return res.status(403).json({ error: "forbidden" });
  const who = await actor(req, res, rv.hotel, "reviews"); if (!who) return;
  const out = await Review.findByIdAndUpdate(req.params.id, { approved: !!req.body.approved }, { new: true });
  await logAction(rv.hotel, who, "review.edit", rv.guestName || "", req.body.approved ? "อนุมัติ" : "ซ่อน");
  res.json(out);
});
r.delete("/reviews/:id", requireAuth, async (req, res) => {
  const rv = await Review.findById(req.params.id);
  if (!rv) return res.status(404).json({ error: "not found" });
  if (!canAccessHotel(req.user, rv.hotel)) return res.status(403).json({ error: "forbidden" });
  const who = await actor(req, res, rv.hotel, "reviews"); if (!who) return;
  await rv.deleteOne();
  await logAction(rv.hotel, who, "review.delete", rv.guestName || "");
  res.json({ ok: true });
});

export default r;
