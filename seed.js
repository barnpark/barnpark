// รันจากเครื่อง: node seed.js  (ต้องตั้ง MONGODB_URI + SEED_ADMIN_* ก่อน)
import "dotenv/config";
import { connectDB } from "./lib/db.js";
import { runSeed } from "./lib/seed.js";

await connectDB();
const out = await runSeed({
  adminEmail: process.env.SEED_ADMIN_EMAIL || "admin@barnpark.co",
  adminPass:  process.env.SEED_ADMIN_PASS  || "changeme123",
  hotelEmail: process.env.SEED_HOTEL_EMAIL || "hotel@barnpark.co",
  hotelPass:  process.env.SEED_HOTEL_PASS  || "changeme123",
});
console.log("Seed done:", out);
process.exit(0);
