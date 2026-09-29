// ฟังก์ชันใส่ข้อมูลตั้งต้น (ใช้ทั้ง seed.js และ route /api/setup)
// สมมติว่าเชื่อม DB แล้ว — idempotent รันซ้ำได้ ไม่ลบข้อมูล
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import Hotel from "../models/Hotel.js";
import RoomType from "../models/RoomType.js";
import Service from "../models/Service.js";

export async function runSeed(opts = {}) {
  const adminEmail = opts.adminEmail;
  const adminPass  = opts.adminPass;
  const hotelEmail = opts.hotelEmail;
  const hotelPass  = opts.hotelPass;
  if (!adminEmail || !adminPass) throw new Error("ต้องตั้ง SEED_ADMIN_EMAIL และ SEED_ADMIN_PASS ก่อน");

  await User.findOneAndUpdate(
    { email: adminEmail.toLowerCase() },
    { email: adminEmail.toLowerCase(), role: "admin", name: "Platform Owner", passwordHash: bcrypt.hashSync(adminPass, 10) },
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

  if (hotelEmail && hotelPass) {
    await User.findOneAndUpdate(
      { email: hotelEmail.toLowerCase() },
      { email: hotelEmail.toLowerCase(), role: "owner", name: "เจ้าของโรงแรม", hotel: hotel._id, passwordHash: bcrypt.hashSync(hotelPass, 10) },
      { upsert: true, new: true }
    );
  }

  return { adminEmail, hotelEmail: hotelEmail || null, hotelSlug: hotel.slug };
}
