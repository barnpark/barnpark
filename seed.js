// รันจากเครื่อง: node seed.js  (ต้องตั้ง MONGODB_URI + SEED_ADMIN_EMAIL + SEED_ADMIN_PASS ก่อน)
// ไม่มีรหัสผ่านตั้งต้นในโค้ด — ต้องตั้ง SEED_ADMIN_PASS (และ SEED_HOTEL_PASS ถ้าจะสร้างบัญชีที่พักตัวอย่าง) อย่างน้อย 10 ตัวอักษร
import "dotenv/config";
import { connectDB } from "./lib/db.js";
import { runSeed, checkSeedOpts } from "./lib/seed.js";

const opts = {
  adminEmail: process.env.SEED_ADMIN_EMAIL || "admin@barnpark.co",
  adminPass:  process.env.SEED_ADMIN_PASS,
  hotelEmail: process.env.SEED_HOTEL_EMAIL || (process.env.SEED_HOTEL_PASS ? "hotel@barnpark.co" : undefined),
  hotelPass:  process.env.SEED_HOTEL_PASS,
};
const err = checkSeedOpts(opts);
if (err) { console.error("Seed ไม่ทำงาน:", err); process.exit(1); }
await connectDB();
const out = await runSeed(opts);
console.log("Seed done:", out);
process.exit(0);
