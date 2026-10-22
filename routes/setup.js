import { Router } from "express";
import crypto from "crypto";
import { runSeed } from "../lib/seed.js";
import { dailyDigest } from "../lib/notify.js";
import { maybeMonthlyFeedback } from "../lib/feedback.js";

const r = Router();
// เทียบคีย์แบบเวลาคงที่ (กันเดาคีย์จากเวลาตอบ)
const sameKey = (given, expected) => {
  const a = Buffer.from(String(given || "")), b = Buffer.from(String(expected || ""));
  return b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
};

// สรุปรายวันส่ง LINE/อีเมลให้ทุกโรงแรม — ให้ cron ภายนอกยิงวันละครั้ง
//   GET /api/cron/daily?key=<CRON_KEY>   (ตั้งใน cron-job.org เวลา ~07:00)
r.get("/cron/daily", async (req, res) => {
  if (!process.env.CRON_KEY) return res.status(403).json({ error: "CRON_KEY ยังไม่ได้ตั้งใน environment" });
  if (!sameKey(req.query.key, process.env.CRON_KEY)) return res.status(403).json({ error: "key ไม่ถูกต้อง" });
  try {
    const out = await dailyDigest();
    const feedback = await maybeMonthlyFeedback().catch((e) => ({ error: String(e.message || e) })); // แบบสอบถามรายเดือน (วันที่ FEEDBACK_DAY)
    res.json({ ok: true, ...out, feedback });
  }
  catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// เปิด URL ครั้งเดียวเพื่อใส่ข้อมูลตั้งต้น (ไม่ต้องใช้ terminal)
//   /api/setup?key=<SETUP_KEY>
// ต้องตั้ง env: SETUP_KEY, SEED_ADMIN_EMAIL, SEED_ADMIN_PASS (และ SEED_HOTEL_* ถ้าต้องการ)
r.get("/setup", async (req, res) => {
  if (!process.env.SETUP_KEY) return res.status(403).json({ error: "SETUP_KEY ยังไม่ได้ตั้งใน environment" });
  if (!sameKey(req.query.key, process.env.SETUP_KEY)) return res.status(403).json({ error: "key ไม่ถูกต้อง" });
  try {
    const out = await runSeed({
      adminEmail: process.env.SEED_ADMIN_EMAIL,
      adminPass:  process.env.SEED_ADMIN_PASS,
      hotelEmail: process.env.SEED_HOTEL_EMAIL,
      hotelPass:  process.env.SEED_HOTEL_PASS,
    });
    res.json({ ok: true, message: "ใส่ข้อมูลตั้งต้นเรียบร้อย — ล็อกอินได้แล้ว", ...out });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

export default r;
