import "dotenv/config";
import express from "express";
import "./lib/asyncerrors.js";
import path from "path";
import { fileURLToPath } from "url";
import { connectDB } from "./lib/db.js";
import { rateLimit } from "./lib/ratelimit.js";
import { securityHeaders, blockOperators } from "./lib/security.js";
import { releaseExpiredHolds } from "./lib/holds.js";
import { bookPageHandler } from "./lib/og.js";
import { robotsTxt, sitemapXml, siteBase } from "./lib/seo.js";
import { migratePalettes } from "./lib/presets.js";
import Hotel from "./models/Hotel.js";

import authRoutes from "./routes/auth.js";
import hotelRoutes from "./routes/hotels.js";
import roomRoutes from "./routes/rooms.js";
import serviceRoutes from "./routes/services.js";
import bookingRoutes from "./routes/bookings.js";
import promoRoutes from "./routes/promos.js";
import reviewRoutes from "./routes/reviews.js";
import publicRoutes from "./routes/public.js";
import setupRoutes from "./routes/setup.js";
import lineRoutes from "./routes/line.js";
import activityRoutes from "./routes/activities.js";
import feedbackRoutes from "./routes/feedback.js";
import devRoutes from "./routes/dev.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable("x-powered-by");
app.use(securityHeaders);
app.use(express.json({ limit: "12mb", verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use("/api", blockOperators); // กันการยิง MongoDB operator ผ่าน input

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "barn-park" }));
// กัน brute-force ล็อกอิน/OTP และสแปมหน้าจอง
app.use("/api/auth", rateLimit({ windowMs: 10 * 60 * 1000, max: 40, message: "พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่" }));
app.use("/api/public/cancel", rateLimit({ windowMs: 10 * 60 * 1000, max: 10, message: "ลองบ่อยเกินไป กรุณารอสักครู่" }));
app.use("/api/feedback", rateLimit({ windowMs: 10 * 60 * 1000, max: 20, message: "ส่งความเห็นบ่อยเกินไป กรุณารอสักครู่" }));
app.use("/api/auth/forgot", rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: "ขอรหัสบ่อยเกินไป กรุณารอ 15 นาที" }));
app.use("/api/public/lookup", rateLimit({ windowMs: 10 * 60 * 1000, max: 15, message: "ลองบ่อยเกินไป กรุณารอสักครู่" }));
app.use("/api/public/report-paid", rateLimit({ windowMs: 10 * 60 * 1000, max: 10, message: "ลองบ่อยเกินไป กรุณารอสักครู่" }));
app.use("/api/public/review", rateLimit({ windowMs: 10 * 60 * 1000, max: 10, message: "ลองบ่อยเกินไป กรุณารอสักครู่" }));
app.use("/api/public/receipt", rateLimit({ windowMs: 10 * 60 * 1000, max: 60, message: "ลองบ่อยเกินไป กรุณารอสักครู่" }));
app.use("/api/public/map", rateLimit({ windowMs: 10 * 60 * 1000, max: 120, message: "ลองบ่อยเกินไป กรุณารอสักครู่" }));
app.use("/sitemap.xml", rateLimit({ windowMs: 10 * 60 * 1000, max: 30, message: "เรียกบ่อยเกินไป" }));
app.use("/api/public/promo", rateLimit({ windowMs: 10 * 60 * 1000, max: 30, message: "ลองบ่อยเกินไป กรุณารอสักครู่" }));
app.use("/api/public/book-activity", rateLimit({ windowMs: 10 * 60 * 1000, max: 20, message: "ส่งคำขอจองบ่อยเกินไป กรุณารอสักครู่" }));
app.use("/api/dev", rateLimit({ windowMs: 10 * 60 * 1000, max: 60, message: "เรียกบ่อยเกินไป" }));
app.use("/api/public/book", rateLimit({ windowMs: 10 * 60 * 1000, max: 20, message: "ส่งคำขอจองบ่อยเกินไป กรุณารอสักครู่" }));
app.use("/api/auth/register", rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: "สมัครบ่อยเกินไป กรุณารอ 1 ชั่วโมง" }));
app.use("/api/setup", rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: "ลองบ่อยเกินไป กรุณารอ 15 นาที" }));
app.use("/api/cron", rateLimit({ windowMs: 10 * 60 * 1000, max: 20, message: "เรียกบ่อยเกินไป" }));
app.use("/api/auth", authRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/line", lineRoutes);
app.use("/api/dev", devRoutes); // GitHub แจ้งผลงานแก้เว็บที่สั่งผ่าน LINE (lib/devjobs.js)
app.use("/api", setupRoutes);
app.use("/api", hotelRoutes);
app.use("/api", roomRoutes);
app.use("/api", serviceRoutes);
app.use("/api", bookingRoutes);
app.use("/api", promoRoutes);
app.use("/api", reviewRoutes);
app.use("/api", activityRoutes);
app.use("/api", feedbackRoutes);

// ให้ Google หาเจอ (lib/seo.js)
app.get("/robots.txt", (req, res) => res.type("text/plain").set("Cache-Control", "public, max-age=3600").send(robotsTxt(siteBase(req))));
app.get("/sitemap.xml", async (req, res, next) => {
  try { res.type("application/xml").set("Cache-Control", "public, max-age=3600").send(await sitemapXml(siteBase(req))); } catch (e) { next(e); }
});
// หน้าจองของแต่ละที่พัก (ใส่ชื่อ/รูปปกใน meta ให้ลิงก์ที่แชร์ใน LINE/Facebook ขึ้นการ์ดสวย ๆ)
app.get("/book.html", bookPageHandler(path.join(__dirname, "public", "book.html")));
// เสิร์ฟหน้าเว็บ (static)
app.use(express.static(path.join(__dirname, "public")));
app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// กันเซิร์ฟเวอร์ล่มจาก error ที่ไม่ได้ดักไว้ (เช่น id ผิดรูปแบบใน route แบบ async)
process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e && e.message ? e.message : e));
app.use((err, _req, res, _next) => {
  if (err && err.name === "CastError") return res.status(404).json({ error: "ไม่พบข้อมูล" }); // id ผิดรูปแบบ
  if (err && err.type === "entity.too.large") return res.status(413).json({ error: "ไฟล์/ข้อมูลใหญ่เกินไป" });
  console.error("route error:", err && err.message);
  res.status(500).json({ error: "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง" });
});

// เตือนถ้าลืมตั้งค่าลับสำคัญ (โทเคนอาจถูกปลอมได้ถ้าใช้ค่า default)
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) console.warn("⚠️  JWT_SECRET ยังไม่ได้ตั้ง (หรือสั้นเกินไป) — ระบบสุ่มค่าชั่วคราวให้ ทุกคนต้องล็อกอินใหม่ทุกครั้งที่รีสตาร์ต ตั้งค่าสุ่มยาว ๆ ใน Render Environment");
if (!process.env.BREVO_API_KEY) console.warn("⚠️  BREVO_API_KEY ยังไม่ได้ตั้ง — OTP จะไม่ส่ง และระบบจะเข้าสู่ระบบแบบไม่มี OTP (ชั่วคราว)");
if (process.env.LINE_CHANNEL_TOKEN && !process.env.LINE_CHANNEL_SECRET) console.warn("⚠️  LINE_CHANNEL_SECRET ยังไม่ได้ตั้ง — บอทจัดการที่พักใน LINE Barn Park ยังปิดอยู่");

const PORT = process.env.PORT || 3000;
connectDB()
  .then(() => {
    app.listen(PORT, () => console.log("BARN-PARK running on :" + PORT));
    migratePalettes(Hotel).catch((e) => console.error("palettes", e.message)); // ชุดสีรุ่นแรก → ชุดใหม่ที่อ่านง่ายกว่า
    // ปล่อยห้องค้างไม่จ่ายอัตโนมัติ: รันตอนเริ่ม + ทุก 15 นาที
    releaseExpiredHolds().catch((e) => console.error("holds", e));
    const t = setInterval(() => releaseExpiredHolds().catch((e) => console.error("holds", e)), 15 * 60 * 1000);
    if (t.unref) t.unref();
  })
  .catch((e) => { console.error("DB connect failed:", e); process.exit(1); });
