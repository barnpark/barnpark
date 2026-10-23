// ใบเสร็จ / ใบยืนยันการจอง (lib/receipt.js, GET /api/public/receipt, ลิงก์ในเว็บหลังบ้าน) — ไม่ต้องมีฐานข้อมูล
Object.assign(process.env, { JWT_SECRET: "test-secret-0123456789-abcdef", PUBLIC_URL: "https://bp.test" });
const realFetch = globalThis.fetch;
const express = (await import("express")).default;
const M = {};
for (const n of ["Hotel", "RoomType", "Booking", "ActivityBooking"]) M[n] = (await import(`../models/${n}.js`)).default;
const { receiptKey, receiptUrl, receiptData } = await import("../lib/receipt.js");
const { sign } = await import("../lib/auth.js");
const publicRoutes = (await import("../routes/public.js")).default;
const bookingRoutes = (await import("../routes/bookings.js")).default;

let ok = 0, bad = 0;
const t = (n, c, x) => { if (c) ok++; else { bad++; console.log("FAIL", n, x !== undefined ? JSON.stringify(x).slice(0, 400) : ""); } };
const q = (v) => ({ select() { return this; }, sort() { return this; }, lean: async () => (typeof v === "function" ? v() : v) });

const HID = "64b7f0c2a1b2c3d4e5f60718", OTHER = "64b7f0c2a1b2c3d4e5f60719";
const hotel = { _id: HID, name: "บ้านทดสอบ", slug: "test-home", taxId: "0105555000000", phone: "0811111111", address: "1 ถ.ทดสอบ", brandColor: "#7c2d12", accentColor: "#d97706", fontFamily: "Prompt", uiStyle: "soft", template: "classic", lineChannelToken: "SECRET-TOKEN" };
const rooms = [
  { _id: "b1", hotel: HID, ref: "BP-ABC123", roomType: "rt1", checkin: "2026-11-01", checkout: "2026-11-03", status: "confirmed", payStatus: "paid", payMethod: "promptpay", guestName: "สมชาย", guestTel: "0899999999", guestEmail: "x@y.z",
    amount: 2400 - 200 + 600 + 500, discount: 200, promoCode: "SAVE", breakfastTotal: 600, breakfastPax: 2, breakfastDates: ["2026-11-02", "2026-11-03"], addonTotal: 500, addons: [{ name: "นวด", price: 500, qty: 1, date: "2026-11-02" }], extraBed: 1, pax: 3 },
  { _id: "b2", hotel: HID, ref: "BP-ABC123-1", roomType: "rt1", checkin: "2026-11-01", checkout: "2026-11-03", status: "confirmed", payStatus: "paid", amount: 2400 - 200, discount: 200 },
];
M.Hotel.findOne = (f) => q(() => (f.slug === "test-home" ? { ...hotel } : null));
M.Hotel.findById = (id) => q(() => (String(id) === HID ? { ...hotel } : null));
M.RoomType.findById = () => q({ name: "ห้องริมน้ำ" });
M.Booking.find = (f) => q(() => rooms.filter((b) => b.hotel === f.hotel && f.ref.test(b.ref)));
M.Booking.findById = (id) => q(() => rooms.find((b) => b._id === id) || null);
M.ActivityBooking.findOne = (f) => q(() => (f.ref === "BA-XYZ789" ? { hotel: HID, ref: "BA-XYZ789", serviceName: "คลาสทำอาหาร", date: "2026-11-05", time: "09:00", qty: 2, amount: 1200, status: "confirmed", payStatus: "unpaid", guestName: "Anna", guestTel: "0811" } : null));

// ---- รหัสลับของลิงก์
const k = receiptKey(HID, "BP-ABC123");
t("key is stable, per hotel + booking, and the same for sub-rooms", k && k === receiptKey(HID, "BP-ABC123-1") && k !== receiptKey(OTHER, "BP-ABC123") && k !== receiptKey(HID, "BP-ABC124"));
t("receipt URL built from PUBLIC_URL", receiptUrl(hotel, "BP-ABC123") === `https://bp.test/receipt.html?h=test-home&ref=BP-ABC123&k=${k}`);

// ---- ข้อมูลใบเสร็จ
const d = await receiptData(hotel, "BP-ABC123");
t("room receipt totals: 2 rooms 4,800 − discount 400 + breakfast 600 + massage 500 = 5,500", d.total === 5500 && d.discount === 400 && d.lines[0].amount === 4800 && d.lines[0].qty === 2, d);
t("lines: room, breakfast with mornings, dated extra", d.lines.length === 3 && d.lines[1].detail.dates.length === 2 && d.lines[2].th === "นวด" && d.lines[2].detail.date === "2026-11-02", d.lines);
t("hotel theme passed to the page (template, colours, font)", d.hotel.template === "classic" && d.hotel.brandColor === "#7c2d12" && d.hotel.fontFamily === "Prompt" && d.hotel.taxId === "0105555000000");
t("no secrets / contact details leak", !JSON.stringify(d).includes("SECRET-TOKEN") && !JSON.stringify(d).includes("0899999999") && !JSON.stringify(d).includes("x@y.z"));
t("paid status", d.payStatus === "paid" && d.status === "confirmed" && d.kind === "room");
const a = await receiptData(hotel, "BA-XYZ789");
t("activity receipt", a.kind === "act" && a.total === 1200 && a.lines[0].detail.time === "09:00" && a.payStatus === "unpaid");
t("bad ref → null", (await receiptData(hotel, "NOPE")) === null && (await receiptData(hotel, "BP-ZZZZZZ")) === null);

// ---- API สาธารณะ + ลิงก์ในเว็บหลังบ้าน
const app = express(); app.use(express.json()); app.use("/api/public", publicRoutes); app.use("/api", bookingRoutes);
const srv = app.listen(0); await new Promise((r) => srv.once("listening", r));
const base = "http://127.0.0.1:" + srv.address().port;
let r = await realFetch(`${base}/api/public/receipt?h=test-home&ref=BP-ABC123&k=${k}`);
let j = await r.json();
t("public receipt with valid key", r.status === 200 && j.total === 5500 && r.headers.get("cache-control") === "no-store", j);
r = await realFetch(`${base}/api/public/receipt?h=test-home&ref=BP-ABC123&k=wrong-key-wrong-key-xx`);
t("wrong key → 404", r.status === 404);
r = await realFetch(`${base}/api/public/receipt?h=test-home&ref=BP-ABC124&k=${k}`);
t("key of another booking → 404", r.status === 404);
const owner = sign({ _id: "u1", role: "owner", hotel: HID }), stranger = sign({ _id: "u2", role: "owner", hotel: OTHER });
r = await realFetch(`${base}/api/bookings/64b7f0c2a1b2c3d4e5f60700/receipt-link`, { headers: { authorization: "Bearer " + owner } });
t("unknown booking id → 404", r.status === 404);
M.Booking.findById = (id) => q(() => (String(id) === "64b7f0c2a1b2c3d4e5f60701" ? { hotel: HID, ref: "BP-ABC123" } : null));
r = await realFetch(`${base}/api/bookings/64b7f0c2a1b2c3d4e5f60701/receipt-link`, { headers: { authorization: "Bearer " + owner } });
j = await r.json();
t("owner gets the receipt link", r.status === 200 && j.url === receiptUrl(hotel, "BP-ABC123"), j);
r = await realFetch(`${base}/api/bookings/64b7f0c2a1b2c3d4e5f60701/receipt-link`, { headers: { authorization: "Bearer " + stranger } });
t("other hotel's owner refused", r.status === 403);
srv.close();

console.log(`receipt: ${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
