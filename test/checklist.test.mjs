// เช็กความครบ (lib/checklist.js): รายการใหม่ เลขห้อง · ทีมงาน · พื้นที่ + ปุ่ม LINE ไม่ชี้ไปรายการที่ทำได้แค่ในเว็บ
const RoomType = (await import("../models/RoomType.js")).default;
const LineChat = (await import("../models/LineChat.js")).default;
const Staff = (await import("../models/Staff.js")).default;
const { checklist } = await import("../lib/checklist.js");
const { checklistBubble } = await import("../lib/announce.js");

let ok = 0, bad = 0;
const t = (n, c, x) => { if (c) ok++; else { bad++; console.log("FAIL", n, x !== undefined ? JSON.stringify(x) : ""); } };
const h = { _id: "64b7f0c2a1b2c3d4e5f60718", name: "Inn", slug: "inn", phone: "081", notifyEmail: "a@b.c", promptpayId: "0812345678" };
const room = (o) => ({ images: ["https://x/a.jpg"], breakfast: "none", ...o });
const get = (c, k) => c.items.find((i) => i.key === k).ok;

let c = await checklist(h, { rooms: [room({ units: [] })], linked: 1, managers: 0, usage: { over: false } });
t("units: missing when no room numbers", get(c, "units") === false);
t("team: missing without manager", get(c, "team") === false);
t("space: ok when not over", get(c, "space") === true);
t("new items are not must", c.items.filter((i) => ["units", "team", "space"].includes(i.key)).every((i) => !i.must));
c = await checklist(h, { rooms: [room({ units: [{ no: "101" }] }), room({ hidden: true })], linked: 1, managers: 1, usage: { over: true } });
t("units: ok (hidden rooms ignored)", get(c, "units") === true);
t("team: ok with manager", get(c, "team") === true);
t("space: missing when over quota", get(c, "space") === false);
c = await checklist(h, { rooms: [room({ units: [{ no: "1" }] })], linked: 1, managers: 1, usage: null });
t("space: unknown usage not counted as missing", get(c, "space") === true);

// ค่าที่ไม่ส่งมา → อ่านจากฐานข้อมูล
RoomType.find = () => ({ select: () => ({ lean: async () => [room({ units: [{ no: "1" }] })] }) });
LineChat.countDocuments = async () => 0;
let asked = null; Staff.countDocuments = async (q) => { asked = q; return 2; };
c = await checklist(h, { usage: { over: false } });
t("team: counts active managers of hotel", get(c, "team") === true && asked.manager === true && asked.active === true && asked.hotel === h._id, asked);

// LINE: ปุ่มเฉพาะรายการที่แก้ใน LINE ได้ · รายการเว็บบอก “(ทำในเว็บหลังบ้าน)”
c = await checklist(h, { rooms: [room({ units: [] })], linked: 1, managers: 0, usage: { over: true } });
const s = JSON.stringify(checklistBubble(h, c));
t("bubble: no null postback", !s.includes("null&") && !/"data":"null/.test(s));
t("bubble: web-only hint", s.includes("ทำในเว็บหลังบ้าน"));
console.log(`checklist: ${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
