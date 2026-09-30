import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { connectDB } from "./lib/db.js";
import { rateLimit } from "./lib/ratelimit.js";

import authRoutes from "./routes/auth.js";
import hotelRoutes from "./routes/hotels.js";
import roomRoutes from "./routes/rooms.js";
import serviceRoutes from "./routes/services.js";
import bookingRoutes from "./routes/bookings.js";
import publicRoutes from "./routes/public.js";
import setupRoutes from "./routes/setup.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "barn-park" }));
// กัน brute-force ล็อกอิน/OTP และสแปมหน้าจอง
app.use("/api/auth", rateLimit({ windowMs: 10 * 60 * 1000, max: 40, message: "พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่" }));
app.use("/api/public/book", rateLimit({ windowMs: 10 * 60 * 1000, max: 20, message: "ส่งคำขอจองบ่อยเกินไป กรุณารอสักครู่" }));
app.use("/api/auth", authRoutes);
app.use("/api/public", publicRoutes);
app.use("/api", setupRoutes);
app.use("/api", hotelRoutes);
app.use("/api", roomRoutes);
app.use("/api", serviceRoutes);
app.use("/api", bookingRoutes);

// เสิร์ฟหน้าเว็บ (static)
app.use(express.static(path.join(__dirname, "public")));
app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// เตือนถ้าลืมตั้งค่าลับสำคัญ (โทเคนอาจถูกปลอมได้ถ้าใช้ค่า default)
if (!process.env.JWT_SECRET) console.warn("⚠️  JWT_SECRET ยังไม่ได้ตั้ง — ใช้ค่า default ที่ไม่ปลอดภัย! ตั้งใน Render Environment ก่อนใช้จริง");
if (!process.env.BREVO_API_KEY) console.warn("⚠️  BREVO_API_KEY ยังไม่ได้ตั้ง — OTP จะไม่ส่ง และระบบจะเข้าสู่ระบบแบบไม่มี OTP (ชั่วคราว)");

const PORT = process.env.PORT || 3000;
connectDB()
  .then(() => app.listen(PORT, () => console.log("BARN-PARK running on :" + PORT)))
  .catch((e) => { console.error("DB connect failed:", e); process.exit(1); });
