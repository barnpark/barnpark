// หน้าเคาน์เตอร์: เลขห้อง · เช็คอิน/เอาท์/ไม่มา/ย้อน (lib/frontdesk.js) + API /bookings/:id/stay, /rooms/:id/hk, เลขห้องใน PATCH /rooms
// ใช้ express จริง + แทนเมธอดของโมเดลด้วยตัวปลอม (ไม่ต้องมีฐานข้อมูล)
process.env.JWT_SECRET = "test-secret-0123456789-abcdef";
const express = (await import("express")).default;
const Booking = (await import("../models/Booking.js")).default;
const RoomType = (await import("../models/RoomType.js")).default;
const { sign } = await import("../lib/auth.js");
const { blockOperators } = await import("../lib/security.js");
const { cleanUnits, clashingNos, roomNoError, stayAction } = await import("../lib/frontdesk.js");
const bookingRoutes = (await import("../routes/bookings.js")).default;
const roomRoutes = (await import("../routes/rooms.js")).default;

let ok = 0, bad = 0;
const t = (n, c, x) => { if (c) ok++; else { bad++; console.log("FAIL", n, x !== undefined ? JSON.stringify(x) : ""); } };

// ---- ตรรกะล้วน
let u = cleanUnits(" 101, 102 ,101,, A 1 ", [{ no: "102", hk: "dirty" }]);
t("units: clean + dedupe + keep hk", JSON.stringify(u) === JSON.stringify([{ no: "101", hk: "clean" }, { no: "102", hk: "dirty" }, { no: "A 1", hk: "clean" }]), u);
t("units: bad type -> null", cleanUnits(42) === null);
t("units: max 200", cleanUnits(Array.from({ length: 300 }, (_, i) => "r" + i)).length === 200);
t("units: clash across room types", JSON.stringify(clashingNos([{ no: "101" }, { no: "201" }], [{ units: [{ no: "101" }] }])) === '["101"]');

const B = (o) => ({ _id: "b1", status: "confirmed", stay: "", checkin: "2026-10-25", checkout: "2026-10-27", guestName: "Ann", ...o });
const units = [{ no: "101", hk: "clean" }, { no: "102", hk: "ooo" }];
t("roomNo: unknown", !!roomNoError(B(), "999", units, []));
t("roomNo: out of order", /ปิดซ่อม/.test(roomNoError(B(), "102", units, [])));
t("roomNo: busy overlapping", /มีแขก/.test(roomNoError(B(), "101", units, [B({ _id: "b2", roomNo: "101", checkin: "2026-10-26", checkout: "2026-10-28" })])));
t("roomNo: back-to-back ok", roomNoError(B(), "101", units, [B({ _id: "b2", roomNo: "101", checkin: "2026-10-27", checkout: "2026-10-28" })]) === null);
t("roomNo: checked-out guest frees room", roomNoError(B(), "101", units, [B({ _id: "b2", roomNo: "101", stay: "out" })]) === null);

const now = new Date("2026-10-25T05:00:00Z");
let a = stayAction(B(), "in", { today: "2026-10-24", units: [] }); t("in: too early", !!a.error, a);
a = stayAction(B(), "in", { today: "2026-10-27", units: [] }); t("in: after checkout", !!a.error, a);
a = stayAction(B(), "in", { today: "2026-10-25", units }); t("in: room required when units exist", /เลือกเลขห้อง/.test(a.error), a);
a = stayAction(B(), "in", { today: "2026-10-25", units, roomNo: "101", now }); t("in: ok with room", a.set && a.set.stay === "in" && a.set.roomNo === "101" && a.set.checkedInAt === now, a);
a = stayAction(B(), "in", { today: "2026-10-25", units: [] }); t("in: ok without room numbers", a.set && a.set.stay === "in" && !a.set.roomNo, a);
a = stayAction(B({ stay: "in", roomNo: "101" }), "out", {}); t("out: marks dirty", a.set.stay === "out" && a.dirty === "101", a);
a = stayAction(B(), "out", {}); t("out: needs check-in", !!a.error);
a = stayAction(B(), "noshow", { today: "2026-10-25" }); t("noshow: ok", a.set && a.set.stay === "noshow");
a = stayAction(B({ stay: "in" }), "noshow", { today: "2026-10-25" }); t("noshow: not after check-in", !!a.error);
a = stayAction(B({ stay: "out" }), "undo", {}); t("undo: out -> in", a.set.stay === "in" && a.unset.checkedOutAt === 1);
a = stayAction(B({ stay: "in" }), "undo", {}); t("undo: in -> none", a.set.stay === "" && a.unset.checkedInAt === 1);
a = stayAction(B(), "undo", {}); t("undo: nothing", !!a.error);
a = stayAction(B({ status: "cancelled" }), "in", { today: "2026-10-25" }); t("cancelled: blocked", !!a.error);
a = stayAction(B(), "assign", { roomNo: "", units }); t("assign: clear", a.unset && a.unset.roomNo === 1);
a = stayAction(B(), "hack", {}); t("bad action", !!a.error);

// ---- API (ตัวปลอมของโมเดล)
const HID = "64b7f0c2a1b2c3d4e5f60718", RID = "64b7f0c2a1b2c3d4e5f60719", R2 = "64b7f0c2a1b2c3d4e5f6071a", BID = "64b7f0c2a1b2c3d4e5f6071b";
const todayTH = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const plus = (n) => { const d = new Date(todayTH + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
let bk = { _id: BID, hotel: HID, roomType: RID, status: "confirmed", stay: "", checkin: todayTH, checkout: plus(2), guestName: "Ann" };
const rts = { [RID]: { _id: RID, hotel: HID, qty: 2, units: [{ no: "101", hk: "clean" }, { no: "102", hk: "clean" }] }, [R2]: { _id: R2, hotel: HID, qty: 1, units: [{ no: "201", hk: "clean" }] } };
const q = (v) => Object.assign(Promise.resolve(v), { select: () => ({ lean: async () => v }), lean: async () => v }); // await ตรง ๆ หรือ .select().lean() ก็ได้
Booking.findById = (id) => q(String(id) === BID ? { ...bk } : null);
Booking.find = () => q([]);
Booking.findByIdAndUpdate = async (_id, upd) => { bk = { ...bk, ...upd.$set }; for (const k of Object.keys(upd.$unset || {})) delete bk[k]; return bk; };
RoomType.findById = (id) => q(rts[String(id)] ? JSON.parse(JSON.stringify(rts[String(id)])) : null);
RoomType.find = (f) => q(Object.values(rts).filter((x) => !(f._id && f._id.$ne && String(f._id.$ne) === x._id)).map((x) => ({ units: x.units })));
const hkSet = [];
RoomType.updateOne = async (f, upd) => { hkSet.push([f["units.no"], upd.$set["units.$.hk"]]); const x = rts[String(f._id)]; const un = x && x.units.find((y) => y.no === f["units.no"]); if (un) un.hk = upd.$set["units.$.hk"]; return {}; };
RoomType.findByIdAndUpdate = async (id, upd) => ({ ...rts[String(id)], ...upd.$set });

const app = express(); app.use(express.json()); app.use("/api", blockOperators); app.use("/api", roomRoutes); app.use("/api", bookingRoutes);
const srv = app.listen(0);
const base = "http://127.0.0.1:" + srv.address().port + "/api/";
const owner = sign({ _id: "u1", role: "owner", hotel: HID }), other = sign({ _id: "u2", role: "owner", hotel: "64b7f0c2a1b2c3d4e5f60000" });
const call = async (method, path, tok, body) => {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(tok ? { authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};

let r = await call("POST", `bookings/${BID}/stay`, null, { action: "in" }); t("stay: no token 401", r.status === 401, r);
r = await call("POST", `bookings/${BID}/stay`, other, { action: "in", roomNo: "101" }); t("stay: other hotel 403", r.status === 403, r);
r = await call("POST", `bookings/${BID}/stay`, owner, { action: "in" }); t("stay: needs room", r.status === 400, r);
r = await call("POST", `bookings/${BID}/stay`, owner, { action: "in", roomNo: "201" }); t("stay: room of other type rejected", r.status === 400, r);
r = await call("POST", `bookings/${BID}/stay`, owner, { action: "in", roomNo: "101" }); t("stay: check-in", r.status === 200 && r.json.stay === "in" && r.json.roomNo === "101", r.json);
r = await call("POST", `bookings/${BID}/stay`, owner, { action: "out" }); t("stay: check-out", r.status === 200 && r.json.stay === "out", r.json);
t("stay: room now dirty", rts[RID].units[0].hk === "dirty", rts[RID].units);
r = await call("POST", `bookings/${BID}/stay`, owner, { action: "undo" }); t("stay: undo out", r.status === 200 && r.json.stay === "in" && !r.json.checkedOutAt, r.json);

r = await call("POST", `rooms/${RID}/hk`, owner, { no: "101", hk: "inspected" }); t("hk: set", r.status === 200 && rts[RID].units[0].hk === "inspected", r);
r = await call("POST", `rooms/${RID}/hk`, owner, { no: "101", hk: "sparkly" }); t("hk: bad status", r.status === 400, r);
r = await call("POST", `rooms/${RID}/hk`, owner, { no: "999", hk: "clean" }); t("hk: unknown room", r.status === 404, r);
r = await call("POST", `rooms/${RID}/hk`, other, { no: "101", hk: "clean" }); t("hk: other hotel 403", r.status === 403, r);

r = await call("PATCH", `rooms/${RID}`, owner, { units: "101, 201" }); t("units: clash with other type", r.status === 400 && /201/.test(r.json.error), r);
r = await call("PATCH", `rooms/${RID}`, owner, { units: "101, 103" }); t("units: saved, keeps hk", r.status === 200 && r.json.units.length === 2 && r.json.units[0].hk === "inspected" && r.json.units[1].hk === "clean", r.json);

srv.close();
console.log(`frontdesk: ${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
