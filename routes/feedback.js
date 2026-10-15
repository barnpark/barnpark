import { Router } from "express";
import mongoose from "mongoose";
import Feedback from "../models/Feedback.js";
import Hotel from "../models/Hotel.js";
import User from "../models/User.js";
import { requireAuth, requireAdmin } from "../lib/auth.js";
import { rememberBase } from "../lib/baseurl.js";
import { CATS, STATUS, createFeedback, monthKey, replyToSender, askMonthlyFeedback, feedbackSummary } from "../lib/feedback.js";

const r = Router();
const pub = (f) => ({ id: f._id, category: f.category, rating: f.rating, text: f.text, source: f.source, status: f.status, reply: f.reply, repliedAt: f.repliedAt, createdAt: f.createdAt, month: f.month });

// ===== ที่พัก: ส่งความเห็นจากเว็บหลังบ้าน =====
r.post("/feedback", requireAuth, async (req, res) => {
  if (!req.user.hotel) return res.status(400).json({ error: "บัญชีนี้ยังไม่ได้ผูกกับที่พัก" });
  const { category = "other", text = "", rating } = req.body || {};
  const t = String(text || "").trim();
  const rt = rating === undefined || rating === null || rating === "" ? undefined : parseInt(rating, 10);
  if (rt !== undefined && !(rt >= 1 && rt <= 5)) return res.status(400).json({ error: "คะแนน 1–5" });
  if (t.length < 2 && rt === undefined) return res.status(400).json({ error: "พิมพ์ความเห็นอย่างน้อย 2 ตัวอักษร หรือให้คะแนน" });
  if (t.length > 2000) return res.status(400).json({ error: "ยาวไม่เกิน 2,000 ตัวอักษร" });
  const h = await Hotel.findById(req.user.hotel).select("name").lean();
  if (!h) return res.status(404).json({ error: "ไม่พบที่พัก" });
  const u = await User.findById(req.user.id).select("name email").lean();
  const fb = await createFeedback({
    hotel: h._id, hotelName: h.name, source: "web", category: CATS[category] ? category : "other",
    rating: rt, month: rt ? monthKey() : undefined, text: t, senderName: (u && (u.name || u.email)) || "", user: u && u._id,
  });
  res.json({ ok: true, feedback: pub(fb) });
});
// ความเห็นที่ที่พักนี้เคยส่ง (ดูสถานะ + คำตอบ)
r.get("/feedback/mine", requireAuth, async (req, res) => {
  if (!req.user.hotel) return res.json([]);
  const list = await Feedback.find({ hotel: req.user.hotel }).sort("-createdAt").limit(30).lean();
  res.json(list.map(pub));
});

// ===== แอดมิน =====
r.get("/admin/feedback", requireAuth, requireAdmin, async (req, res) => {
  const q = {};
  if (STATUS[req.query.status]) q.status = req.query.status;
  if (CATS[req.query.category]) q.category = req.query.category;
  if (req.query.withText === "1") q.text = { $nin: ["", null] };
  const items = await Feedback.find(q).sort("-createdAt").limit(300).lean();
  res.json({ items: items.map((f) => ({ ...pub(f), hotel: f.hotel, hotelName: f.hotelName, senderName: f.senderName, hasImage: !!f.hasImage, viaLine: !!f.lineUserId })), summary: await feedbackSummary() });
});
r.get("/admin/feedback/:id", requireAuth, requireAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "ไม่พบ" });
  const f = await Feedback.findById(req.params.id).select("+image").lean();
  if (!f) return res.status(404).json({ error: "ไม่พบ" });
  res.json({ ...pub(f), hotelName: f.hotelName, senderName: f.senderName, image: f.image || "" });
});
// เปลี่ยนสถานะ / ตอบกลับ → แจ้งคนส่งทาง LINE (หรืออีเมลที่พัก)
r.patch("/admin/feedback/:id", requireAuth, requireAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "ไม่พบ" });
  const f = await Feedback.findById(req.params.id);
  if (!f) return res.status(404).json({ error: "ไม่พบ" });
  const { status, reply, notify = true } = req.body || {};
  const before = { status: f.status, reply: f.reply || "" };
  if (status !== undefined) { if (!STATUS[status]) return res.status(400).json({ error: "สถานะไม่ถูกต้อง" }); f.status = status; }
  if (reply !== undefined) { const t = String(reply || "").trim(); if (t.length > 1000) return res.status(400).json({ error: "ยาวไม่เกิน 1,000 ตัวอักษร" }); f.reply = t; if (t) f.repliedAt = new Date(); }
  await f.save();
  let sentVia = "";
  const changed = f.status !== before.status || (f.reply || "") !== before.reply;
  if (notify && changed && (f.reply || f.status !== "new")) sentVia = await replyToSender(f.toObject()).catch((e) => { console.error("feedback reply", e.message); return "error"; });
  res.json({ ok: true, feedback: pub(f), sentVia });
});
// ส่งแบบสอบถามรายเดือนเอง (ปกติระบบส่งให้ทุกวันที่ 1 ผ่าน cron) — dryRun = แค่นับ
r.post("/admin/feedback/ask", requireAuth, requireAdmin, async (req, res) => {
  rememberBase(req);
  const { dryRun = true, force = false } = req.body || {};
  res.json(await askMonthlyFeedback({ dryRun: dryRun !== false, force: !!force }));
});

export default r;
