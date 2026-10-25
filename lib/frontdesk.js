// ===== หน้าเคาน์เตอร์ (front desk): เลขห้อง · เช็คอิน/เช็คเอาท์/ไม่มา · สถานะทำความสะอาด =====
// เลขห้องเก็บใน RoomType.units [{ no, hk }] — ไม่แตะ qty (ห้องว่างยังนับจาก qty เหมือนเดิม)
// สถานะเข้าพักเก็บใน Booking.stay: "" ยังไม่มา | in พักอยู่ | out ออกแล้ว | noshow ไม่มา (ปล่อยห้องคืนที่เหลือ)
export const HK = ["clean", "dirty", "inspected", "ooo"]; // สะอาด · รอทำความสะอาด · ตรวจแล้ว · ปิดซ่อม
export const HK_TH = { clean: "สะอาด", dirty: "รอทำความสะอาด", inspected: "ตรวจแล้ว พร้อมขาย", ooo: "ปิดซ่อม" };
export const STAY = ["", "in", "out", "noshow"];
export const STAY_TH = { "": "ยังไม่มา", in: "พักอยู่", out: "เช็คเอาท์แล้ว", noshow: "ไม่มา" };

export const normRoomNo = (v) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, 12);

// รายการเลขห้องจากหลังบ้าน (array ของสตริง/อ็อบเจกต์ หรือข้อความคั่นด้วย ,) → [{ no, hk }] ไม่ซ้ำ สูงสุด 200
// เก็บสถานะทำความสะอาดเดิมของเลขที่ยังอยู่ · คืน null ถ้ารูปแบบไม่ถูกต้อง
export function cleanUnits(input, old = []) {
  const list = typeof input === "string" ? input.split(",") : Array.isArray(input) ? input : null;
  if (!list) return null;
  const prev = {};
  for (const u of old || []) if (u && u.no) prev[u.no] = u.hk;
  const out = [], seen = new Set();
  for (const x of list.slice(0, 200)) {
    const no = normRoomNo(x && typeof x === "object" ? x.no : x);
    if (!no || seen.has(no.toLowerCase())) continue;
    seen.add(no.toLowerCase());
    out.push({ no, hk: HK.includes(prev[no]) ? prev[no] : "clean" });
  }
  return out;
}

// เลขห้องที่ซ้ำกับห้องประเภทอื่นของที่พักเดียวกัน (เลขห้องต้องไม่ซ้ำทั้งที่พัก)
export function clashingNos(units, others = []) {
  const taken = new Set();
  for (const t of others) for (const u of t.units || []) taken.add(String(u.no).toLowerCase());
  return units.filter((u) => taken.has(u.no.toLowerCase())).map((u) => u.no);
}

const overlaps = (a, b) => a.checkin < b.checkout && b.checkin < a.checkout;

// ตรวจเลขห้องที่จะให้การจองนี้: ต้องเป็นเลขของห้องประเภทนี้ ไม่ปิดซ่อม และไม่มีการจองอื่นใช้เลขเดียวกันในคืนที่ทับกัน
// others = การจองอื่นของที่พักที่ทับช่วง (ยังไม่ยกเลิก ไม่ใช่ noshow) — คืนข้อความ error หรือ null
export function roomNoError(bk, roomNo, units = [], others = []) {
  const u = units.find((x) => x.no === roomNo);
  if (!u) return "ไม่พบเลขห้องนี้ในห้องประเภทนี้ — ตั้งเลขห้องที่ ห้อง & ราคา → 🔢";
  if (u.hk === "ooo") return `ห้อง ${roomNo} ปิดซ่อมอยู่`;
  const busy = others.find((o) => String(o._id) !== String(bk._id) && o.roomNo === roomNo && o.status !== "cancelled" && o.stay !== "noshow" && o.stay !== "out" && overlaps(o, bk));
  if (busy) return `ห้อง ${roomNo} มีแขก ${busy.guestName || ""} ช่วง ${busy.checkin} – ${busy.checkout} แล้ว`;
  return null;
}

// action จากหน้าเคาน์เตอร์ → { set, unset, dirty } หรือ { error }
//   assign = ให้เลขห้องล่วงหน้า · in = เช็คอิน · out = เช็คเอาท์ (ห้องเป็น "รอทำความสะอาด") · noshow = ไม่มา · undo = ย้อนขั้นล่าสุด
export function stayAction(bk, action, { roomNo = "", today, units = [], others = [], now = new Date() } = {}) {
  if (!bk || bk.status === "cancelled") return { error: "การจองนี้ถูกยกเลิกแล้ว" };
  const stay = bk.stay || "";
  const no = normRoomNo(roomNo);
  const withRoom = (set) => {
    if (!no) return units.length && !bk.roomNo && action === "in" ? { error: "เลือกเลขห้องก่อนเช็คอิน" } : { set };
    const err = roomNoError(bk, no, units, others);
    return err ? { error: err } : { set: { ...set, roomNo: no } };
  };
  switch (action) {
    case "assign":
      if (stay === "out" || stay === "noshow") return { error: "การจองนี้ปิดไปแล้ว" };
      if (!no) return { set: {}, unset: { roomNo: 1 } };
      return withRoom({});
    case "in":
      if (stay === "in") return { error: "เช็คอินไปแล้ว" };
      if (stay === "out") return { error: "เช็คเอาท์ไปแล้ว" };
      if (today < bk.checkin) return { error: "ยังไม่ถึงวันเช็คอิน (" + bk.checkin + ")" };
      if (today >= bk.checkout) return { error: "เลยวันเช็คเอาท์แล้ว — แก้วันที่ของการจองก่อน" };
      return withRoom({ stay: "in", checkedInAt: now });
    case "out":
      if (stay !== "in") return { error: "ยังไม่ได้เช็คอิน" };
      return { set: { stay: "out", checkedOutAt: now }, dirty: bk.roomNo || "" };
    case "noshow":
      if (stay) return { error: "เปลี่ยนเป็น “ไม่มา” ได้เฉพาะการจองที่ยังไม่เช็คอิน" };
      if (today < bk.checkin) return { error: "ยังไม่ถึงวันเช็คอิน" };
      return { set: { stay: "noshow" } };
    case "undo":
      if (stay === "in") return { set: { stay: "" }, unset: { checkedInAt: 1 } };
      if (stay === "out") return { set: { stay: "in" }, unset: { checkedOutAt: 1 } };
      if (stay === "noshow") return { set: { stay: "" } };
      return { error: "ไม่มีอะไรให้ย้อน" };
    default:
      return { error: "คำสั่งไม่ถูกต้อง" };
  }
}
