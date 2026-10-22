// ห้องว่างแบบนับรายคืน (lib/availability.js) + จุดที่ใช้: createRoomBooking (lib/booking.js), GET /api/public/availability
// แทนโมเดลด้วยที่เก็บในหน่วยความจำ + แทน fetch (แจ้งเตือนไม่ออกอินเทอร์เน็ตจริง)
Object.assign(process.env, { PUBLIC_URL: "https://bp.test", JWT_SECRET: "test-secret-0123456789-abcdef" });
delete process.env.BREVO_API_KEY; delete process.env.LINE_CHANNEL_TOKEN;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt = {}) => (String(url).startsWith("http://127.0.0.1") ? realFetch(url, opt) : new Response("{}", { status: 200 }));

const mongoose = (await import("mongoose")).default;
const M = {};
for (const n of ["Hotel", "RoomType", "Booking", "Service", "PromoCode", "LineChat", "User"]) M[n] = (await import(`../models/${n}.js`)).default;
const { peakOf, usedPeak, usedPeaks, freeFor } = await import("../lib/availability.js");
const { createRoomBooking } = await import("../lib/booking.js");
const express = (await import("express")).default;
const publicRoutes = (await import("../routes/public.js")).default;

let ok = 0, bad = 0;
const t = (n, c, x) => { if (c) ok++; else { bad++; console.log("FAIL", n, x !== undefined ? JSON.stringify(x).slice(0, 400) : ""); } };

// ---- ที่เก็บในหน่วยความจำ (รองรับเฉพาะ query ที่โค้ดนี้ใช้)
const S = (v) => (v instanceof mongoose.Types.ObjectId ? String(v) : v);
const eq = (a, b) => String(S(a) ?? "") === String(S(b) ?? "") && (a != null) === (b != null);
const match = (d, q = {}) => Object.entries(q).every(([k, c]) => {
  const v = d[k];
  if (c && typeof c === "object" && !(c instanceof mongoose.Types.ObjectId) && Object.keys(c).some((x) => x[0] === "$")) {
    return Object.entries(c).every(([op, x]) => op === "$ne" ? !eq(v, x) : op === "$lt" ? v < x : op === "$lte" ? v <= x : op === "$gt" ? v > x : op === "$gte" ? v >= x : op === "$in" ? x.some((y) => eq(v, y)) : false);
  }
  return eq(v, c);
});
const clone = (x) => (x ? JSON.parse(JSON.stringify(x)) : x);
const chain = (run) => ({ sort() { return this; }, limit() { return this; }, select() { return this; }, lean() { return this; }, populate() { return this; }, then(a, b) { return Promise.resolve().then(run).then(a, b); } });
const db = {};
let finds = 0, beforeCreate = null;
function stub(Mo) {
  const rows = (db[Mo.modelName] = []);
  const find = (q) => rows.filter((r) => match(r, q));
  Mo.find = (q) => { if (Mo.modelName === "Booking") finds++; return chain(() => find(q).map(clone)); };
  Mo.findOne = (q) => chain(() => clone(find(q)[0] || null));
  Mo.findById = (id) => Mo.findOne({ _id: String(id) });
  Mo.countDocuments = (q) => chain(() => find(q).length);
  Mo.create = async (o) => {
    if (Mo.modelName === "Booking" && beforeCreate) { const f = beforeCreate; beforeCreate = null; await f(); }
    const r = { ...clone(o), _id: String(new mongoose.Types.ObjectId()) }; rows.push(r); return clone(r);
  };
  Mo.updateOne = () => chain(() => ({ modifiedCount: 0 }));
  Mo.deleteMany = (q) => chain(() => { const r = find(q); r.forEach((x) => rows.splice(rows.indexOf(x), 1)); return { deletedCount: r.length }; });
}
Object.values(M).forEach(stub);

const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const day = (n) => { const d = new Date(today + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const [MON, TUE, WED, THU, FRI] = [10, 11, 12, 13, 14].map(day);

// ---- peakOf (ไม่แตะฐานข้อมูล)
const L = [{ checkin: MON, checkout: TUE }, { checkin: WED, checkout: THU }];
t("peak: Mon→Tue + Wed→Thu in Mon→Thu = 1 room per night", peakOf(L, MON, THU) === 1);
t("peak: Tue→Wed night empty", peakOf(L, TUE, WED) === 0);
t("peak: stacked nights count", peakOf([...L, { checkin: MON, checkout: FRI }], MON, THU) === 2);
t("peak: booking starting before range counts on first night", peakOf([{ checkin: day(5), checkout: TUE }], MON, THU) === 1);

// ---- ข้อมูลตั้งต้น
const h = await M.Hotel.create({ name: "บ้านทดสอบ", slug: "test-home", promptpayId: "0812345678", payPromptpay: true, holdHours: 24 });
const one = await M.RoomType.create({ hotel: h._id, name: "เดี่ยว", qty: 1, capacity: 2, basePrice: 1000, sort: 1 });
const two = await M.RoomType.create({ hotel: h._id, name: "คู่", qty: 2, capacity: 2, basePrice: 1500, sort: 2 });
const bk = (rt, din, dout, status = "confirmed") => M.Booking.create({ hotel: h._id, roomType: rt._id, checkin: din, checkout: dout, status });
for (const rt of [one, two]) { await bk(rt, MON, TUE); await bk(rt, WED, THU); await bk(rt, TUE, WED, "cancelled"); }

// ---- usedPeak / usedPeaks / freeFor
t("qty1: Mon→Thu full (Mon and Wed used)", (await freeFor(one, MON, THU)) === 0);
t("qty1: Tue→Wed free (cancelled ignored)", (await freeFor(one, TUE, WED)) === 1);
t("checkout day not overlapping: Thu→Fri free", (await usedPeak(one._id, THU, FRI)) === 0 && (await freeFor(one, TUE, WED)) === 1);
t("qty2: Mon→Thu has 1 free (old logic said 0)", (await freeFor(two, MON, THU)) === 1);
finds = 0;
const P = await usedPeaks([one._id, two._id], MON, THU);
t("usedPeaks: one query, per-room peaks", finds === 1 && P[String(one._id)] === 1 && P[String(two._id)] === 1, P);
t("bad range → 0 without query", (await usedPeak(one._id, THU, MON)) === 0 && (await usedPeak(one._id, undefined, THU)) === 0);

// ---- createRoomBooking
const book = (rt, din, dout, rooms = 1) => createRoomBooking(h, { roomTypeId: String(rt._id), din, dout, name: "แขก", tel: "0899999999", rooms, payMethod: "promptpay" });
let r = await book(two, MON, THU);
t("book: qty2 Mon→Thu accepted (old logic refused)", r.status === 200 && r.created.length === 1, r.body);
r = await book(two, MON, TUE);
t("book: Mon night now truly full → refused", r.status === 409, r.body);
r = await book(two, TUE, WED);
t("book: Tue night still has 1 → accepted", r.status === 200, r.body);
r = await book(one, TUE, WED, 2);
t("book: want 2 rooms > qty1 → refused", r.status === 409, r.body);

// ---- race: อีกคนจองคืนเดียวกันตัดหน้าระหว่างบันทึก → ถอนการจองของเราออก
const three = await M.RoomType.create({ hotel: h._id, name: "สาม", qty: 1, capacity: 2, basePrice: 800, sort: 3 });
beforeCreate = () => bk(three, WED, THU);
const n0 = db.Booking.length;
r = await book(three, TUE, FRI);
t("race: overbooked after insert → 409", r.status === 409 && /เพิ่งถูกจอง/.test(r.body.error), r.body);
t("race: our docs deleted, competitor kept", db.Booking.length === n0 + 1 && db.Booking.filter((b) => b.roomType === String(three._id)).length === 1);
r = await book(three, TUE, WED);
t("race: other night still bookable", r.status === 200, r.body);

// ---- GET /api/public/availability
const app = express(); app.use(express.json()); app.use("/api/public", publicRoutes);
const srv = app.listen(0);
const av = async (din, dout) => (await realFetch(`http://127.0.0.1:${srv.address().port}/api/public/availability?slug=test-home&din=${din}&dout=${dout}`)).json();
let a = await av(THU, FRI);
t("api: Thu→Fri all free", a.length === 3 && a.every((x) => x.available === x.qty), a.map((x) => x.available));
db.Booking.splice(0); await bk(two, MON, TUE); await bk(two, WED, THU); await bk(one, MON, TUE);
a = await av(MON, THU);
t("api: qty2 Mon→Thu shows 1, qty1 shows 0", a.find((x) => x.name === "คู่").available === 1 && a.find((x) => x.name === "เดี่ยว").available === 0, a.map((x) => [x.name, x.available]));
a = await av(TUE, WED);
t("api: Tue→Wed all free", a.every((x) => x.available === x.qty), a.map((x) => x.available));
srv.close();

console.log(`availability: ${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
