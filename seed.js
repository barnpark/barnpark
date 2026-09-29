// สร้างข้อมูลตัวอย่าง: admin + โรงแรมเดโม + ห้อง + ผู้ใช้โรงแรม
// รัน: node seed.js   (ต้องตั้ง MONGODB_URI ก่อน)
import "dotenv/config";
import bcrypt from "bcryptjs";
import { connectDB } from "./lib/db.js";
import User from "./models/User.js";
import Hotel from "./models/Hotel.js";
import RoomType from "./models/RoomType.js";
import Service from "./models/Service.js";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || "admin@barnpark.co";
const ADMIN_PASS  = process.env.SEED_ADMIN_PASS  || "changeme123";
const HOTEL_EMAIL = process.env.SEED_HOTEL_EMAIL || "hotel@barnpark.co";
const HOTEL_PASS  = process.env.SEED_HOTEL_PASS  || "changeme123";

await connectDB();

const admin = await User.findOneAndUpdate(
  { email: ADMIN_EMAIL },
  { email: ADMIN_EMAIL, role: "admin", name: "Platform Owner", passwordHash: bcrypt.hashSync(ADMIN_PASS, 10) },
  { upsert: true, new: true }
);

let hotel = await Hotel.findOne({ slug: "barnbarn" });
if (!hotel) {
  hotel = await Hotel.create({
    slug: "barnbarn", name: "บ้าน-บ้าน สุขพอดี", location: "ฉะเชิงเทรา",
    phone: "038-000-000", lineId: "@barnbarn", brandColor: "#0d9488",
    tagline: "ที่พักชุมชน อบอุ่น สุขพอดี", about: "ที่พักชุมชนบรรยากาศอบอุ่นที่ฉะเชิงเทรา",
    ota: [{ channel: "agoda", status: 0 }, { channel: "booking", status: 0 }, { channel: "trip", status: 0 }],
  });
  await RoomType.create([
    { hotel: hotel._id, name: "Standard", capacity: 2, qty: 4, basePrice: 900, otaPrice: 1050, extraBedPrice: 300, sort: 1 },
    { hotel: hotel._id, name: "Deluxe", capacity: 2, qty: 4, basePrice: 1200, otaPrice: 1400, extraBedPrice: 350, sort: 2 },
    { hotel: hotel._id, name: "Suite ริมน้ำ", capacity: 4, qty: 2, basePrice: 1800, otaPrice: 2100, extraBedPrice: 400, sort: 3 },
  ]);
  await Service.create([
    { hotel: hotel._id, name: "นวดแผนไทย", description: "60 นาที", price: 300, sort: 1 },
    { hotel: hotel._id, name: "อาหารเช้า", description: "เซ็ตริมน้ำ", price: 150, sort: 2 },
  ]);
}

await User.findOneAndUpdate(
  { email: HOTEL_EMAIL },
  { email: HOTEL_EMAIL, role: "owner", name: "เจ้าของโรงแรม", hotel: hotel._id, passwordHash: bcrypt.hashSync(HOTEL_PASS, 10) },
  { upsert: true, new: true }
);

console.log("Seed done.");
console.log("  admin:", ADMIN_EMAIL, "/", ADMIN_PASS);
console.log("  hotel:", HOTEL_EMAIL, "/", HOTEL_PASS, "→", hotel.slug);
process.exit(0);
