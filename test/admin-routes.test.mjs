// API แอดมิน: ตัวคำนวณ Channex (/admin/calc/channex) + ลบที่พักถาวร (/admin/hotels/:id/delete)
// ใช้ express จริง + แทนเมธอดของโมเดลด้วยตัวปลอม (ไม่ต้องมีฐานข้อมูล)
process.env.JWT_SECRET = "test-secret-0123456789-abcdef";
const express = (await import("express")).default;
const M = {};
for (const n of ["Hotel", "RoomType", "Booking", "Service", "ActivityBooking", "PromoCode", "Review", "User", "LineChat", "Feedback", "LinkCode", "Setting"]) M[n] = (await import(`../models/${n}.js`)).default;
const { sign } = await import("../lib/auth.js");
const { blockOperators } = await import("../lib/security.js");
const hotelRoutes = (await import("../routes/hotels.js")).default;

let ok = 0, bad = 0;
const t = (n, c, x) => { if (c) ok++; else { bad++; console.log("FAIL", n, x !== undefined ? JSON.stringify(x) : ""); } };

// ---- ตัวปลอมของโมเดล
let store = null;
M.Setting.findOne = (q) => ({ lean: async () => (q.key === "calc:channex" && store ? { ...store } : null) });
M.Setting.findOneAndUpdate = (q, upd) => ({ lean: async () => { store = { key: q.key, value: upd.$set.value, updatedAt: new Date("2026-10-18T04:00:00Z") }; return { ...store }; } });
M.User.findById = (id) => ({ select: () => ({ lean: async () => (id === "u-admin" ? { email: "bell@example.com", name: "Platform Owner" } : null) }) });
const HID = "64b7f0c2a1b2c3d4e5f60718";
let hotelExists = true; const deletes = [];
const counts = { RoomType: 4, Booking: 7, Service: 2, ActivityBooking: 3, PromoCode: 1, Review: 5, User: 2, LineChat: 1, Feedback: 1 };
M.Hotel.findById = (id) => ({ select: () => ({ lean: async () => (hotelExists && String(id) === HID ? { _id: HID, name: "Test Inn", slug: "test-inn" } : null) }) });
M.Hotel.deleteOne = async (q) => { deletes.push(["Hotel", q]); hotelExists = false; return { deletedCount: 1 }; };
for (const n of Object.keys(counts)) {
  M[n].countDocuments = async (q) => (n === "Booking" && q.checkout ? 2 : counts[n]);
  M[n].deleteMany = async (q) => { deletes.push([n, q]); return { deletedCount: counts[n] }; };
}
M.LinkCode.deleteMany = async (q) => { deletes.push(["LinkCode", q]); return { deletedCount: 1 }; };
M.LineChat.find = () => ({ select: () => ({ lean: async () => [{ _id: "c1" }] }) });
M.LineChat.findById = () => ({ lean: async () => null }); // ถอดจาก LINE: ไม่พบแชท → ไม่เรียก LINE จริง

const app = express(); app.use(express.json()); app.use("/api", blockOperators); app.use("/api", hotelRoutes);
const srv = app.listen(0);
const base = "http://127.0.0.1:" + srv.address().port + "/api/admin/";
const admin = sign({ _id: "u-admin", role: "admin" }), owner = sign({ _id: "u-owner", role: "owner", hotel: HID });
const call = async (method, path, tok, body) => {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(tok ? { authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};

// ---- ตัวคำนวณ Channex
let r = await call("GET", "calc/channex"); t("calc: no token 401", r.status === 401, r);
r = await call("GET", "calc/channex", owner); t("calc: owner 403", r.status === 403, r);
r = await call("POST", "calc/channex", owner, { fx: 33 }); t("calc: owner POST 403", r.status === 403, r);
r = await call("GET", "calc/channex", admin); t("calc: empty -> null", r.status === 200 && r.json === null, r);
r = await call("POST", "calc/channex", admin, { fx: "34.25", hotels: "12", same: false, cxh: "5", pf: 130, ph: "7", chat: true, extra: "7", prices: [{ label: " 10 ที่แรก ", thb: "800" }, { label: "", thb: "" }, { label: "<img src=x>", thb: 1300 }], junk: "x" });
t("calc: save 200", r.status === 200, r);
t("calc: values cleaned", r.json && r.json.fx === 34.25 && r.json.hotels === 12 && r.json.same === false && r.json.cxh === 5 && r.json.chat === true && r.json.extra === 7 && r.json.prices.length === 2 && r.json.prices[0].label === "10 ที่แรก" && r.json.junk === undefined, r.json);
t("calc: saved by email", r.json && r.json.by === "bell@example.com");
r = await call("GET", "calc/channex", admin); t("calc: read back", r.status === 200 && r.json && r.json.fx === 34.25, r.json);
r = await call("POST", "calc/channex", admin, { fx: 33, $where: "1" }); t("calc: operator key blocked", r.status === 400, r);
r = await call("POST", "calc/channex", admin, { prices: Array.from({ length: 40 }, (_, i) => ({ label: "p" + i, thb: i + 1 })) }); t("calc: max 12 prices", r.status === 200 && r.json.prices.length === 12);
r = await call("POST", "calc/channex", admin, { fx: "", hotels: "" }); t("calc: blank -> null", r.status === 200 && r.json.fx === null && r.json.hotels === null, r.json);

// ---- ลบที่พัก
r = await call("GET", `hotels/${HID}/delete-preview`); t("delete: preview no token 401", r.status === 401, r);
r = await call("GET", `hotels/${HID}/delete-preview`, owner); t("delete: preview owner 403", r.status === 403, r);
r = await call("GET", "hotels/nothex/delete-preview", admin); t("delete: bad id 404", r.status === 404, r);
r = await call("GET", `hotels/${HID}/delete-preview`, admin); t("delete: preview counts", r.status === 200 && r.json.slug === "test-inn" && r.json.counts.rooms === 4 && r.json.counts.upcoming === 2 && r.json.counts.lineChats === 1, r.json);
r = await call("POST", `hotels/${HID}/delete`, owner, { confirm: "test-inn" }); t("delete: owner 403", r.status === 403, r);
r = await call("POST", `hotels/${HID}/delete`, admin, { confirm: "wrong" }); t("delete: wrong slug 400", r.status === 400 && deletes.length === 0, r);
r = await call("POST", `hotels/${HID}/delete`, admin, {}); t("delete: no confirm 400", r.status === 400 && deletes.length === 0, r);
r = await call("POST", `hotels/${HID}/delete`, admin, { confirm: { $ne: "x" } }); t("delete: operator blocked", r.status === 400 && deletes.length === 0, r);
r = await call("POST", `hotels/${HID}/delete`, admin, { confirm: " test-inn " });
t("delete: ok", r.status === 200 && r.json.ok && r.json.deleted.rooms === 4 && r.json.deleted.users === 2 && r.json.deleted.lineChats === 1, r.json);
const names = deletes.map((d) => d[0]);
t("delete: every collection", ["RoomType", "Booking", "Service", "ActivityBooking", "PromoCode", "Review", "LinkCode", "Feedback", "User", "Hotel"].every((n) => names.includes(n)), names);
t("delete: admins kept", JSON.stringify(deletes.find((d) => d[0] === "User")[1]).includes('"$ne":"admin"'));
t("delete: hotel last", names[names.length - 1] === "Hotel", names);
r = await call("GET", `hotels/${HID}/delete-preview`, admin); t("delete: gone afterwards", r.status === 404, r);

srv.close();
console.log(`admin routes: ${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
