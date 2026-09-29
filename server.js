import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { connectDB } from "./lib/db.js";

import authRoutes from "./routes/auth.js";
import hotelRoutes from "./routes/hotels.js";
import roomRoutes from "./routes/rooms.js";
import serviceRoutes from "./routes/services.js";
import bookingRoutes from "./routes/bookings.js";
import publicRoutes from "./routes/public.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "barn-park" }));
app.use("/api/auth", authRoutes);
app.use("/api/public", publicRoutes);
app.use("/api", hotelRoutes);
app.use("/api", roomRoutes);
app.use("/api", serviceRoutes);
app.use("/api", bookingRoutes);

// เสิร์ฟหน้าเว็บ (static)
app.use(express.static(path.join(__dirname, "public")));
app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
connectDB()
  .then(() => app.listen(PORT, () => console.log("BARN-PARK running on :" + PORT)))
  .catch((e) => { console.error("DB connect failed:", e); process.exit(1); });
