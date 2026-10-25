// ความปลอดภัย: เจ้าของ/พนักงานยกสิทธิ์ตัวเองไม่ได้ (PATCH ที่พัก/การจอง/ห้อง/บริการ/โค้ดส่วนลด) + seed ไม่มีรหัสตั้งต้น + รหัสผ่านขั้นต่ำ 8 ตัว
// ใช้ express จริง + แทนเมธอดของโมเดลด้วยตัวปลอม (ไม่ต้องมีฐานข้อมูล/อินเทอร์เน็ต)
process.env.JWT_SECRET = "test-secret-0123456789-abcdef";
const express = (await import("express")).default;
// รหัสพนักงาน (lib/team.js): ที่พักยังไม่ตั้งทีม → ทำรายการได้โดยไม่ต้องใส่รหัส · ไม่บันทึกประวัติจริง
const TeamStaff = (await import("../models/Staff.js")).default; TeamStaff.countDocuments = async () => 0;
const TeamLog = (await import("../models/ActionLog.js")).default; TeamLog.create = async () => ({});
const M = {};
for (const n of ["Hotel", "RoomType", "Booking", "Service", "PromoCode", "User"]) M[n] = (await import(`../models/${n}.js`)).default;
const { sign } = await import("../lib/auth.js");
const { blockOperators } = await import("../lib/security.js");
const { runSeed, checkSeedOpts } = await import("../lib/seed.js");
const routes = ["hotels", "bookings", "rooms", "services", "promos", "auth"];
const R = {}; for (const n of routes) R[n] = (await import(`../routes/${n}.js`)).default;

let ok = 0, bad = 0;
const t = (n, c, x) => { if (c) ok++; else { bad++; console.log("FAIL", n, x !== undefined ? JSON.stringify(x) : ""); } };

const H1 = "64b7f0c2a1b2c3d4e5f60718", H2 = "64b7f0c2a1b2c3d4e5f60799";
const RT1 = "64b7f0c2a1b2c3d4e5f6a001", RT2 = "64b7f0c2a1b2c3d4e5f6a002"; // RT2 = ห้องของที่พักอื่น
const B1 = "64b7f0c2a1b2c3d4e5f6b001", B2 = "64b7f0c2a1b2c3d4e5f6b002";
const SV1 = "64b7f0c2a1b2c3d4e5f6c001", PR1 = "64b7f0c2a1b2c3d4e5f6d001";

// ---- ตัวปลอมของโมเดล (จดว่าเขียนอะไรลงฐานข้อมูล)
let last = null; const writes = [];
const upd = (model) => async (id, u) => { last = { model, id: String(id), u: u.$set || u }; writes.push(last); return { _id: id, ...(u.$set || u) }; };
M.Hotel.findByIdAndUpdate = upd("Hotel");
M.Hotel.findOne = (q) => ({ select: () => ({ lean: async () => (q.slug === "taken" ? { _id: H2 } : null) }) });
const bookings = {
  [B1]: { _id: B1, hotel: H1, roomType: RT1, checkin: "2026-12-01", checkout: "2026-12-03", payStatus: "paid", ref: "BP-AAAAAA", amount: 1800 },
  [B2]: { _id: B2, hotel: H2, roomType: RT2, checkin: "2026-12-01", checkout: "2026-12-02", payStatus: "", ref: "BP-BBBBBB", amount: 900 },
};
M.Booking.findById = (id) => Object.assign(Promise.resolve(bookings[String(id)] || null), { lean: async () => null }); // .lean() = ตัวแจ้งเตือน → ไม่พบ ไม่ส่งจริง
M.Booking.findByIdAndUpdate = upd("Booking");
M.Booking.create = async (doc) => { last = { model: "Booking.create", u: doc }; writes.push(last); return { _id: "new", ...doc }; };
const rooms = { [RT1]: { _id: RT1, hotel: H1, basePrice: 900, extraBedPrice: 300 }, [RT2]: { _id: RT2, hotel: H2, basePrice: 500 } };
M.RoomType.findOne = async (q) => { const x = rooms[String(q._id)]; return x && String(x.hotel) === String(q.hotel) ? x : null; };
M.RoomType.findById = async (id) => rooms[String(id)] || null;
M.RoomType.findByIdAndUpdate = upd("RoomType");
M.RoomType.create = async (doc) => { last = { model: "RoomType.create", u: doc }; return doc; };
M.Service.findById = async (id) => (String(id) === SV1 ? { _id: SV1, hotel: H1 } : null);
M.Service.findByIdAndUpdate = upd("Service");
M.PromoCode.findById = async (id) => (String(id) === PR1 ? { _id: PR1, hotel: H1, type: "percent" } : null);
M.PromoCode.findByIdAndUpdate = upd("PromoCode");
M.User.findOne = async () => null;
let seedWrites = 0; M.User.findOneAndUpdate = async () => { seedWrites++; return {}; };

const app = express(); app.use(express.json()); app.use("/api", blockOperators);
app.use("/api/auth", R.auth); for (const n of routes.filter((x) => x !== "auth")) app.use("/api", R[n]);
const srv = app.listen(0);
const base = "http://127.0.0.1:" + srv.address().port + "/api/";
const admin = sign({ _id: "u-admin", role: "admin" }), owner = sign({ _id: "u-owner", role: "owner", hotel: H1 }), staff = sign({ _id: "u-staff", role: "staff", hotel: H1 });
const call = async (method, path, tok, body) => {
  last = null;
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(tok ? { authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};

// ---- PATCH /hotels/:id — ฟิลด์ของแพลตฟอร์มแก้ได้เฉพาะแอดมิน
const platform = { approved: true, planFee: 0, status: "active", slug: "hijack", ota: [{ channel: "agoda", status: 1 }], lineChannelToken: "x", lineChannelSecret: "y", coverData: "data:image/png;base64,AA", logoData: "z", _id: H2, createdAt: "2000-01-01", passwordHash: "p" };
let r = await call("PATCH", `hotels/${H1}`, owner, { name: "บ้านสวน", tagline: "ร่มรื่น", ...platform });
t("hotel: owner 200", r.status === 200, r);
t("hotel: owner allowed fields saved", last && last.u.name === "บ้านสวน" && last.u.tagline === "ร่มรื่น", last);
t("hotel: owner platform fields dropped", last && Object.keys(platform).every((k) => !(k in last.u)), last && Object.keys(last.u));
r = await call("PATCH", `hotels/${H1}`, staff, { approved: true, planFee: 1 });
t("hotel: staff cannot approve/fee", r.status === 200 && !("approved" in last.u) && !("planFee" in last.u), last);
r = await call("PATCH", `hotels/${H2}`, owner, { name: "x" }); t("hotel: owner other hotel 403", r.status === 403 && !last, r);
r = await call("PATCH", `hotels/${H1}`, owner, { brandColor: "red;background:url(x)" }); t("hotel: bad colour 400", r.status === 400 && !last, r);
r = await call("PATCH", `hotels/${H1}`, admin, { name: "บ้านสวน", status: "paused", planFee: "1200", approved: false, slug: "Baan-Suan", ota: [{ channel: "agoda", status: 9, propertyId: "123" }, { channel: "evil" }], lineChannelToken: "x" });
t("hotel: admin 200", r.status === 200, r);
t("hotel: admin platform fields saved", last && last.u.status === "paused" && last.u.planFee === 1200 && last.u.approved === false && last.u.slug === "baan-suan", last);
t("hotel: admin ota cleaned", last && last.u.ota.length === 1 && last.u.ota[0].status === 3 && last.u.ota[0].propertyId === "123", last && last.u.ota);
t("hotel: admin token not via PATCH", last && !("lineChannelToken" in last.u), last);
r = await call("PATCH", `hotels/${H1}`, admin, { status: "deleted" }); t("hotel: admin bad status 400", r.status === 400, r);
r = await call("PATCH", `hotels/${H1}`, admin, { slug: "taken" }); t("hotel: admin slug taken 409", r.status === 409, r);
r = await call("PATCH", `hotels/${H1}`, admin, { slug: "bad slug!" }); t("hotel: admin bad slug 400", r.status === 400, r);

// ---- PATCH /bookings/:id
r = await call("PATCH", `bookings/${B2}`, owner, { guestName: "x" }); t("booking: other hotel 403", r.status === 403 && !last, r);
r = await call("PATCH", `bookings/${B1}`, owner, { hotel: H2, ref: "BP-ZZZZZZ", addonTotal: -5, discount: 9999, promoCode: "X", lineUserId: "U1", guestName: "สมชาย" });
t("booking: disallowed fields dropped", r.status === 200 && last && last.u.guestName === "สมชาย" && ["hotel", "ref", "addonTotal", "discount", "promoCode", "lineUserId"].every((k) => !(k in last.u)), last);
r = await call("PATCH", `bookings/${B1}`, owner, { roomType: RT2 }); t("booking: room of other hotel 400", r.status === 400 && !last, r);
r = await call("PATCH", `bookings/${B1}`, owner, { checkin: "1/12/2026" }); t("booking: bad date 400", r.status === 400 && !last, r);
r = await call("PATCH", `bookings/${B1}`, owner, { checkin: "2026-12-05" }); t("booking: checkout before checkin 400", r.status === 400 && !last, r);
r = await call("PATCH", `bookings/${B1}`, owner, { status: "hacked" }); t("booking: bad status 400", r.status === 400 && !last, r);
r = await call("PATCH", `bookings/${B1}`, owner, { payStatus: "free" }); t("booking: bad payStatus 400", r.status === 400 && !last, r);
// ฟอร์มแก้การจองของหลังบ้าน (app.html saveBk) ต้องใช้ได้เหมือนเดิม
const row = { roomType: RT1, guestName: "  แขก  ", guestTel: "0812345678", guestEmail: "g@example.com", channel: "walkin", notifyChannel: "none", checkin: "2026-12-02", checkout: "2026-12-04", pax: 999, extraBed: -3, amount: "2400", status: "confirmed" };
r = await call("PATCH", `bookings/${B1}`, owner, row);
t("booking: back-office edit 200", r.status === 200, r);
t("booking: values cleaned", last && last.u.guestName === "แขก" && last.u.pax === 50 && last.u.extraBed === 0 && last.u.amount === 2400 && String(last.u.roomType) === RT1 && last.u.channel === "walkin" && last.u.notifyChannel === "none" && last.u.checkin === "2026-12-02", last);
r = await call("PATCH", `bookings/${B1}`, owner, { payStatus: "deposit" }); t("booking: payStatus ok", r.status === 200 && last.u.payStatus === "deposit", last);
r = await call("PATCH", `bookings/${B1}`, admin, { guestName: "แอดมินแก้" }); t("booking: admin any hotel", r.status === 200 && last.u.guestName === "แอดมินแก้", r);

// ---- POST /hotels/:hid/bookings
r = await call("POST", `hotels/${H1}/bookings`, owner, { ...row, hotel: H2, ref: "BP-ZZZZZZ", amount: undefined, extraBed: 1, pax: 2 });
t("booking create: ok", r.status === 200 && last && String(last.u.hotel) === H1 && last.u.ref !== "BP-ZZZZZZ" && /^BP-[A-Z0-9]{6}$/.test(last.u.ref), last);
t("booking create: price from own room", last && last.u.amount === (900 + 300) * 2, last && last.u.amount);
r = await call("POST", `hotels/${H1}/bookings`, owner, { ...row, roomType: RT2 }); t("booking create: other hotel room 400", r.status === 400, r);
r = await call("POST", `hotels/${H2}/bookings`, owner, row); t("booking create: other hotel 403", r.status === 403, r);

// ---- ห้อง / บริการ / โค้ดส่วนลด: ย้ายไปที่พักอื่นหรือใส่ฟิลด์แปลก ๆ ไม่ได้
r = await call("PATCH", `rooms/${RT1}`, owner, { hotel: H2, _id: RT2, name: "ดีลักซ์", qty: -4, basePrice: "1500", createdAt: "2000-01-01" });
t("room: whitelist", r.status === 200 && last && last.u.name === "ดีลักซ์" && last.u.qty === 0 && last.u.basePrice === 1500 && !("hotel" in last.u) && !("_id" in last.u) && !("createdAt" in last.u), last);
r = await call("PATCH", `rooms/${RT1}`, owner, { seasons: [{ name: "ปีใหม่", from: "2026-12-30", to: "2027-01-02", price: 2000, minNights: 2 }] });
t("room: seasons ok", r.status === 200 && last.u.seasons.length === 1 && last.u.seasons[0].price === 2000, last);
r = await call("PATCH", `rooms/${RT1}`, owner, { seasons: [{ from: "x", to: "y" }] }); t("room: bad season 400", r.status === 400, r);
r = await call("PATCH", `rooms/${RT2}`, owner, { name: "x" }); t("room: other hotel 403", r.status === 403, r);
r = await call("POST", `hotels/${H1}/rooms`, owner, { name: "ห้องใหม่", hotel: H2, capacity: 2 }); t("room create: own hotel", r.status === 200 && String(last.u.hotel) === H1, last);
r = await call("PATCH", `services/${SV1}`, owner, { hotel: H2, name: "นวด", price: -10, saleMode: "evil", times: ["09:00", "<b>"] });
t("service: whitelist", r.status === 200 && last && !("hotel" in last.u) && last.u.price === 0 && last.u.saleMode === "addon" && last.u.times.length === 1, last);
r = await call("PATCH", `promos/${PR1}`, owner, { hotel: H2, usedCount: 0, active: false, value: 250 });
t("promo: whitelist", r.status === 200 && last && !("hotel" in last.u) && !("usedCount" in last.u) && last.u.active === false && last.u.value === 100, last);
r = await call("PATCH", `promos/${PR1}`, owner, { type: "free" }); t("promo: bad type 400", r.status === 400, r);

// ---- รหัสผ่านใหม่อย่างน้อย 8 ตัว
r = await call("POST", "auth/register", null, { hotelName: "ทดสอบ", email: "a@example.com", password: "1234567" }); t("register: 7 chars 400", r.status === 400 && /8/.test(r.json.error), r);
r = await call("POST", "auth/reset", null, { email: "a@example.com", code: "123456", password: "short" }); t("reset: short 400", r.status === 400 && /8/.test(r.json.error), r);
r = await call("POST", "auth/change-password", owner, { current: "x", password: "1234567" }); t("change-password: short 400", r.status === 400, r);
r = await call("POST", "hotels/onboard", admin, { name: "x", slug: "x-inn", ownerEmail: "o@example.com", ownerPassword: "123" }); t("onboard: short owner password 400", r.status === 400, r);

// ---- seed: ไม่มีรหัสตั้งต้น + ต้องยาว ≥ 10
t("seed: no pass -> error", !!checkSeedOpts({ adminEmail: "a@x.co" }));
t("seed: short pass -> error", /10/.test(checkSeedOpts({ adminEmail: "a@x.co", adminPass: "changeme1" }) || ""));
t("seed: hotel email without pass -> error", !!checkSeedOpts({ adminEmail: "a@x.co", adminPass: "a-long-pass-123", hotelEmail: "h@x.co" }));
t("seed: short hotel pass -> error", !!checkSeedOpts({ adminEmail: "a@x.co", adminPass: "a-long-pass-123", hotelEmail: "h@x.co", hotelPass: "short" }));
t("seed: strong -> ok", checkSeedOpts({ adminEmail: "a@x.co", adminPass: "a-long-pass-123" }) === null);
let threw = null; try { await runSeed({ adminEmail: "a@x.co", adminPass: "changeme" }); } catch (e) { threw = e.message; }
t("seed: runSeed refuses weak pass before writing", threw && seedWrites === 0, threw);
const { readFileSync } = await import("fs");
t("seed: no hard-coded default password", !/changeme/i.test(readFileSync(new URL("../seed.js", import.meta.url), "utf8")));

srv.close();
console.log(`security: ${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
