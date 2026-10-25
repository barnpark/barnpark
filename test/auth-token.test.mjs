// โทเคน: รหัสที่พักต้องเป็น id เสมอ แม้ user.hotel จะ populate มาแล้ว (GET /auth/me ต่ออายุโทเคน)
// เคยพัง: โทเคนใหม่เก็บที่พักทั้งอ็อบเจกต์ → canAccessHotel ไม่ผ่าน → ทุกคำขอ forbidden และหน้าเว็บโหลดห้อง/รูปไม่ได้
process.env.JWT_SECRET = "test-secret-0123456789-abcdef";
const express = (await import("express")).default;
const jwt = (await import("jsonwebtoken")).default;
const User = (await import("../models/User.js")).default;
const { sign, canAccessHotel } = await import("../lib/auth.js");
const authRoutes = (await import("../routes/auth.js")).default;

let ok = 0, bad = 0;
const t = (n, c, x) => { if (c) ok++; else { bad++; console.log("FAIL", n, x !== undefined ? JSON.stringify(x) : ""); } };
const HID = "64b7f0c2a1b2c3d4e5f60718";
const dec = (tok) => jwt.verify(tok, process.env.JWT_SECRET);

t("sign: plain id", dec(sign({ _id: "u1", role: "owner", hotel: HID })).hotel === HID);
t("sign: populated hotel", dec(sign({ _id: "u1", role: "owner", hotel: { _id: HID, name: "Inn", slug: "inn" } })).hotel === HID);
t("sign: admin no hotel", dec(sign({ _id: "a", role: "admin" })).hotel === null);

// /auth/me ต่ออายุโทเคน → โทเคนใหม่ยังเข้าที่พักเดิมได้
User.findById = () => ({ populate: async () => ({ _id: "u1", email: "o@x.com", role: "owner", name: "Owner", hotel: { _id: HID, name: "Inn", slug: "inn", toString() { return "{ _id: " + HID + ", name: 'Inn' }"; } } }) });
const app = express(); app.use(express.json()); app.use("/api/auth", authRoutes);
const srv = app.listen(0);
const r = await fetch("http://127.0.0.1:" + srv.address().port + "/api/auth/me", { headers: { authorization: "Bearer " + sign({ _id: "u1", role: "owner", hotel: HID }) } });
const me = await r.json();
const renewed = dec(me.token);
t("me: renewed token keeps hotel id", renewed.hotel === HID, renewed);
t("me: renewed token can access hotel", canAccessHotel(renewed, HID));
srv.close();
console.log(`auth token: ${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
