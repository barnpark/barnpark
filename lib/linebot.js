// =====================================================================
//  บอท LINE OA "Barn Park" — ให้โรงแรมสมัคร + จัดการที่พักผ่านแชท
//  เมนู: ➕ เพิ่มห้อง/กิจกรรม · ✏️ แก้ไขรายการ · 🎨 ตั้งค่าเว็บ · 📅 การจอง · 🌐 OTA · 👤 บัญชี
//  ตอบกลับด้วย reply (ฟรี ไม่กินโควตาข้อความของ OA)
// =====================================================================
import mongoose from "mongoose";
import LineChat from "../models/LineChat.js";
import LinkCode from "../models/LinkCode.js";
import Hotel from "../models/Hotel.js";
import RoomType from "../models/RoomType.js";
import Service from "../models/Service.js";
import Booking from "../models/Booking.js";
import User from "../models/User.js";
import * as L from "./line.js";
import * as U from "./lineui.js";
import { toDataUrl } from "./images.js";
import { rateFor } from "./pricing.js";
import { STYLE_PRESETS, TEMPLATES, presetByKey, templateByKey, presetOfHotel } from "./presets.js";
import { slugify, SLUG_RE, isSlugFree, normCode, createHotelWithOwner, approveHotel, issueMagic } from "./onboard.js";
import { notifyNewHotel, notifyAdmin } from "./notify.js";
import { linkHotelMenu, unlinkHotelMenu } from "./richmenu.js";
import { baseUrl } from "./baseurl.js";

const { C, q, qText, qRoll, qCam, qDate, qCancel, qMenu, text, flex, bubble, carousel, btn, pb, uri, T, box, row, kv, sep, money } = U;

const FLOW_TTL = 3 * 3600e3;   // ขั้นตอนที่ค้างเกิน 3 ชม. ถือว่าหมดอายุ
const MAX_IMG = 4;             // รูปห้องสูงสุด
const OTAS = [
  { k: "agoda", name: "Agoda" }, { k: "booking", name: "Booking.com" },
  { k: "airbnb", name: "Airbnb" }, { k: "trip", name: "Trip.com" },
];
const CHS = { walkin: "Walk-in", phone: "โทรศัพท์", line: "LINE", agoda: "Agoda", booking: "Booking.com", trip: "Trip.com", other: "อื่น ๆ" };
const UI_TH = { pill: "โค้งมน", soft: "นุ่ม", minimal: "มินิมอล", sharp: "เหลี่ยมคม" };

// ---------------------------------------------------------------- utils
const B = () => baseUrl();
const bookUrl = (h, extra = "") => `${B()}/book.html?h=${encodeURIComponent(h.slug)}${extra}`;
const imgUrl = (kind, id, i = 0, v = "") => `${B()}/api/public/img/${kind}/${id}/${i}?w=line${v ? "&v=" + v : ""}`;
const ver = (d) => new Date((d && d.updatedAt) || Date.now()).getTime();
const isId = (s) => mongoose.isValidObjectId(String(s || ""));
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const thaiDigits = (s) => String(s || "").replace(/[๐-๙]/g, (d) => String("๐๑๒๓๔๕๖๗๘๙".indexOf(d)));
const pad = (n) => String(n).padStart(2, "0");
const TH_M = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const TH_D = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
export const todayTH = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const addDays = (ymd, n) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nightsOf = (a, b) => Math.max(0, Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5));
const thDate = (ymd) => { const d = new Date(ymd + "T00:00:00Z"); return isNaN(d) ? ymd : d.getUTCDate() + " " + TH_M[d.getUTCMonth()]; };
const thDow = (ymd) => TH_D[new Date(ymd + "T00:00:00Z").getUTCDay()] || "";
const mask = (s) => { s = String(s || ""); return s.length > 4 ? "•".repeat(Math.max(0, s.length - 4)) + s.slice(-4) : s; };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseNum(t) {
  const s = thaiDigits(t).replace(/[,\s]/g, "").replace(/บาท|฿|thb/gi, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(parseFloat(s));
}
export function normPhone(t) {
  let s = thaiDigits(t).replace(/[^\d+]/g, "");
  if (s.startsWith("+66")) s = "0" + s.slice(3);
  else if (s.startsWith("66") && s.length === 11) s = "0" + s.slice(2);
  return /^0\d{8,9}$/.test(s) ? s : null;
}
const TH_MONTH_KEYS = {
  มค: 1, มกราคม: 1, กพ: 2, กุมภาพันธ์: 2, มีค: 3, มีนาคม: 3, เมย: 4, เมษายน: 4, พค: 5, พฤษภาคม: 5, มิย: 6, มิถุนายน: 6,
  กค: 7, กรกฎาคม: 7, สค: 8, สิงหาคม: 8, กย: 9, กันยายน: 9, ตค: 10, ตุลาคม: 10, พย: 11, พฤศจิกายน: 11, ธค: 12, ธันวาคม: 12,
};
// "25/10", "25/10/69", "25-10-2026", "2026-10-25", "25 ต.ค.", "25 ตุลาคม 2569" → "YYYY-MM-DD"
export function parseDate(t) {
  const s = thaiDigits(t).trim();
  let d, m, y = 0, mm;
  if ((mm = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) { y = +mm[1]; m = +mm[2]; d = +mm[3]; }
  else if ((mm = /^(\d{1,2})\s*[/.\-]\s*(\d{1,2})(?:\s*[/.\-]\s*(\d{2,4}))?$/.exec(s))) { d = +mm[1]; m = +mm[2]; y = mm[3] ? +mm[3] : 0; }
  else if ((mm = /^(\d{1,2})\s*([ก-๙.\s]+?)\s*(\d{2,4})?$/.exec(s))) { d = +mm[1]; m = TH_MONTH_KEYS[mm[2].replace(/[.\s]/g, "")] || 0; y = mm[3] ? +mm[3] : 0; }
  else return null;
  const today = todayTH();
  const given = !!y;
  if (!y) y = +today.slice(0, 4);
  else if (y < 100) y = y >= 50 ? 2500 + y - 543 : 2000 + y;
  else if (y > 2400) y -= 543;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  let iso = `${y}-${pad(m)}-${pad(d)}`;
  const dt = new Date(iso + "T00:00:00Z");
  if (isNaN(dt) || dt.getUTCDate() !== d) return null;
  if (!given && iso < addDays(today, -7)) iso = `${y + 1}-${pad(m)}-${pad(d)}`;
  return iso;
}

// ---------------------------------------------------------------- state
function makeCtx(ev, chat) {
  return {
    ev, chat, uid: chat.userId, hotel: null, isAdmin: false, out: [],
    say(...m) { for (const x of m.flat()) if (x) this.out.push(x); },
  };
}
async function loadChat(uid) {
  let chat = await LineChat.findOne({ userId: uid }).lean();
  if (!chat) {
    try { await LineChat.create({ userId: uid }); } catch (e) { if (e?.code !== 11000) throw e; }
    chat = await LineChat.findOne({ userId: uid }).lean();
    const p = await L.getProfile(uid);
    if (p && p.displayName) { await LineChat.updateOne({ _id: chat._id }, { $set: { name: p.displayName } }); chat.name = p.displayName; }
  }
  if (!chat.data) chat.data = {};
  if (!chat.hotels) chat.hotels = [];
  return chat;
}
async function setFlow(ctx, flow, step, data) {
  const d = data === undefined ? (ctx.chat.data || {}) : data;
  const flowAt = new Date();
  await LineChat.updateOne({ _id: ctx.chat._id }, { $set: { flow, step, data: d, flowAt } });
  Object.assign(ctx.chat, { flow, step, data: d, flowAt });
}
async function clearFlow(ctx) {
  if (!ctx.chat.flow && !ctx.chat.step) return;
  await LineChat.updateOne({ _id: ctx.chat._id }, { $set: { flow: "", step: "", data: {} } });
  Object.assign(ctx.chat, { flow: "", step: "", data: {} });
}
async function ask(ctx, flow, step, data, ...msgs) { await setFlow(ctx, flow, step, data); ctx.say(...msgs); }
const inFlow = (ctx, flow, steps) => ctx.chat.flow === flow && (Array.isArray(steps) ? steps.includes(ctx.chat.step) : ctx.chat.step === steps);

// ---------------------------------------------------------------- common UI
const mainQuick = () => [
  q("🛏 เพิ่มห้อง", "a=add&t=room", "เพิ่มห้องพัก"), q("💆 เพิ่มกิจกรรม", "a=add&t=svc", "เพิ่มกิจกรรม/บริการ"),
  q("✏️ แก้ไขรายการ", "a=edit", "แก้ไขรายการ"), q("🎨 ตั้งค่าเว็บ", "a=set", "ตั้งค่าเว็บ"),
  q("📅 การจอง", "a=bk", "การจอง"), q("🔗 ดูเว็บ", "a=web", "ดูเว็บของฉัน"),
];
const guestQuick = () => [q("🏨 สมัครที่พัก", "a=reg", "สมัครที่พักกับ Barn Park"), q("🔑 มีรหัสแล้ว", "a=code", "มีรหัสเชื่อมแล้ว"), q("💬 คุยกับทีมงาน", "a=sup", "ขอคุยกับทีมงาน")];
const editQuick = () => [q("✏️ แก้อันอื่น", "a=edit", "แก้ไขรายการ"), q("🔗 ดูเว็บ", "a=web", "ดูเว็บของฉัน"), qMenu()];
const demoBtn = () => btn(uri("👀 ดูตัวอย่างเว็บ", `${B()}/book.html?h=${encodeURIComponent(process.env.DEMO_SLUG || "barnbarn")}`), "secondary");

function welcome() {
  return flex("ยินดีต้อนรับสู่ Barn Park — เว็บจองตรงของที่พักคุณ", bubble({
    tag: "BARN PARK 🌿",
    title: "เว็บจองตรงของที่พักคุณ",
    sub: "สำหรับที่พักชุมชน โฮมสเตย์ และ SME",
    lines: [
      "✅ มีเว็บจองของตัวเอง เลือกหน้าตาได้ 10 แบบ",
      "✅ ใส่ห้อง/กิจกรรม ตั้งค่าเว็บ ผ่าน LINE นี้ได้เลย",
      "✅ รับเงิน PromptPay · แจ้งเตือนเมื่อมีจองใหม่",
    ],
    buttons: [
      btn(pb("🏨 สมัครที่พัก", "a=reg", "สมัครที่พักกับ Barn Park")),
      btn(pb("🔑 มีรหัสเชื่อมแล้ว", "a=code", "มีรหัสเชื่อมแล้ว"), "secondary"),
      demoBtn(),
      btn(pb("💬 คุยกับทีมงาน", "a=sup", "ขอคุยกับทีมงาน"), "link"),
    ],
  }), guestQuick());
}

function hotelMenu(ctx, sub) {
  const h = ctx.hotel;
  return flex("เมนูจัดการ " + h.name, bubble({
    tag: "BARN PARK · จัดการที่พัก", title: h.name, sub: sub || "เลือกสิ่งที่ต้องการทำ 👇",
    footerGrid: true,
    buttons: [
      btn(pb("➕ เพิ่มรายการ", "a=add", "เพิ่มห้อง/กิจกรรม"), "secondary"),
      btn(pb("✏️ แก้ไขรายการ", "a=edit", "แก้ไขรายการ"), "secondary"),
      btn(pb("🎨 ตั้งค่าเว็บ", "a=set", "ตั้งค่าเว็บ"), "secondary"),
      btn(pb("📅 การจอง", "a=bk", "การจอง"), "secondary"),
      btn(pb("🌐 OTA", "a=ota", "OTA"), "secondary"),
      btn(pb("👤 บัญชี", "a=acc", "บัญชี & ช่วยเหลือ"), "secondary"),
      btn(uri("🔗 เปิดดูเว็บของฉัน", bookUrl(h))),
    ],
  }), mainQuick());
}

// ข้อความ "บันทึกแล้ว" + ลิงก์เปิดดูเว็บ (ทุกครั้งที่แก้อะไร)
function saved(ctx, msg, quick) {
  ctx.say(flex(msg, bubble({
    size: "kilo", title: msg, sub: "อัปเดตหน้าเว็บให้แล้ว กดดูได้เลย 👇",
    buttons: [btn(uri("🔗 เปิดดูเว็บ", bookUrl(ctx.hotel)))],
  }), quick || [q("⚙️ ตั้งค่าอื่น", "a=set", "ตั้งค่าเว็บ"), qMenu()]));
}
function stale(ctx) {
  ctx.say(text("ขั้นตอนนี้หมดเวลาหรือเสร็จไปแล้ว — เริ่มใหม่จากเมนูได้เลย", ctx.hotel ? mainQuick() : guestQuick()));
}
function notLinked(ctx) {
  ctx.say(text("เมนูนี้สำหรับที่พักที่เชื่อมกับ Barn Park แล้ว 🔑\nถ้ายังไม่มีบัญชี กด “สมัครที่พัก” · ถ้ามีรหัสเชื่อมแล้ว กด “มีรหัสแล้ว”", guestQuick()));
}

// ================================================================ entry
const seen = new Set();
export async function handleEvents(events) {
  for (const ev of events || []) {
    const id = ev.webhookEventId;
    if (id) { if (seen.has(id)) continue; seen.add(id); if (seen.size > 1000) seen.delete(seen.values().next().value); }
    try { await handleEvent(ev); } catch (e) { console.error("linebot event", e); }
  }
}

export async function handleEvent(ev) {
  if (!ev || !ev.type) return;
  const src = ev.source || {};
  if (src.type !== "user" || !src.userId) return handleGroup(ev);
  if (ev.type === "unfollow") return;
  const chat = await loadChat(src.userId);
  const ctx = makeCtx(ev, chat);
  ctx.isAdmin = !!process.env.ADMIN_LINE_TO && src.userId === process.env.ADMIN_LINE_TO;
  if (chat.hotel) {
    ctx.hotel = await Hotel.findById(chat.hotel).lean();
    if (!ctx.hotel) await detachHotel(ctx, chat.hotel);
  }
  if (chat.flow && (!chat.flowAt || Date.now() - new Date(chat.flowAt).getTime() > FLOW_TTL)) await clearFlow(ctx);
  try {
    if (ev.type === "follow") await onFollow(ctx);
    else if (ev.type === "message") {
      const m = ev.message || {};
      if (m.type === "text") await onText(ctx, String(m.text || "").trim());
      else if (m.type === "image") await onImage(ctx, m);
      else await onOther(ctx, m);
    } else if (ev.type === "postback") {
      await onPostback(ctx, Object.fromEntries(new URLSearchParams(ev.postback?.data || "")), ev.postback?.params || {});
    }
  } catch (e) {
    console.error("linebot", e);
    ctx.out = [text("ขออภัย ระบบขัดข้องชั่วคราว 🙏 ลองใหม่อีกครั้ง หรือพิมพ์ “เมนู”", ctx.hotel ? mainQuick() : guestQuick())];
  }
  if (ctx.out.length && ev.replyToken) {
    await L.reply(ev.replyToken, ctx.out).catch((e) => console.error("line reply", e.message));
  }
}

async function handleGroup(ev) {
  const gid = ev.source?.groupId || ev.source?.roomId || "";
  if (ev.type === "message" && ev.message?.type === "text" && /^(id|groupid|ไอดี)$/i.test(String(ev.message.text || "").trim())) {
    return L.reply(ev.replyToken, [text("groupId ของกลุ่มนี้:\n" + gid)]).catch(() => {});
  }
  // กลุ่มแอดมิน (ADMIN_LINE_TO เป็น groupId) กดอนุมัติได้
  if (ev.type === "postback" && gid && gid === process.env.ADMIN_LINE_TO) {
    const p = Object.fromEntries(new URLSearchParams(ev.postback?.data || ""));
    if (p.a === "ap") {
      const ctx = makeCtx(ev, { userId: ev.source.userId || gid, data: {}, hotels: [] });
      ctx.isAdmin = true;
      await aAdminApprove(ctx, p).catch((e) => ctx.say(text("อนุมัติไม่สำเร็จ: " + e.message)));
      if (ctx.out.length) await L.reply(ev.replyToken, ctx.out).catch(() => {});
    }
  }
}

async function onFollow(ctx) {
  if (ctx.hotel) { await linkHotelMenu(ctx.uid); return ctx.say(hotelMenu(ctx, "ยินดีต้อนรับกลับ 👋")); }
  ctx.say(welcome());
}

async function onOther(ctx, m) {
  if (m.type === "sticker") return ctx.hotel ? ctx.say(text("😊 กดเมนูด้านล่างได้เลย", mainQuick())) : null;
  if (ctx.chat.flow) return ctx.say(text("ตอบเป็นข้อความหรือกดปุ่มด้านล่างนะ", [qCancel()]));
}

// ================================================================ routing
const ACTIONS = {
  menu: aMenu, x: aCancel, about: aAbout, sup: aSupport, web: aWeb,
  reg: aReg, code: aCode,
  add: aAdd, edit: aEdit, ef: aEditField, di: aDelImage, am: aAmen,
  set: aSet, st: aSetSave, magic: aMagic,
  bk: aBookings, bp: aMarkPaid, nb: aNewBooking,
  ota: aOta, acc: aAccount, sw: aSwitch, unlink: aUnlink, share: aShare,
  ap: aAdminApprove, adm: aAdminPending,
};
const NEEDS_HOTEL = new Set(["web", "add", "edit", "ef", "di", "am", "set", "st", "magic", "bk", "bp", "nb", "ota", "acc", "sw", "unlink", "share"]);
// ปุ่มที่ "เริ่มเรื่องใหม่" → ล้างขั้นตอนที่ค้างก่อน (ยกเว้นปุ่มที่ทำต่อในขั้นตอนเดิม ซึ่งมี s=)
const ENTRY = new Set(["menu", "about", "sup", "web", "edit", "set", "bk", "ota", "acc", "magic", "share", "sw", "unlink", "adm", "code", "reg", "add", "nb"]);

async function onPostback(ctx, p, params) {
  const fn = ACTIONS[p.a];
  if (!fn) return aMenu(ctx);
  if ((p.a === "ap" || p.a === "adm") && !ctx.isAdmin) return ctx.say(text("คำสั่งนี้สำหรับแอดมิน Barn Park เท่านั้น"));
  if (NEEDS_HOTEL.has(p.a) && !ctx.hotel) return notLinked(ctx);
  if (ENTRY.has(p.a) && !p.s) await clearFlow(ctx);
  return fn(ctx, p, params);
}

const FLOW_TEXT = { reg: regText, code: codeText, add: addText, ef: editText, set: setText, nb: nbText, ota: otaText };
const KEYWORDS = [
  [/^(สมัคร|ลงทะเบียน|register)/i, (c) => aReg(c, {})],
  [/^(มีรหัส|ใส่รหัส|รหัส|เชื่อม)/i, (c) => aCode(c, {})],
  [/^เพิ่มห้อง/, (c) => (c.hotel ? aAdd(c, { t: "room" }) : notLinked(c))],
  [/^(เพิ่มกิจกรรม|เพิ่มบริการ)/, (c) => (c.hotel ? aAdd(c, { t: "svc" }) : notLinked(c))],
  [/^เพิ่ม/, (c) => (c.hotel ? aAdd(c, {}) : notLinked(c))],
  [/^(แก้ไข|แก้|รายการ)/, (c) => (c.hotel ? aEdit(c, {}) : notLinked(c))],
  [/^(ตั้งค่า|setting)/i, (c) => (c.hotel ? aSet(c, {}) : notLinked(c))],
  [/^(การจอง|จอง|booking)/i, (c) => (c.hotel ? aBookings(c, {}) : notLinked(c))],
  [/^ota/i, (c) => (c.hotel ? aOta(c, {}) : notLinked(c))],
  [/^(บัญชี|account)/i, (c) => (c.hotel ? aAccount(c, {}) : notLinked(c))],
  [/^(ดูเว็บ|เว็บ|ลิงก์|link)/i, (c) => (c.hotel ? aWeb(c, {}) : notLinked(c))],
  [/^(ติดต่อ|ทีมงาน|คุยกับ|ขอคุย)/, (c) => aSupport(c, {})],
];

async function onText(ctx, t) {
  if (!t) return;
  if (/^(ยกเลิก|cancel|stop|ออก)$/i.test(t)) return aCancel(ctx);
  if (/^(เมนู|menu|help|ช่วยเหลือ|\?|เริ่ม|start)$/i.test(t)) { await clearFlow(ctx); return aMenu(ctx); }
  if (/^(id|userid|user id|ไอดี)$/i.test(t)) return ctx.say(text("userId ของคุณคือ:\n" + ctx.uid));
  if (ctx.isAdmin && /^(แอดมิน|admin|รออนุมัติ)$/i.test(t)) { await clearFlow(ctx); return aAdminPending(ctx); }
  const link = /^(?:เชื่อม|รหัส|code)\s*:?\s*([A-Za-z0-9]{3}[\s-]?[A-Za-z0-9]{3})$/i.exec(t);
  if (link) { await clearFlow(ctx); return redeem(ctx, link[1]); }
  if (ctx.chat.flow && FLOW_TEXT[ctx.chat.flow]) return FLOW_TEXT[ctx.chat.flow](ctx, t);
  for (const [re, fn] of KEYWORDS) if (re.test(t)) return fn(ctx);
  // พิมพ์รหัสมาเฉย ๆ (เช่น K7P-4QX) ตอนยังไม่เชื่อม
  if (!ctx.hotel && (/^[A-Za-z0-9]{3}-[A-Za-z0-9]{3}$/.test(t) || (/^[A-Za-z0-9]{6}$/.test(t) && /\d/.test(t)))) return redeem(ctx, t);
  return idleFallback(ctx);
}

// ข้อความทั่วไป: ถ้าอยู่โหมดคุยกับทีมงาน → บอทเงียบ / ไม่งั้นแนะนำเมนู (ไม่ตอบรัว)
async function idleFallback(ctx) {
  const now = Date.now();
  if (ctx.chat.supportUntil && new Date(ctx.chat.supportUntil).getTime() > now) return;
  const last = ctx.chat.lastNudgeAt ? new Date(ctx.chat.lastNudgeAt).getTime() : 0;
  if (now - last < (ctx.hotel ? 10 * 60e3 : 6 * 3600e3)) return;
  await LineChat.updateOne({ _id: ctx.chat._id }, { $set: { lastNudgeAt: new Date() } });
  if (ctx.hotel) {
    return ctx.say(text("ใช้เมนูด้านล่างได้เลย 👇 หรือพิมพ์ เช่น “เพิ่มห้อง” “ตั้งค่า” “การจอง”\nถ้าอยากคุยกับทีมงาน กด 💬 คุยกับทีมงาน", [...mainQuick(), q("💬 คุยกับทีมงาน", "a=sup", "ขอคุยกับทีมงาน")]));
  }
  return ctx.say(text("ได้รับข้อความแล้ว 🙏 ทีมงาน Barn Park จะตอบกลับโดยเร็ว\n\nถ้าคุณเป็นเจ้าของที่พักและอยากมีเว็บจองของตัวเอง กด “สมัครที่พัก” ได้เลย", guestQuick()));
}

// ================================================================ simple actions
async function aMenu(ctx) { ctx.say(ctx.hotel ? hotelMenu(ctx) : welcome()); }
async function aCancel(ctx) {
  await clearFlow(ctx);
  ctx.say(text("ยกเลิกแล้ว 👌", ctx.hotel ? mainQuick() : guestQuick()));
}
async function aAbout(ctx) {
  if (ctx.hotel) return aMenu(ctx);
  ctx.say(flex("Barn Park คืออะไร", bubble({
    tag: "BARN PARK 🌿", title: "Barn Park คืออะไร?",
    sub: "แพลตฟอร์มเว็บจองตรง ให้ที่พักชุมชนและ SME มีเว็บของตัวเอง",
    lines: [
      "🏡 เว็บจองห้อง + กิจกรรม เลือกหน้าตาได้ 10 แบบ",
      "💳 แขกจ่ายผ่าน PromptPay QR ได้ทันที",
      "🔔 แจ้งเตือนจองใหม่ + สรุปเข้า-ออกรายวัน",
      "📱 จัดการทุกอย่างผ่าน LINE นี้ ไม่ต้องเปิดคอม",
    ],
    buttons: [btn(pb("🏨 สมัครเลย", "a=reg", "สมัครที่พักกับ Barn Park")), demoBtn()],
  }), guestQuick()));
}
async function aWeb(ctx) {
  const h = ctx.hotel;
  ctx.say(flex("เว็บของ " + h.name, bubble({
    tag: "🔗 เว็บจองของคุณ", title: h.name, sub: bookUrl(h).replace(/^https?:\/\//, ""),
    lines: [h.approved === false ? T("⏳ ยังรออนุมัติ — แขกยังจองไม่ได้", { size: "xs", color: C.amber, margin: "md" }) : null],
    buttons: [btn(uri("🔗 เปิดดูเว็บ", bookUrl(h))), btn(pb("📤 ลิงก์+QR ให้ลูกค้า", "a=share", "ขอลิงก์จองให้ลูกค้า"), "secondary")],
  }), mainQuick()));
}
async function aSupport(ctx) {
  const active = ctx.chat.supportUntil && new Date(ctx.chat.supportUntil).getTime() > Date.now();
  await LineChat.updateOne({ _id: ctx.chat._id }, { $set: { supportUntil: new Date(Date.now() + 30 * 60e3) } });
  await clearFlow(ctx);
  ctx.say(text("💬 พิมพ์ข้อความถึงทีมงาน Barn Park ได้เลย ทีมงานจะตอบในแชทนี้\n(30 นาทีนี้บอทจะเงียบ ให้คุยกับคนได้สะดวก — กดเมนูเมื่อไหร่ก็กลับมาใช้ได้)", ctx.hotel ? [qMenu()] : []));
  if (!active && !ctx.isAdmin) {
    notifyAdmin("💬 มีคนขอคุยกับทีมงานใน LINE Barn Park", [
      "ชื่อ LINE: " + (ctx.chat.name || "-"),
      ctx.hotel ? "ที่พัก: " + ctx.hotel.name : "ยังไม่ได้เชื่อมที่พัก",
      "ตอบได้ที่แอป LINE Official Account → แชท",
    ]).catch(() => {});
  }
}

// ================================================================ สมัคร
const regSlugQuick = (sugs = []) => [
  ...sugs.filter(Boolean).slice(0, 3).map((s) => q("ใช้ " + s, "a=reg&s=slugsug&v=" + encodeURIComponent(s), "ใช้ชื่อลิงก์ " + s)),
  q("🎲 ให้ระบบตั้งให้", "a=reg&s=slugauto", "ให้ระบบตั้งชื่อลิงก์ให้"), qCancel(),
];
async function askReg(ctx, step, d, prefix = "") {
  const P = (s) => (prefix ? prefix + "\n\n" : "") + s;
  switch (step) {
    case "name":
      return ask(ctx, "reg", "name", d, text(P("1/6 · ชื่อที่พักของคุณคืออะไร?\n(เช่น บ้าน-บ้าน สุขพอดี)"), [qCancel()]));
    case "slug": {
      const sug = slugify(d.name);
      const sugs = SLUG_RE.test(sug) && (await isSlugFree(sug)) ? [sug] : [];
      return ask(ctx, "reg", "slug", d, text(P(`2/6 · ตั้งชื่อลิงก์เว็บ (ภาษาอังกฤษ a-z, 0-9, -)\nเว็บของคุณจะเป็น:\n${B()}/book.html?h=ชื่อนี้\n\nเช่น baanbaan, suanphung-stay`), regSlugQuick(sugs)));
    }
    case "contact":
      return ask(ctx, "reg", "contact", d, text(P("3/6 · ชื่อผู้ติดต่อ (เจ้าของหรือผู้จัดการ)"), [ctx.chat.name ? q("ใช้ชื่อ LINE", "a=reg&s=linename", "ใช้ชื่อ " + ctx.chat.name) : null, qCancel()]));
    case "phone":
      return ask(ctx, "reg", "phone", d, text(P("4/6 · เบอร์โทรติดต่อ"), [qCancel()]));
    case "email":
      return ask(ctx, "reg", "email", d, text(P("5/6 · อีเมล (ใช้รับแจ้งเตือนการจอง และเข้าเว็บหลังบ้าน)"), [qCancel()]));
    case "loc":
      return ask(ctx, "reg", "loc", d, text(P("6/6 · ที่พักอยู่จังหวัดอะไร? (พิมพ์ได้เลย เช่น กาญจนบุรี)"), [qCancel()]));
    case "confirm":
      await setFlow(ctx, "reg", "confirm", d);
      return ctx.say(flex("ตรวจข้อมูลก่อนส่งใบสมัคร", bubble({
        tag: "ตรวจข้อมูลก่อนส่ง ✍️", title: d.name,
        lines: [
          kv("ลิงก์เว็บ", d.slug ? "?h=" + d.slug : "ให้ระบบตั้งให้"),
          kv("ผู้ติดต่อ", d.contact), kv("เบอร์โทร", d.phone), kv("อีเมล", d.email), kv("จังหวัด", d.loc),
        ],
        buttons: [
          btn(pb("✅ ส่งใบสมัคร", "a=reg&s=submit", "ส่งใบสมัคร")),
          btn(pb("✏️ กรอกใหม่", "a=reg&s=go", "กรอกใหม่"), "secondary"),
          btn(pb("ยกเลิก", "a=x", "ยกเลิก"), "link"),
        ],
      }), [q("✅ ส่งใบสมัคร", "a=reg&s=submit", "ส่งใบสมัคร"), qCancel()]));
  }
}

async function aReg(ctx, p = {}) {
  const d = { ...(ctx.chat.data || {}) };
  if (p.s === "go") return askReg(ctx, "name", {});
  if (p.s === "slugauto") { if (!inFlow(ctx, "reg", "slug")) return stale(ctx); d.slug = ""; return askReg(ctx, "contact", d); }
  if (p.s === "slugsug") { if (!inFlow(ctx, "reg", "slug")) return stale(ctx); return regText(ctx, decodeURIComponent(p.v || "")); }
  if (p.s === "linename") { if (!inFlow(ctx, "reg", "contact")) return stale(ctx); return regText(ctx, ctx.chat.name || ""); }
  if (p.s === "submit") return regSubmit(ctx);
  if (p.s) return stale(ctx);
  // เริ่มสมัคร
  if (ctx.hotel && p.f !== "1") {
    return ctx.say(text(`LINE นี้เชื่อมกับ “${ctx.hotel.name}” อยู่แล้ว ✅\nถ้าจะสมัครที่พักแห่งใหม่ กด “สมัครแห่งใหม่”`, [q("➕ สมัครแห่งใหม่", "a=reg&f=1", "สมัครที่พักแห่งใหม่"), qMenu()]));
  }
  if (ctx.chat.pendingHotel) {
    const ph = await Hotel.findById(ctx.chat.pendingHotel).lean();
    if (ph && ph.approved === false) {
      return ctx.say(text(`ใบสมัคร “${ph.name}” กำลังรอทีมงานตรวจ ⏳\nเมื่ออนุมัติ “รหัสเชื่อม” จะส่งมาที่แชทนี้`, [q("💬 คุยกับทีมงาน", "a=sup", "ขอคุยกับทีมงาน")]));
    }
  }
  ctx.say(flex("สมัครที่พักกับ Barn Park", bubble({
    tag: "BARN PARK · สมัครที่พัก", title: "สมัครใช้เวลา ~2 นาที", sub: "ตอบ 6 คำถามสั้น ๆ ในแชทนี้",
    lines: [
      "1) ชื่อที่พัก  2) ชื่อลิงก์เว็บ  3) ผู้ติดต่อ",
      "4) เบอร์โทร  5) อีเมล  6) จังหวัด",
      T("ทีมงานตรวจภายใน 1 วันทำการ แล้วส่ง “รหัสเชื่อม” มาในแชทนี้ · ข้อมูลใช้เพื่อเปิดบัญชีและติดต่อกลับเท่านั้น", { size: "xs", color: C.muted, margin: "md" }),
    ],
    buttons: [
      btn(pb("✅ ยอมรับ เริ่มสมัคร", "a=reg&s=go", "ยอมรับและเริ่มสมัคร")),
      btn(uri("📄 อ่านนโยบายข้อมูล", B() + "/privacy.html"), "link"),
    ],
  }), [q("✅ เริ่มสมัคร", "a=reg&s=go", "เริ่มสมัคร"), qCancel()]));
}

async function regText(ctx, t) {
  const d = { ...(ctx.chat.data || {}) };
  switch (ctx.chat.step) {
    case "name":
      if (t.length < 2 || t.length > 80) return ctx.say(text("ชื่อยาว 2–80 ตัวอักษร ลองพิมพ์ใหม่อีกครั้ง", [qCancel()]));
      d.name = t; return askReg(ctx, "slug", d);
    case "slug": {
      const s = slugify(t);
      if (!SLUG_RE.test(s)) return ctx.say(text("ใช้ตัวอักษร a-z, ตัวเลข หรือ - ยาว 3–30 ตัว เช่น baanbaan", regSlugQuick()));
      if (!(await isSlugFree(s))) {
        const alts = [];
        for (const a of [s + "-stay", s + "-home", s + "-" + (new Date().getFullYear() % 100)]) if (SLUG_RE.test(a) && (await isSlugFree(a))) alts.push(a);
        return ctx.say(text(`“${s}” มีที่พักอื่นใช้แล้ว ลองชื่ออื่น หรือเลือกด้านล่าง`, regSlugQuick(alts)));
      }
      d.slug = s; return askReg(ctx, "contact", d);
    }
    case "contact":
      if (t.length < 2 || t.length > 60) return ctx.say(text("ชื่อยาว 2–60 ตัวอักษร", [qCancel()]));
      d.contact = t; return askReg(ctx, "phone", d);
    case "phone": {
      const ph = normPhone(t);
      if (!ph) return ctx.say(text("เบอร์ไม่ถูกต้อง ลองใหม่ เช่น 0812345678", [qCancel()]));
      d.phone = ph; return askReg(ctx, "email", d);
    }
    case "email": {
      const em = t.toLowerCase().trim();
      if (!EMAIL_RE.test(em)) return ctx.say(text("อีเมลไม่ถูกต้อง ลองใหม่ เช่น name@gmail.com", [qCancel()]));
      if (await User.exists({ email: em })) {
        return ctx.say(text("อีเมลนี้มีบัญชี Barn Park แล้ว\n• ถ้าเป็นของคุณ: เข้าเว็บหลังบ้าน → ⚙️ ตั้งค่า → “เชื่อม LINE Barn Park” เพื่อรับรหัส\n• หรือพิมพ์อีเมลอื่น", [qCancel()]));
      }
      d.email = em; return askReg(ctx, "loc", d);
    }
    case "loc":
      if (t.length < 2 || t.length > 60) return ctx.say(text("พิมพ์ชื่อจังหวัด เช่น เชียงใหม่", [qCancel()]));
      d.loc = t; return askReg(ctx, "confirm", d);
    case "confirm":
      return ctx.say(text("กด “✅ ส่งใบสมัคร” เพื่อส่ง หรือ “ยกเลิก”", [q("✅ ส่งใบสมัคร", "a=reg&s=submit", "ส่งใบสมัคร"), qCancel()]));
    default:
      return stale(ctx);
  }
}

async function regSubmit(ctx) {
  const claimed = await LineChat.findOneAndUpdate({ _id: ctx.chat._id, flow: "reg", step: "confirm" }, { $set: { step: "saving" } }).lean();
  if (!claimed) return stale(ctx);
  const d = claimed.data || {};
  let hotel, owner;
  try {
    ({ hotel, owner } = await createHotelWithOwner({ name: d.name, slug: d.slug || "", location: d.loc, phone: d.phone, email: d.email, contactName: d.contact }));
  } catch (e) {
    if (e.code === "EMAIL_TAKEN") return askReg(ctx, "email", d, "อีเมลนี้มีบัญชีแล้ว — ใช้อีเมลอื่นนะ");
    await setFlow(ctx, "reg", "confirm", d);
    throw e;
  }
  await LineChat.updateOne({ _id: ctx.chat._id }, { $set: { pendingHotel: hotel._id, flow: "", step: "", data: {} } });
  Object.assign(ctx.chat, { pendingHotel: hotel._id, flow: "", step: "", data: {} });
  notifyNewHotel(hotel, owner.email, { via: "LINE", contact: d.contact, phone: d.phone }).catch((e) => console.error("notifyNewHotel", e.message));
  ctx.say(flex("ส่งใบสมัครแล้ว — รอทีมงานอนุมัติ", bubble({
    tag: "BARN PARK · ส่งใบสมัครแล้ว 📨", title: hotel.name, sub: "ขอบคุณที่สมัคร! ทีมงานจะตรวจภายใน 1 วันทำการ",
    lines: ["เมื่ออนุมัติ คุณจะได้ “รหัสเชื่อม” ในแชทนี้", "จากนั้นเพิ่มห้อง/กิจกรรม และตั้งค่าเว็บได้ทันที"],
    buttons: [demoBtn(), btn(pb("💬 คุยกับทีมงาน", "a=sup", "ขอคุยกับทีมงาน"), "link")],
  })));
}

// ================================================================ รหัสเชื่อม
async function aCode(ctx, p = {}) {
  if (p.c) return redeem(ctx, p.c);
  if (await codeLocked(ctx)) return;
  return ask(ctx, "code", "enter", {}, text("🔑 พิมพ์รหัสเชื่อม 6 ตัว (เช่น K7P-4QX)\n\nรับรหัสได้จาก:\n• ข้อความ “อนุมัติแล้ว” จากทีมงาน\n• เว็บหลังบ้าน → ⚙️ ตั้งค่า → เชื่อม LINE Barn Park", [qCancel()]));
}
async function codeText(ctx, t) { return redeem(ctx, t); }
async function codeLocked(ctx) {
  const until = ctx.chat.codeLockUntil ? new Date(ctx.chat.codeLockUntil).getTime() : 0;
  if (until > Date.now()) {
    ctx.say(text(`ใส่รหัสผิดหลายครั้ง ลองใหม่ได้ในอีก ${Math.ceil((until - Date.now()) / 60e3)} นาที 🙏`));
    return true;
  }
  return false;
}
async function redeem(ctx, raw) {
  if (await codeLocked(ctx)) return;
  const code = normCode(raw);
  if (code.length !== 6) return ctx.say(text("รหัสต้องมี 6 ตัว (ตัวอักษร + ตัวเลข) ลองพิมพ์ใหม่", [qCancel()]));
  const lc = await LinkCode.findOne({ code, purpose: "link", usedAt: null, expiresAt: { $gt: new Date() } }).lean();
  if (!lc) {
    const tries = (ctx.chat.codeTries || 0) + 1;
    const set = tries >= 5 ? { codeTries: 0, codeLockUntil: new Date(Date.now() + 30 * 60e3) } : { codeTries: tries };
    await LineChat.updateOne({ _id: ctx.chat._id }, { $set: set });
    return ctx.say(text(tries >= 5
      ? "รหัสไม่ถูกต้องเกิน 5 ครั้ง — พักไว้ 30 นาทีเพื่อความปลอดภัย"
      : `รหัสไม่ถูกต้อง หรือหมดอายุ/ถูกใช้ไปแล้ว (ลองได้อีก ${5 - tries} ครั้ง)`, [qCancel()]));
  }
  const h = await Hotel.findById(lc.hotel).lean();
  if (!h) return ctx.say(text("ไม่พบที่พักของรหัสนี้ กรุณาติดต่อทีมงาน", [q("💬 คุยกับทีมงาน", "a=sup", "ขอคุยกับทีมงาน")]));
  if (h.approved === false) return ctx.say(text(`“${h.name}” ยังรอการอนุมัติ — อนุมัติแล้วจึงใช้รหัสได้`));
  const used = await LinkCode.findOneAndUpdate({ _id: lc._id, usedAt: null }, { $set: { usedAt: new Date(), usedBy: ctx.uid } });
  if (!used) return ctx.say(text("รหัสนี้เพิ่งถูกใช้ไปแล้ว"));
  const set = { hotel: h._id, codeTries: 0, flow: "", step: "", data: {} };
  if (lc.user) set.user = lc.user;
  const upd = { $set: set, $addToSet: { hotels: h._id } };
  if (ctx.chat.pendingHotel && String(ctx.chat.pendingHotel) === String(h._id)) upd.$unset = { pendingHotel: 1 };
  await LineChat.updateOne({ _id: ctx.chat._id }, upd);
  Object.assign(ctx.chat, set);
  if (!ctx.chat.hotels.map(String).includes(String(h._id))) ctx.chat.hotels.push(h._id);
  ctx.hotel = h;
  await linkHotelMenu(ctx.uid);
  ctx.say(flex("เชื่อมสำเร็จ! จัดการ " + h.name + " ผ่าน LINE ได้แล้ว", bubble({
    tag: "BARN PARK · เชื่อมสำเร็จ ✅", title: h.name, sub: "ตอนนี้จัดการที่พักผ่าน LINE ได้แล้ว",
    lines: [
      "เมนูด้านล่างเปลี่ยนเป็น “เมนูจัดการที่พัก” แล้ว 👇",
      T("➕ เพิ่มห้อง/กิจกรรม — ขึ้นเว็บใน 1 นาที\n✏️ แก้ไขรายการ — ราคา จำนวน รูป\n🎨 ตั้งค่าเว็บ — หน้าตา สี รับเงิน\n📅 การจอง — ดูคนเข้าพัก ยืนยันรับเงิน\n🌐 OTA — ขอเชื่อม Agoda / Booking.com", { size: "sm", color: C.navy, margin: "md" }),
    ],
    buttons: [btn(pb("➕ เริ่มเพิ่มห้องแรก", "a=add&t=room", "เพิ่มห้องพัก")), btn(uri("🔗 เปิดดูเว็บของฉัน", bookUrl(h)), "secondary")],
  }), mainQuick()));
}

// ================================================================ เพิ่มห้อง / กิจกรรม
const photoQuickAdd = () => [qRoll(), qCam(), q("✅ เสร็จ", "a=add&s=photosdone", "เสร็จ"), qCancel()];
const ROOM_STEPS = {
  name: () => text("🛏 1/7 · ชื่อห้อง?\n(เช่น ห้องริมน้ำ, Deluxe วิวภูเขา)", [qCancel()]),
  price: (d) => text(`💰 2/7 · ราคาต่อคืนของ “${d.name}” (บาท)\nพิมพ์ตัวเลข เช่น 1200`, [qText("฿800", "800"), qText("฿1,000", "1000"), qText("฿1,500", "1500"), qText("฿2,000", "2000"), qCancel()]),
  qty: () => text("🔢 3/7 · มีห้องแบบนี้กี่ห้อง?", ["1", "2", "3", "4", "5", "6"].map((n) => qText(n + " ห้อง", n)).concat(qCancel())),
  cap: () => text("👥 4/7 · พักได้กี่คนต่อห้อง?", ["1", "2", "3", "4", "6"].map((n) => qText(n + " คน", n)).concat(qCancel())),
  amen: (d) => amenMsg("room", d.amen || [], "✨ 5/7 · ห้องนี้มีอะไรบ้าง?"),
  desc: () => text("📝 6/7 · คำอธิบายสั้น ๆ\n(เช่น เตียงคิงไซซ์ ระเบียงวิวภูเขา)", [q("⏭ ข้าม", "a=add&s=skipdesc", "ข้าม"), qCancel()]),
  photos: () => text(`📷 7/7 · ส่งรูปห้องได้สูงสุด ${MAX_IMG} รูป\nกด “🖼 เลือกรูป” แล้วเลือกหลายรูปพร้อมกันได้\nส่งครบแล้วกด “✅ เสร็จ”`, [qRoll(), qCam(), q("✅ เสร็จ", "a=add&s=photosdone", "เสร็จ"), q("⏭ ไม่ใส่รูป", "a=add&s=photosdone", "ไม่ใส่รูป"), qCancel()]),
};
const SVC_STEPS = {
  name: () => text("💆 1/4 · ชื่อกิจกรรม/บริการ?\n(เช่น นวดแผนไทย 60 นาที, อาหารเช้า, ทัวร์สวน)", [qCancel()]),
  price: (d) => text(`💰 2/4 · ราคา “${d.name}” (บาท)\nถ้าฟรีพิมพ์ 0`, [qText("ฟรี", "0"), qText("฿150", "150"), qText("฿300", "300"), qText("฿500", "500"), qCancel()]),
  desc: () => text("📝 3/4 · รายละเอียดสั้น ๆ\n(เช่น 60 นาที ต่อท่าน / เสิร์ฟ 7:00–10:00)", [q("⏭ ข้าม", "a=add&s=skipdesc", "ข้าม"), qCancel()]),
  photo: () => text("📷 4/4 · ส่งรูป 1 รูป", [qRoll(), qCam(), q("⏭ ไม่ใส่รูป", "a=add&s=photosdone", "ไม่ใส่รูป"), qCancel()]),
};
const askAdd = (ctx, step, d) => ask(ctx, "add", step, d, (d.t === "room" ? ROOM_STEPS : SVC_STEPS)[step](d));

async function aAdd(ctx, p = {}) {
  if (p.s) {
    const d = { ...(ctx.chat.data || {}) };
    if (p.s === "save") return addSave(ctx);
    if (p.s === "skipdesc") { if (!inFlow(ctx, "add", "desc")) return stale(ctx); d.desc = ""; return askAdd(ctx, d.t === "room" ? "photos" : "photo", d); }
    if (p.s === "photosdone") { if (!inFlow(ctx, "add", ["photos", "photo"])) return stale(ctx); return addConfirm(ctx); }
    return stale(ctx);
  }
  if (p.t === "room") return askAdd(ctx, "name", { t: "room", images: [] });
  if (p.t === "svc") return askAdd(ctx, "name", { t: "svc" });
  ctx.say(flex("จะเพิ่มอะไรขึ้นเว็บ?", bubble({
    tag: "BARN PARK · เพิ่มรายการ", title: "จะเพิ่มอะไรขึ้นเว็บ?", sub: "ตอบทีละคำถาม เสร็จแล้วขึ้นเว็บทันที",
    buttons: [
      btn(pb("🛏 ห้องพัก", "a=add&t=room", "เพิ่มห้องพัก")),
      btn(pb("💆 กิจกรรม / บริการ", "a=add&t=svc", "เพิ่มกิจกรรม/บริการ")),
      T("เช่น นวด สปา อาหารเช้า ทัวร์ ปั่นจักรยาน", { size: "xs", color: C.muted, align: "center", margin: "sm" }),
    ],
  }), [q("🛏 ห้องพัก", "a=add&t=room", "เพิ่มห้องพัก"), q("💆 กิจกรรม", "a=add&t=svc", "เพิ่มกิจกรรม/บริการ"), qCancel()]));
}

async function addText(ctx, t) {
  const d = { ...(ctx.chat.data || {}) };
  const room = d.t === "room";
  switch (ctx.chat.step) {
    case "name":
      if (t.length > 60) return ctx.say(text("ชื่อยาวไม่เกิน 60 ตัวอักษร ลองใหม่", [qCancel()]));
      d.name = t; return askAdd(ctx, "price", d);
    case "price": {
      const n = parseNum(t);
      if (n == null || n > 500000) return ctx.say(text("พิมพ์เป็นตัวเลข เช่น 1200", [qCancel()]));
      if (room && n <= 0) return ctx.say(text("ราคาห้องต้องมากกว่า 0", [qCancel()]));
      d.price = n; return askAdd(ctx, room ? "qty" : "desc", d);
    }
    case "qty": {
      const n = parseNum(t);
      if (!n || n < 1 || n > 200) return ctx.say(text("พิมพ์จำนวนห้อง 1–200", [qCancel()]));
      d.qty = n; return askAdd(ctx, "cap", d);
    }
    case "cap": {
      const n = parseNum(t);
      if (!n || n < 1 || n > 30) return ctx.say(text("พิมพ์จำนวนคน 1–30", [qCancel()]));
      d.cap = n; return askAdd(ctx, "amen", { ...d, amen: d.amen || [] });
    }
    case "amen":
      return amenText(ctx, t);
    case "desc":
      d.desc = t.slice(0, 300); return askAdd(ctx, room ? "photos" : "photo", d);
    case "photos":
    case "photo":
      if (/^(เสร็จ|ข้าม|done|ok|โอเค|ไม่ใส่)/i.test(t)) return addConfirm(ctx);
      return ctx.say(text("ส่งเป็น “รูป” ได้เลย 📷 หรือกด ✅ เสร็จ", room ? photoQuickAdd() : SVC_STEPS.photo().quickReply.items));
    case "confirm":
      if (/^(ใช่|ok|โอเค|บันทึก|ยืนยัน|ขึ้นเว็บ)/i.test(t)) return addSave(ctx);
      return ctx.say(text("กด “✅ ขึ้นเว็บเลย” เพื่อบันทึก หรือ “ยกเลิก”", [q("✅ ขึ้นเว็บเลย", "a=add&s=save", "ขึ้นเว็บเลย"), qCancel()]));
    default:
      return stale(ctx);
  }
}

async function addConfirm(ctx) {
  const d = { ...(ctx.chat.data || {}) };
  const room = d.t === "room";
  await setFlow(ctx, "add", "confirm", d);
  const lines = room
    ? [kv("ราคา/คืน", money(d.price)), kv("จำนวนห้อง", d.qty + " ห้อง"), kv("พักได้", d.cap + " คน/ห้อง"), kv("รูป", (d.images || []).length + " รูป"), (d.amen || []).length ? T("✨ " + d.amen.join(" · "), { size: "sm", color: C.teal, margin: "md" }) : null]
    : [kv("ราคา", d.price ? money(d.price) : "ฟรี"), kv("รูป", d.image ? "1 รูป" : "ไม่มี")];
  if (d.desc) lines.push(T(d.desc, { size: "sm", color: C.muted, margin: "md" }));
  ctx.say(flex("ตรวจก่อนขึ้นเว็บ: " + d.name, bubble({
    tag: "ตรวจก่อนขึ้นเว็บ 👀", title: (room ? "🛏 " : "💆 ") + d.name, lines,
    buttons: [
      btn(pb("✅ ขึ้นเว็บเลย", "a=add&s=save", "ขึ้นเว็บเลย")),
      btn(pb("🔄 เริ่มใหม่", room ? "a=add&t=room" : "a=add&t=svc", "เริ่มใหม่"), "secondary"),
      btn(pb("ยกเลิก", "a=x", "ยกเลิก"), "link"),
    ],
  }), [q("✅ ขึ้นเว็บเลย", "a=add&s=save", "ขึ้นเว็บเลย"), qCancel()]));
}

async function addSave(ctx) {
  const claimed = await LineChat.findOneAndUpdate({ _id: ctx.chat._id, flow: "add", step: "confirm" }, { $set: { step: "saving" } }).lean();
  if (!claimed) return ctx.say(text("รายการนี้บันทึกไปแล้ว หรือหมดเวลา — เริ่มใหม่ได้ที่ ➕ เพิ่มรายการ", mainQuick()));
  const d = claimed.data || {};
  const h = ctx.hotel;
  try {
    if (d.t === "room") {
      const last = await RoomType.findOne({ hotel: h._id }).sort("-sort").select("sort").lean();
      const imgs = (d.images || []).slice(0, MAX_IMG);
      const rt = await RoomType.create({
        hotel: h._id, name: d.name, basePrice: d.price, otaPrice: 0, qty: d.qty || 1, capacity: d.cap || 2,
        description: d.desc || "", amenities: (d.amen || []).slice(0, 20), images: imgs, imageUrl: imgs[0] || "", sort: ((last && last.sort) || 0) + 1,
      });
      await clearFlow(ctx);
      ctx.say(flex("ขึ้นเว็บแล้ว: " + rt.name, bubble({
        tag: "✅ ขึ้นเว็บแล้ว", hero: imgs.length ? imgUrl("room", rt._id, 0, ver(rt)) : null,
        title: rt.name, sub: `${money(rt.basePrice)}/คืน · ${rt.qty} ห้อง · พัก ${rt.capacity} คน`,
        buttons: [
          btn(uri("🔗 ดูบนเว็บ", bookUrl(h))),
          btn(pb("➕ เพิ่มอีก", "a=add", "เพิ่มรายการ"), "secondary"),
          btn(pb("✏️ แก้ไขรายการ", "a=edit", "แก้ไขรายการ"), "link"),
        ],
      }), mainQuick()));
    } else {
      const last = await Service.findOne({ hotel: h._id }).sort("-sort").select("sort").lean();
      const sv = await Service.create({ hotel: h._id, name: d.name, price: d.price || 0, description: d.desc || "", imageUrl: d.image || "", sort: ((last && last.sort) || 0) + 1 });
      await clearFlow(ctx);
      ctx.say(flex("ขึ้นเว็บแล้ว: " + sv.name, bubble({
        tag: "✅ ขึ้นเว็บแล้ว", hero: d.image ? imgUrl("svc", sv._id, 0, ver(sv)) : null,
        title: sv.name, sub: sv.price ? money(sv.price) : "ฟรี",
        lines: [T("แขกเลือกซื้อพ่วงได้ตอนจองห้อง", { size: "xs", color: C.muted })],
        buttons: [
          btn(uri("🔗 ดูบนเว็บ", bookUrl(h))),
          btn(pb("➕ เพิ่มอีก", "a=add", "เพิ่มรายการ"), "secondary"),
          btn(pb("✏️ แก้ไขรายการ", "a=edit", "แก้ไขรายการ"), "link"),
        ],
      }), mainQuick()));
    }
  } catch (e) {
    await setFlow(ctx, "add", "confirm", d);
    throw e;
  }
}


// ================================================================ สิ่งอำนวยความสะดวก (เลือกจากปุ่ม + พิมพ์เพิ่มเอง)
const ROOM_AMEN = ["❄️ แอร์", "📶 Wi-Fi", "🚿 น้ำอุ่น", "📺 ทีวี", "🧊 ตู้เย็น", "🌄 ระเบียง/วิว", "🛁 อ่างอาบน้ำ", "☕ กาต้มน้ำ", "🍳 รวมอาหารเช้า"];
const HOTEL_AMEN = ["🏊 สระว่ายน้ำ", "🅿️ ที่จอดรถ", "📶 Wi-Fi", "🍳 อาหารเช้า", "🍽 ร้านอาหาร", "🐶 รับสัตว์เลี้ยง", "🚐 รถรับส่ง", "🔥 บาร์บีคิว", "🌿 สวน/ลานกิจกรรม", "💆 สปา/นวด", "☕ คาเฟ่"];
const AMEN_MAX = 20;
function amenMsg(kind, list, title) {
  const presets = kind === "hotel" ? HOTEL_AMEN : ROOM_AMEN;
  const extra = list.filter((x) => !presets.includes(x));
  return text(
    `${title}\n\nกดปุ่มด้านล่างเพื่อเลือก/เอาออก (กดได้หลายอัน)\n✍️ ไม่มีในปุ่ม? พิมพ์เพิ่มเองได้เลย คั่นด้วย , เช่น ไดร์เป่าผม, โต๊ะทำงาน\n` +
    (extra.length ? `(พิมพ์ “ลบ ชื่อ” เพื่อเอาที่พิมพ์เองออก)\n` : "") +
    `\nเลือกแล้ว (${list.length}): ${list.length ? list.join(" · ") : "—"}`,
    [...presets.map((p, i) => q((list.includes(p) ? "✓ " : "") + p, "a=am&i=" + i, (list.includes(p) ? "เอาออก " : "เลือก ") + p)), q("✅ เสร็จ", "a=am&s=done", "เสร็จ"), qCancel()]);
}
const amenKind = (ctx) => (ctx.chat.flow === "set" ? "hotel" : "room");
const inAmen = (ctx) => ["add", "ef", "set"].includes(ctx.chat.flow) && ctx.chat.step === "amen";
async function amenUpdate(ctx, list, note) {
  const d = { ...(ctx.chat.data || {}), amen: list };
  await setFlow(ctx, ctx.chat.flow, "amen", d);
  if (note) ctx.say(text(note));
  return ctx.say(amenMsg(amenKind(ctx), list, "✨ อัปเดตแล้ว"));
}
async function aAmen(ctx, p = {}) {
  if (!inAmen(ctx)) return stale(ctx);
  const list = [...((ctx.chat.data || {}).amen || [])];
  if (p.s === "done") return amenDone(ctx, list);
  const presets = amenKind(ctx) === "hotel" ? HOTEL_AMEN : ROOM_AMEN;
  const item = presets[parseInt(p.i, 10)];
  if (!item) return stale(ctx);
  const at = list.indexOf(item);
  if (at >= 0) list.splice(at, 1); else if (list.length < AMEN_MAX) list.push(item);
  return amenUpdate(ctx, list);
}
async function amenText(ctx, t) {
  const list = [...((ctx.chat.data || {}).amen || [])];
  if (/^(เสร็จ|done|ok|โอเค|ข้าม|ไม่มี)$/i.test(t)) return amenDone(ctx, list);
  const del = /^ลบ\s*(.+)$/.exec(t);
  if (del) {
    const name = del[1].trim();
    const at = list.findIndex((x) => x === name || x.replace(/^\S+\s/, "") === name);
    if (at < 0) return ctx.say(text(`ไม่พบ “${name}” ในรายการ`));
    list.splice(at, 1);
    return amenUpdate(ctx, list);
  }
  const added = [];
  for (const raw of t.split(/[,\n、]+/)) {
    const x = raw.trim().slice(0, 30);
    if (!x || list.includes(x) || list.length >= AMEN_MAX) continue;
    list.push(x); added.push(x);
  }
  if (!added.length) return ctx.say(text(list.length >= AMEN_MAX ? `เพิ่มได้สูงสุด ${AMEN_MAX} อย่าง` : "มีอยู่แล้ว 👍"));
  return amenUpdate(ctx, list, "➕ เพิ่ม: " + added.join(", "));
}
async function amenDone(ctx, list) {
  const f = ctx.chat.flow;
  if (f === "add") return askAdd(ctx, "desc", { ...(ctx.chat.data || {}), amen: list });
  if (f === "set") return setDone(ctx, { amenities: list }, list.length ? `✅ สิ่งอำนวยความสะดวก: ${list.join(" · ")}` : "✅ ล้างสิ่งอำนวยความสะดวกแล้ว");
  const st = ctx.chat.data || {};
  const it = await loadItem(ctx, st.k, st.id);
  if (!it) { await clearFlow(ctx); return stale(ctx); }
  await RoomType.updateOne(it.where, { $set: { amenities: list } });
  await clearFlow(ctx);
  return saved(ctx, `✅ “${it.doc.name}”: ${list.length ? list.join(" · ") : "ไม่มีสิ่งอำนวยฯ"}`, editQuick());
}

// ================================================================ แก้ไขรายการ
function roomBubble(r) {
  const imgs = r.images && r.images.length ? r.images : r.imageUrl ? [r.imageUrl] : [];
  const id = String(r._id);
  const P = (f) => `a=ef&k=r&id=${id}&f=${f}`;
  return bubble({
    size: "kilo", tag: r.hidden ? "⏸ ปิดขายชั่วคราว" : "🛏 ห้องพัก", tagColor: r.hidden ? C.muted : C.teal,
    hero: imgs.length ? imgUrl("room", id, 0, ver(r)) : null,
    title: r.name, sub: `${money(r.basePrice)}/คืน · ${r.qty} ห้อง · พัก ${r.capacity} คน`,
    lines: [(r.amenities || []).length ? T("✨ " + r.amenities.join(" · "), { size: "xs", color: C.teal, maxLines: 2 }) : null, r.description ? T(r.description, { size: "xs", color: C.muted, maxLines: 3 }) : null],
    footerGrid: true,
    buttons: [
      btn(pb("💰 ราคา", P("price"), "แก้ราคา " + r.name), "secondary"),
      btn(pb("🔢 จำนวน", P("qty"), "แก้จำนวนห้อง " + r.name), "secondary"),
      btn(pb(`📷 รูป ${imgs.length}/${MAX_IMG}`, P("photo"), "จัดการรูป " + r.name), "secondary"),
      btn(pb("📝 ข้อความ", P("txt"), "แก้ชื่อ/รายละเอียด " + r.name), "secondary"),
      btn(pb(r.hidden ? "▶️ เปิดขาย" : "⏸ ปิดขาย", P("hide"), (r.hidden ? "เปิดขาย " : "ปิดขาย ") + r.name), "secondary"),
      btn(pb("🗑 ลบ", P("del"), "ลบ " + r.name), "link", C.red),
    ],
  });
}
function svcBubble(s) {
  const id = String(s._id);
  const P = (f) => `a=ef&k=s&id=${id}&f=${f}`;
  return bubble({
    size: "kilo", tag: s.hidden ? "⏸ ปิดขายชั่วคราว" : "💆 กิจกรรม/บริการ", tagColor: s.hidden ? C.muted : C.sage,
    hero: s.imageUrl ? imgUrl("svc", id, 0, ver(s)) : null,
    title: s.name, sub: s.price ? money(s.price) : "ฟรี",
    lines: [s.description ? T(s.description, { size: "xs", color: C.muted, maxLines: 3 }) : null],
    footerGrid: true,
    buttons: [
      btn(pb("💰 ราคา", P("price"), "แก้ราคา " + s.name), "secondary"),
      btn(pb("📝 ข้อความ", P("txt"), "แก้ชื่อ/รายละเอียด " + s.name), "secondary"),
      btn(pb(s.imageUrl ? "📷 รูป 1/1" : "📷 รูป 0/1", P("photo"), "จัดการรูป " + s.name), "secondary"),
      btn(pb(s.hidden ? "▶️ เปิดขาย" : "⏸ ปิดขาย", P("hide"), (s.hidden ? "เปิดขาย " : "ปิดขาย ") + s.name), "secondary"),
      btn(pb("🗑 ลบ", P("del"), "ลบ " + s.name), "link", C.red),
    ],
  });
}

async function aEdit(ctx, p = {}) {
  const h = ctx.hotel;
  const [rooms, svcs] = await Promise.all([
    RoomType.find({ hotel: h._id }).sort("sort").lean(),
    Service.find({ hotel: h._id }).sort("sort").lean(),
  ]);
  const items = [...rooms.map((d) => ({ k: "r", d })), ...svcs.map((d) => ({ k: "s", d }))];
  if (!items.length) return ctx.say(text("ยังไม่มีห้องหรือกิจกรรม — เริ่มเพิ่มรายการแรกได้เลย", [q("🛏 เพิ่มห้อง", "a=add&t=room", "เพิ่มห้องพัก"), q("💆 เพิ่มกิจกรรม", "a=add&t=svc", "เพิ่มกิจกรรม/บริการ"), qMenu()]));
  const per = 10, page = Math.max(0, parseInt(p.p, 10) || 0);
  const slice = items.slice(page * per, page * per + per);
  const bubbles = slice.map((it) => (it.k === "r" ? roomBubble(it.d) : svcBubble(it.d)));
  const more = items.length - (page + 1) * per;
  if (more > 0) bubbles.push(bubble({ size: "kilo", title: "ดูรายการถัดไป", sub: `อีก ${more} รายการ`, buttons: [btn(pb("ถัดไป →", "a=edit&p=" + (page + 1), "ดูรายการถัดไป"))] }));
  ctx.say(
    text(`✏️ รายการบนเว็บ (${rooms.length} ห้อง · ${svcs.length} กิจกรรม)\nเลื่อนการ์ดซ้าย-ขวา แล้วกดสิ่งที่จะแก้ 👇`),
    flex("แก้ไขรายการ", carousel(bubbles), [q("➕ เพิ่มรายการ", "a=add", "เพิ่มรายการ"), q("🔗 ดูเว็บ", "a=web", "ดูเว็บของฉัน"), qMenu()]),
  );
}

async function loadItem(ctx, k, id) {
  if (!isId(id) || (k !== "r" && k !== "s")) return null;
  const Model = k === "r" ? RoomType : Service;
  const doc = await Model.findOne({ _id: id, hotel: ctx.hotel._id }).lean();
  return doc ? { doc, Model, room: k === "r", k, where: { _id: doc._id, hotel: ctx.hotel._id } } : null;
}
const futureBookings = (roomId) => Booking.countDocuments({ roomType: roomId, status: { $ne: "cancelled" }, checkout: { $gte: todayTH() } });

async function aEditField(ctx, p) {
  if (!["photo", "photodone"].includes(p.f)) await clearFlow(ctx);
  const it = await loadItem(ctx, p.k, p.id);
  if (!it) return ctx.say(text("ไม่พบรายการนี้ (อาจถูกลบไปแล้ว)", [q("✏️ แก้ไขรายการ", "a=edit", "แก้ไขรายการ")]));
  const { doc, Model, room, where } = it;
  const st = { k: it.k, id: String(doc._id) };
  const P = (f) => `a=ef&k=${it.k}&id=${doc._id}&f=${f}`;
  switch (p.f) {
    case "price":
      return ask(ctx, "ef", "price", st, text(`💰 ราคาใหม่ของ “${doc.name}”\n(ตอนนี้ ${money(room ? doc.basePrice : doc.price)}${room ? "/คืน" : ""})`, [qCancel()]));
    case "qty":
      if (!room) break;
      return ask(ctx, "ef", "qty", st, text(`🔢 จำนวนห้อง “${doc.name}” (ตอนนี้ ${doc.qty} ห้อง)`, ["1", "2", "3", "4", "5", "6"].map((n) => qText(n + " ห้อง", n)).concat(qCancel())));
    case "cap":
      if (!room) break;
      return ask(ctx, "ef", "cap", st, text(`👥 “${doc.name}” พักได้กี่คนต่อห้อง? (ตอนนี้ ${doc.capacity} คน)`, ["1", "2", "3", "4", "6"].map((n) => qText(n + " คน", n)).concat(qCancel())));
    case "name":
      return ask(ctx, "ef", "name", st, text(`🏷 ชื่อใหม่ของ “${doc.name}”`, [qCancel()]));
    case "desc":
      return ask(ctx, "ef", "desc", st, text(`📝 รายละเอียดใหม่ของ “${doc.name}”\nตอนนี้: ${doc.description || "—"}`, [doc.description ? q("🗑 ลบรายละเอียด", P("descclear"), "ลบรายละเอียด") : null, qCancel()]));
    case "txt":
      return ctx.say(text(`จะแก้อะไรของ “${doc.name}”?`, [q("🏷 ชื่อ", P("name"), "แก้ชื่อ"), q("📝 รายละเอียด", P("desc"), "แก้รายละเอียด"), room ? q("👥 พักได้กี่คน", P("cap"), "แก้จำนวนคน") : null, room ? q("✨ สิ่งอำนวยฯ", P("amen"), "แก้สิ่งอำนวยความสะดวก") : null, qCancel()]));
    case "amen":
      if (!room) break;
      return ask(ctx, "ef", "amen", { ...st, amen: doc.amenities || [] }, amenMsg("room", doc.amenities || [], `✨ “${doc.name}” มีอะไรบ้าง?`));
    case "descclear":
      await Model.updateOne(where, { $set: { description: "" } });
      return saved(ctx, `✅ ลบรายละเอียด “${doc.name}” แล้ว`, editQuick());
    case "photo":
      return showPhotos(ctx, it);
    case "photodone":
      await clearFlow(ctx);
      return saved(ctx, `✅ อัปเดตรูป “${doc.name}” แล้ว`, editQuick());
    case "imgclear":
      if (room) break;
      await Service.updateOne(where, { $set: { imageUrl: "" } });
      await clearFlow(ctx);
      return saved(ctx, `🗑 ลบรูป “${doc.name}” แล้ว`, editQuick());
    case "hide": {
      const hide = !doc.hidden;
      await Model.updateOne(where, { $set: { hidden: hide } });
      return saved(ctx, hide ? `⏸ ปิดขาย “${doc.name}” ชั่วคราวแล้ว (ไม่แสดงบนเว็บ)` : `▶️ เปิดขาย “${doc.name}” แล้ว`, editQuick());
    }
    case "del":
    case "delok": {
      if (room) {
        const n = await futureBookings(doc._id);
        if (n) return ctx.say(text(`ลบไม่ได้: “${doc.name}” มีการจองที่ยังไม่ถึงวัน ${n} รายการ\nแนะนำ “ปิดขาย” แทน (ซ่อนจากเว็บ แต่การจองเดิมยังอยู่)`, [q("⏸ ปิดขายแทน", P("hide"), "ปิดขาย " + doc.name), q("✏️ แก้ไขรายการ", "a=edit", "แก้ไขรายการ")]));
      }
      if (p.f === "del") return ctx.say(text(`ยืนยันลบ “${doc.name}”?\nลบแล้วกู้คืนไม่ได้`, [q("🗑 ยืนยันลบ", P("delok"), "ยืนยันลบ " + doc.name), q("ไม่ลบ", "a=edit", "ไม่ลบ")]));
      await Model.deleteOne(where);
      return ctx.say(text(`🗑 ลบ “${doc.name}” แล้ว`, editQuick()));
    }
  }
  return ctx.say(text("ไม่รู้จักคำสั่งนี้", editQuick()));
}

async function showPhotos(ctx, it) {
  const { doc, room } = it;
  const id = String(doc._id);
  const P = (f) => `a=ef&k=${it.k}&id=${id}&f=${f}`;
  await setFlow(ctx, "ef", "photo", { k: it.k, id });
  if (room) {
    const imgs = doc.images && doc.images.length ? doc.images : doc.imageUrl ? [doc.imageUrl] : [];
    const quick = [imgs.length < MAX_IMG ? qRoll("🖼 เพิ่มรูป") : null, imgs.length < MAX_IMG ? qCam() : null, q("✅ เสร็จ", P("photodone"), "เสร็จ")];
    if (!imgs.length) return ctx.say(text(`📷 “${doc.name}” ยังไม่มีรูป\nส่งรูปได้สูงสุด ${MAX_IMG} รูป แล้วกด ✅ เสร็จ`, quick));
    const v = ver(doc);
    const bubbles = imgs.map((_, i) => bubble({
      size: "micro", hero: imgUrl("room", id, i, v), title: `รูปที่ ${i + 1}`, sub: i === 0 ? "รูปหลัก (หน้าปกห้อง)" : `${i + 1} จาก ${imgs.length}`,
      buttons: [btn(pb("🗑 ลบรูปนี้", `a=di&id=${id}&i=${i}&n=${imgs.length}`, `ลบรูปที่ ${i + 1}`), "link", C.red)],
    }));
    return ctx.say(
      text(`📷 รูปของ “${doc.name}” (${imgs.length}/${MAX_IMG})\n${imgs.length < MAX_IMG ? "ส่งรูปเพิ่มได้เลย" : "ครบแล้ว — ลบรูปเดิมก่อนถ้าจะเปลี่ยน"} · เสร็จแล้วกด ✅`),
      flex("รูปห้อง " + doc.name, carousel(bubbles), quick),
    );
  }
  const quick = [qRoll(doc.imageUrl ? "🖼 เปลี่ยนรูป" : "🖼 เลือกรูป"), qCam(), doc.imageUrl ? q("🗑 ลบรูป", P("imgclear"), "ลบรูป") : null, q("✅ เสร็จ", P("photodone"), "เสร็จ")];
  if (doc.imageUrl) return ctx.say(flex("รูป " + doc.name, bubble({ size: "kilo", hero: imgUrl("svc", id, 0, ver(doc)), title: doc.name, sub: "ส่งรูปใหม่เพื่อเปลี่ยน" }), quick));
  return ctx.say(text(`📷 “${doc.name}” ยังไม่มีรูป ส่งรูปมาได้เลย (1 รูป)`, quick));
}

async function aDelImage(ctx, p) {
  if (!isId(p.id)) return;
  const rt = await RoomType.findOne({ _id: p.id, hotel: ctx.hotel._id }).lean();
  if (!rt) return ctx.say(text("ไม่พบห้องนี้", editQuick()));
  const imgs = rt.images && rt.images.length ? [...rt.images] : rt.imageUrl ? [rt.imageUrl] : [];
  const i = parseInt(p.i, 10);
  if (imgs.length !== parseInt(p.n, 10) || !(i >= 0 && i < imgs.length)) {
    return ctx.say(text("รูปมีการเปลี่ยนแปลงไปแล้ว — เปิดหน้ารูปใหม่อีกครั้ง", [q("📷 เปิดรูปอีกครั้ง", `a=ef&k=r&id=${rt._id}&f=photo`, "จัดการรูป")]));
  }
  imgs.splice(i, 1);
  await RoomType.updateOne({ _id: rt._id }, { $set: { images: imgs, imageUrl: imgs[0] || "" } });
  ctx.say(text(`🗑 ลบรูปที่ ${i + 1} แล้ว`));
  return showPhotos(ctx, { doc: { ...rt, images: imgs, imageUrl: imgs[0] || "", updatedAt: new Date() }, room: true, k: "r" });
}

async function editText(ctx, t) {
  const st = ctx.chat.data || {};
  const it = await loadItem(ctx, st.k, st.id);
  if (!it) { await clearFlow(ctx); return ctx.say(text("ไม่พบรายการนี้แล้ว", editQuick())); }
  const { doc, Model, room, where } = it;
  const done = async (set, msg) => { await Model.updateOne(where, { $set: set }); await clearFlow(ctx); return saved(ctx, msg, editQuick()); };
  switch (ctx.chat.step) {
    case "price": {
      const n = parseNum(t);
      if (n == null || n > 500000 || (room && n <= 0)) return ctx.say(text("พิมพ์ราคาเป็นตัวเลข เช่น 1200", [qCancel()]));
      return done(room ? { basePrice: n } : { price: n }, `✅ ราคา “${doc.name}” = ${n ? money(n) : "ฟรี"}${room ? "/คืน" : ""}`);
    }
    case "qty": {
      const n = parseNum(t);
      if (!n || n < 1 || n > 200) return ctx.say(text("พิมพ์จำนวนห้อง 1–200", [qCancel()]));
      return done({ qty: n }, `✅ “${doc.name}” มี ${n} ห้อง`);
    }
    case "cap": {
      const n = parseNum(t);
      if (!n || n < 1 || n > 30) return ctx.say(text("พิมพ์จำนวนคน 1–30", [qCancel()]));
      return done({ capacity: n }, `✅ “${doc.name}” พักได้ ${n} คน/ห้อง`);
    }
    case "name":
      if (t.length > 60) return ctx.say(text("ชื่อยาวไม่เกิน 60 ตัวอักษร", [qCancel()]));
      return done({ name: t }, `✅ เปลี่ยนชื่อเป็น “${t}” แล้ว`);
    case "amen":
      return amenText(ctx, t);
    case "desc":
      return done({ description: t.slice(0, 300) }, `✅ อัปเดตรายละเอียด “${doc.name}” แล้ว`);
    case "photo":
      return ctx.say(text("ส่งเป็น “รูป” ได้เลย 📷 หรือกด ✅ เสร็จ", [qRoll(), qCam(), q("✅ เสร็จ", `a=ef&k=${it.k}&id=${doc._id}&f=photodone`, "เสร็จ")]));
  }
  return stale(ctx);
}

// ================================================================ รูปที่ส่งมา
async function onImage(ctx, m) {
  const f = ctx.chat.flow, s = ctx.chat.step;
  const wanted = (f === "add" && (s === "photos" || s === "photo")) || (f === "ef" && s === "photo") || (f === "set" && s === "cover");
  const last = !m.imageSet || Number(m.imageSet.index) >= Number(m.imageSet.total);
  if (!wanted) {
    if (!last) return;
    if (ctx.hotel) return ctx.say(text("ได้รับรูปแล้ว 📷\nถ้าจะใส่รูปให้ห้อง: ✏️ แก้ไขรายการ → เลือกห้อง → 📷 รูป\nถ้าจะเปลี่ยนรูปหน้าปก: 🎨 ตั้งค่าเว็บ → 🖼 รูปหน้าปก", [q("✏️ แก้ไขรายการ", "a=edit", "แก้ไขรายการ"), q("🖼 รูปหน้าปก", "a=set&f=cover", "เปลี่ยนรูปหน้าปก")]));
    return idleFallback(ctx);
  }
  L.showLoading(ctx.uid, 10);
  let dataUrl;
  try { dataUrl = await toDataUrl(await L.getContent(m.id)); }
  catch (e) { console.error("line image", e.message); return last ? ctx.say(text("รับรูปไม่สำเร็จ 😥 " + (e.message || "") + "\nลองส่งใหม่อีกครั้ง")) : null; }

  // --- เพิ่มห้องใหม่ (ยังไม่บันทึก เก็บไว้ในขั้นตอน) ---
  if (f === "add" && s === "photos") {
    const r = await LineChat.updateOne(
      { _id: ctx.chat._id, flow: "add", step: "photos", ["data.images." + (MAX_IMG - 1)]: { $exists: false } },
      { $push: { "data.images": dataUrl } });
    if (!last) return;
    const fresh = await LineChat.findById(ctx.chat._id).lean();
    ctx.chat.data = (fresh && fresh.data) || ctx.chat.data;
    const n = (ctx.chat.data.images || []).length;
    if (!r.modifiedCount) ctx.say(text(`ครบ ${MAX_IMG} รูปแล้ว (รูปที่เกินไม่ได้บันทึก)`));
    if (n >= MAX_IMG) return addConfirm(ctx);
    return ctx.say(text(`📷 รับรูปแล้ว ${n}/${MAX_IMG}`, [qRoll("🖼 เพิ่มรูป"), qCam(), q("✅ เสร็จ", "a=add&s=photosdone", "เสร็จ")]));
  }
  if (f === "add" && s === "photo") {
    await setFlow(ctx, "add", "photo", { ...(ctx.chat.data || {}), image: dataUrl });
    if (!last) return;
    return addConfirm(ctx);
  }
  // --- รูปปกเว็บ ---
  if (f === "set" && s === "cover") {
    await Hotel.updateOne({ _id: ctx.hotel._id }, { $set: { coverData: dataUrl, coverUrl: `/api/public/img/cover/${ctx.hotel._id}/0?v=${Date.now()}` } });
    await clearFlow(ctx);
    if (!last) return;
    return saved(ctx, "✅ เปลี่ยนรูปหน้าปกแล้ว");
  }
  // --- เพิ่ม/เปลี่ยนรูปของรายการเดิม ---
  const st = ctx.chat.data || {};
  const it = await loadItem(ctx, st.k, st.id);
  if (!it) { await clearFlow(ctx); return last ? ctx.say(text("ไม่พบรายการนี้แล้ว", editQuick())) : null; }
  if (!it.room) {
    await Service.updateOne(it.where, { $set: { imageUrl: dataUrl } });
    await clearFlow(ctx);
    if (!last) return;
    return saved(ctx, `✅ เปลี่ยนรูป “${it.doc.name}” แล้ว`, editQuick());
  }
  const doc = it.doc;
  if (!(doc.images && doc.images.length) && doc.imageUrl) {
    await RoomType.updateOne({ _id: doc._id, images: { $size: 0 } }, { $set: { images: [doc.imageUrl] } });
  }
  const r = await RoomType.updateOne({ ...it.where, ["images." + (MAX_IMG - 1)]: { $exists: false } }, { $push: { images: dataUrl } });
  const fresh = await RoomType.findById(doc._id).select("images imageUrl").lean();
  const imgs = (fresh && fresh.images) || [];
  if (imgs.length && fresh.imageUrl !== imgs[0]) await RoomType.updateOne({ _id: doc._id }, { $set: { imageUrl: imgs[0] } });
  if (!last) return;
  const P = (x) => `a=ef&k=r&id=${doc._id}&f=${x}`;
  if (!r.modifiedCount) return ctx.say(text(`ครบ ${MAX_IMG} รูปแล้ว — ลบรูปเดิมก่อนถ้าจะเปลี่ยน`, [q("📷 ดูรูปทั้งหมด", P("photo"), "จัดการรูป"), q("✅ เสร็จ", P("photodone"), "เสร็จ")]));
  return ctx.say(text(`📷 เพิ่มรูปแล้ว ${imgs.length}/${MAX_IMG}`, [imgs.length < MAX_IMG ? qRoll("🖼 เพิ่มอีก") : null, q("✅ เสร็จ", P("photodone"), "เสร็จ"), q("📷 ดูรูปทั้งหมด", P("photo"), "จัดการรูป")]));
}

// ================================================================ ตั้งค่าเว็บ
// โครงร่างจำลองของเทมเพลต (ให้เห็นความต่างของ layout ในการ์ด)
function wire(key, c1, c2, ac) {
  const E = (o = {}) => ({ type: "box", layout: "vertical", contents: [], ...o });
  const H = (contents, o = {}) => ({ type: "box", layout: "horizontal", contents, spacing: "4px", ...o });
  const V = (contents, o = {}) => ({ type: "box", layout: "vertical", contents, spacing: "4px", ...o });
  const grad = { type: "linearGradient", angle: "135deg", startColor: c1, endColor: c2 };
  const W = "#ffffff", G = "#cbd5e1", D = "#0f2540";
  const card = (h, col = W) => E({ height: h, backgroundColor: col, cornerRadius: "3px", borderWidth: "1px", borderColor: "#e2e8f0" });
  const bar = (w, h = "5px", col = G) => E({ width: w, height: h, backgroundColor: col, cornerRadius: "3px", flex: 0 });
  const center = (x) => H([E(), x, E()]);
  switch (key) {
    case "editorial":
      return [center(bar("30%", "4px")), E({ height: "36px", background: grad, cornerRadius: "2px" }),
        H([E({ height: "40px", backgroundColor: c2, cornerRadius: "2px" }), V([bar("80%", "5px", D), bar("90%", "3px"), bar("70%", "3px"), bar("40%", "8px", ac)], { justifyContent: "center" })])];
    case "magazine":
      return [bar("75%", "14px", D), bar("40%", "4px"), H([card("50px"), card("38px", ac), card("58px")], { alignItems: "flex-start" })];
    case "split":
      return [H([
        V([bar("70%", "5px", W), bar("50%", "3px", W), E({ height: "16px", backgroundColor: W, cornerRadius: "3px" }), E({ height: "8px", backgroundColor: ac, cornerRadius: "3px" })],
          { width: "36%", flex: 0, background: grad, cornerRadius: "5px", paddingAll: "6px", height: "94px" }),
        V([H([card("44px"), card("44px")]), H([card("44px"), card("44px")])]),
      ])];
    case "simple":
      return [E({ height: "26px", background: grad, cornerRadius: "5px" }),
        center(E({ width: "20px", height: "20px", backgroundColor: W, cornerRadius: "10px", borderWidth: "2px", borderColor: c1, flex: 0 })),
        center(V([card("18px"), card("18px")], { width: "62%", flex: 0 }))];
    case "catalog":
      return [H([bar("22%", "8px", D), E({ height: "8px", backgroundColor: W, cornerRadius: "4px", borderWidth: "1px", borderColor: G })], { alignItems: "center" }),
        H([bar("16%", "5px", ac), bar("16%", "5px"), bar("16%", "5px"), E()]),
        H([card("30px"), card("30px"), card("30px")]), H([card("30px"), card("30px"), card("30px")])];
    case "classic":
      return [H([bar("14%", "4px"), E(), bar("22%", "6px", D), E(), bar("14%", "4px")], { alignItems: "center" }),
        V([center(bar("40%", "6px", W)), center(bar("25%", "3px", W))], { height: "40px", background: grad, borderWidth: "2px", borderColor: ac, cornerRadius: "2px", justifyContent: "center" }),
        H([card("34px"), card("34px"), card("34px")])];
    case "bento":
      return [H([E({ flex: 3, height: "94px", background: grad, cornerRadius: "6px" }),
        V([E({ height: "45px", backgroundColor: ac, cornerRadius: "6px" }), E({ height: "45px", backgroundColor: W, cornerRadius: "6px", borderWidth: "1px", borderColor: G })], { flex: 2 })])];
    case "fullscreen":
      return [V([bar("30%", "5px", W), E({ flex: 1 }), bar("60%", "10px", W), bar("40%", "4px", W), E({ flex: 1 }), center(bar("30%", "9px", ac))],
        { height: "94px", background: grad, cornerRadius: "5px", paddingAll: "6px" })];
    case "immersive":
      return [V([bar("40%", "5px", W)], { height: "38px", backgroundColor: D, cornerRadius: "4px", justifyContent: "center", paddingAll: "6px" }),
        E({ height: "28px", background: grad, cornerRadius: "4px" }),
        center(E({ width: "70%", flex: 0, height: "20px", backgroundColor: W, cornerRadius: "4px", borderWidth: "1px", borderColor: G }))];
    default: // rich
      return [bar("55%"), E({ height: "40px", background: grad, cornerRadius: "5px" }), H([card("34px"), card("34px"), card("34px")])];
  }
}
const swatches = (cols) => row(cols.map((c) => box([], { width: "24px", height: "24px", backgroundColor: U.safeColor(c, C.line), cornerRadius: "12px", flex: 0 })), { spacing: "6px", margin: "md" });

async function aSet(ctx, p = {}) {
  const h = await Hotel.findById(ctx.hotel._id).lean();
  ctx.hotel = h;
  const P = (f) => "a=set&f=" + f;
  switch (p.f) {
    case "tpl": return showTemplates(ctx);
    case "ps": return showPresets(ctx);
    case "amen":
      return ask(ctx, "set", "amen", { amen: h.amenities || [] }, amenMsg("hotel", h.amenities || [], "🏊 ที่พักมีสิ่งอำนวยความสะดวกอะไรบ้าง?"));
    case "cover":
      return ask(ctx, "set", "cover", {}, text("🖼 ส่งรูปหน้าปก 1 รูป\n(แนวนอนสวยสุด เช่น วิวที่พัก หน้าที่พัก)", [qRoll(), qCam(), h.coverUrl ? q("🗑 ลบรูปปก", "a=st&cover=clear", "ลบรูปหน้าปก") : null, qCancel()]));
    case "txt":
      return ctx.say(text("จะแก้ข้อความส่วนไหน?", [q("🏷 ชื่อที่พัก", P("name"), "แก้ชื่อที่พัก"), q("✨ คำโปรย", P("tagline"), "แก้คำโปรย"), q("📖 เกี่ยวกับที่พัก", P("about"), "แก้เกี่ยวกับที่พัก"), qCancel()]));
    case "contact":
      return ctx.say(text("จะแก้ข้อมูลติดต่อส่วนไหน?", [q("📞 เบอร์โทร", P("phone"), "แก้เบอร์โทร"), q("📍 ทำเล/จังหวัด", P("location"), "แก้ทำเล"), q("💬 LINE ที่พัก", P("lineid"), "แก้ LINE ID ที่พัก"), q("📧 อีเมลแจ้งเตือน", P("nemail"), "แก้อีเมลแจ้งเตือน"), q("🧾 ที่อยู่ใบเสร็จ", P("address"), "แก้ที่อยู่"), qCancel()]));
    case "cx":
      return ctx.say(text(`↩️ นโยบายยกเลิก (ตอนนี้: ${h.allowGuestCancel === false ? "ไม่ให้ยกเลิกออนไลน์" : `ยกเลิกฟรีก่อนเช็คอิน ${h.cancelDays ?? 3} วัน`})\nให้แขกยกเลิกเองออนไลน์ได้ไหม?`, [q("✅ ได้", "a=st&cx=1", "ให้แขกยกเลิกเองได้"), q("❌ ไม่ได้", "a=st&cx=0", "ไม่ให้ยกเลิกออนไลน์"), qCancel()]));
    case "pp":
      return ask(ctx, "set", "ppid", {}, text(`💳 เบอร์พร้อมเพย์ (10 หลัก) หรือเลขบัตรประชาชน (13 หลัก) ที่ใช้รับเงิน\nตอนนี้: ${h.promptpayId ? mask(h.promptpayId) : "ยังไม่ได้ตั้ง"}`, [qCancel()]));
    case "name": case "tagline": case "about": case "phone": case "location": case "lineid": case "nemail": case "address":
      return ask(ctx, "set", p.f, {}, text(SET_PROMPTS[p.f](h), [qCancel()]));
  }
  const tpl = templateByKey(h.template) || TEMPLATES[0];
  const ps = presetOfHotel(h);
  const look = bubble({
    tag: "🎨 หน้าตาเว็บ", title: h.name,
    lines: [
      kv("หน้าตา", `${tpl.name} · ${tpl.th}`), kv("โทนสี", ps ? ps.name.split(" · ")[0] : "กำหนดเอง"),
      kv("ฟอนต์", h.fontFamily || "Sarabun"), kv("รูปปก", h.coverUrl ? "มีแล้ว ✅" : "ยังไม่มี"),
      swatches([h.brandColor, h.brandColor2, h.accentColor, h.accentColor2]),
    ],
    buttons: [
      btn(pb("🧱 หน้าตาเว็บ 10 แบบ", P("tpl"), "เปลี่ยนหน้าตาเว็บ")),
      btn(pb("🎨 โทนสี & ฟอนต์", P("ps"), "เปลี่ยนโทนสี & ฟอนต์"), "secondary"),
      btn(pb("🖼 รูปหน้าปก", P("cover"), "เปลี่ยนรูปหน้าปก"), "secondary"),
      btn(pb("🏷 ชื่อ & คำโปรย", P("txt"), "แก้ชื่อ/คำโปรย"), "secondary"),
      btn(uri("🔗 เปิดดูเว็บ", bookUrl(h)), "link"),
    ],
  });
  const info = bubble({
    tag: "🏡 ข้อมูล & การรับเงิน", tagColor: C.sage, title: "ข้อมูลที่พัก",
    lines: [
      kv("โทร", h.phone || "—"), kv("ทำเล", h.location || "—"), kv("LINE ที่พัก", h.lineId || "—"), kv("สิ่งอำนวยฯ", (h.amenities || []).length ? h.amenities.length + " อย่าง" : "ยังไม่ระบุ"),
      kv("PromptPay", h.promptpayId ? mask(h.promptpayId) : "ยังไม่ตั้ง ⚠️"),
      kv("ยกเลิก", h.allowGuestCancel === false ? "ไม่ให้ยกเลิกออนไลน์" : `ฟรีก่อน ${h.cancelDays ?? 3} วัน`),
    ],
    buttons: [
      btn(pb("📞 ติดต่อ & ที่ตั้ง", P("contact"), "แก้ข้อมูลติดต่อ"), "secondary"),
      btn(pb("💳 รับเงิน PromptPay", P("pp"), "ตั้ง PromptPay"), "secondary"),
      btn(pb("🏊 สิ่งอำนวยความสะดวก", P("amen"), "ตั้งสิ่งอำนวยความสะดวก"), "secondary"),
      btn(pb("↩️ นโยบายยกเลิก", P("cx"), "ตั้งนโยบายยกเลิก"), "secondary"),
      btn(pb("💻 ตั้งค่าเพิ่มบนเว็บ", "a=magic", "เปิดเว็บหลังบ้าน"), "link"),
    ],
  });
  ctx.say(flex("ตั้งค่าเว็บ " + h.name, carousel([look, info]), [q("🧱 หน้าตาเว็บ", P("tpl"), "เปลี่ยนหน้าตาเว็บ"), q("🎨 โทนสี", P("ps"), "เปลี่ยนโทนสี & ฟอนต์"), q("💳 PromptPay", P("pp"), "ตั้ง PromptPay"), qMenu()]));
}

const SET_PROMPTS = {
  name: (h) => `🏷 ชื่อที่พักใหม่\n(ตอนนี้: ${h.name || "—"})`,
  tagline: (h) => `✨ คำโปรยสั้น ๆ ใต้ชื่อที่พัก (ไม่เกิน 120 ตัวอักษร)\nเช่น “ที่พักริมน้ำ บรรยากาศบ้านสวน”\n(ตอนนี้: ${h.tagline || "—"})`,
  about: (h) => `📖 เล่าเกี่ยวกับที่พัก 2–3 ประโยค (แสดงในหน้าเว็บ)\n(ตอนนี้: ${U.cut(h.about || "—", 200)})`,
  phone: (h) => `📞 เบอร์โทรที่พัก (แสดงให้แขก)\n(ตอนนี้: ${h.phone || "—"})`,
  location: (h) => `📍 ทำเล/จังหวัด (เช่น ริมแม่น้ำแคว กาญจนบุรี)\n(ตอนนี้: ${h.location || "—"})`,
  lineid: (h) => `💬 LINE ID ของที่พัก ให้แขกแอดคุย (เช่น @baanbaan)\n(ตอนนี้: ${h.lineId || "—"})`,
  nemail: (h) => `📧 อีเมลรับแจ้งเตือนเมื่อมีจองใหม่\n(ตอนนี้: ${h.notifyEmail || "—"})`,
  address: (h) => `🧾 ที่อยู่ที่พัก (แสดงบนใบเสร็จ)\n(ตอนนี้: ${h.address || "—"})`,
};

async function showTemplates(ctx) {
  const h = ctx.hotel;
  const c1 = U.safeColor(h.brandColor), c2 = U.safeColor(h.brandColor2, c1), ac = U.safeColor(h.accentColor, C.amber);
  const cur = h.template || "rich";
  const bubbles = TEMPLATES.map((t, i) => ({
    type: "bubble", size: "kilo",
    body: box([
      box(wire(t.key, c1, c2, ac), { backgroundColor: "#f1f5f9", cornerRadius: "8px", paddingAll: "8px", height: "112px", spacing: "4px" }),
      T(`${i + 1}. ${t.name}${cur === t.key ? "  ✓ ใช้อยู่" : ""}`, { weight: "bold", size: "md", color: C.navy, margin: "md" }),
      T(t.th + " — " + t.desc, { size: "xs", color: C.muted, margin: "xs" }),
      T("เหมาะกับ: " + t.fit, { size: "xs", color: C.teal, margin: "xs" }),
    ], { paddingAll: "12px" }),
    footer: box([
      btn(pb(cur === t.key ? "✓ ใช้อยู่" : "✅ ใช้แบบนี้", "a=st&tpl=" + t.key, "ใช้หน้าตาแบบ " + t.name), cur === t.key ? "secondary" : "primary"),
      btn(uri("👀 ดูตัวอย่าง", bookUrl(h, "&tpl=" + t.key)), "link"),
    ], { spacing: "xs", paddingAll: "10px", paddingTop: "0px" }),
  }));
  ctx.say(
    text("🧱 เลือกหน้าตาเว็บ (10 แบบ) — เลื่อนซ้าย-ขวา\nกด “👀 ดูตัวอย่าง” เพื่อดูเว็บของคุณในแบบนั้นก่อนตัดสินใจ"),
    flex("เลือกหน้าตาเว็บ 10 แบบ", carousel(bubbles), [q("🎨 โทนสี & ฟอนต์", "a=set&f=ps", "เปลี่ยนโทนสี & ฟอนต์"), q("⚙️ ตั้งค่าอื่น", "a=set", "ตั้งค่าเว็บ"), qMenu()]),
  );
}

async function showPresets(ctx) {
  const h = ctx.hotel;
  const cur = presetOfHotel(h);
  const bubbles = STYLE_PRESETS.map((p) => {
    const on = cur && cur.key === p.key;
    const [en, th] = p.name.split(" · ");
    return {
      type: "bubble", size: "kilo",
      body: box([
        box([T(th || en, { color: "#ffffff", weight: "bold", size: "md" }), T(en, { color: "#ffffffcc", size: "xs" })], {
          background: { type: "linearGradient", angle: "135deg", startColor: p.brandColor, endColor: p.brandColor2 },
          cornerRadius: "10px", paddingAll: "14px", height: "84px", justifyContent: "flex-end",
        }),
        swatches([p.brandColor, p.brandColor2, p.accentColor, p.accentColor2]),
        T(`ฟอนต์ ${p.fontFamily} · มุม${UI_TH[p.uiStyle] || ""}`, { size: "xs", color: C.muted, margin: "sm" }),
        on ? T("✓ ใช้อยู่", { size: "xs", color: C.teal, weight: "bold" }) : null,
      ], { paddingAll: "12px" }),
      footer: box([
        btn(pb(on ? "✓ ใช้อยู่" : "✅ ใช้ชุดนี้", "a=st&ps=" + p.key, "ใช้โทนสี " + p.name), on ? "secondary" : "primary", on ? undefined : p.brandColor),
        btn(uri("👀 ดูตัวอย่าง", bookUrl(h, "&preset=" + p.key)), "link"),
      ], { spacing: "xs", paddingAll: "10px", paddingTop: "0px" }),
    };
  });
  ctx.say(
    text("🎨 เลือกโทนสี + ฟอนต์ (10 ชุด) — เลื่อนซ้าย-ขวา\nกด “👀 ดูตัวอย่าง” เพื่อดูเว็บจริงด้วยสีชุดนั้น"),
    flex("เลือกโทนสี 10 ชุด", carousel(bubbles), [q("🧱 หน้าตาเว็บ", "a=set&f=tpl", "เปลี่ยนหน้าตาเว็บ"), q("⚙️ ตั้งค่าอื่น", "a=set", "ตั้งค่าเว็บ"), qMenu()]),
  );
}

async function setDone(ctx, set, msg, quick) {
  await Hotel.updateOne({ _id: ctx.hotel._id }, { $set: set });
  Object.assign(ctx.hotel, set);
  await clearFlow(ctx);
  return saved(ctx, msg, quick);
}

async function aSetSave(ctx, p = {}) {
  if (p.ppn === "hotel") {
    const d = ctx.chat.data || {};
    if (!inFlow(ctx, "set", "ppname") || !d.ppid) return stale(ctx);
    return setDone(ctx, { promptpayId: d.ppid, promptpayName: ctx.hotel.name }, "✅ ตั้ง PromptPay แล้ว — แขกสแกน QR จ่ายได้ทันที");
  }
  await clearFlow(ctx);
  const back = (extra) => [...extra, q("⚙️ ตั้งค่าอื่น", "a=set", "ตั้งค่าเว็บ"), qMenu()];
  if (p.tpl) {
    const t = templateByKey(p.tpl);
    if (!t) return stale(ctx);
    return setDone(ctx, { template: t.key }, `✅ เปลี่ยนหน้าตาเว็บเป็น “${t.name}” แล้ว`, back([q("🎨 โทนสี & ฟอนต์", "a=set&f=ps", "เปลี่ยนโทนสี & ฟอนต์")]));
  }
  if (p.ps) {
    const s = presetByKey(p.ps);
    if (!s) return stale(ctx);
    return setDone(ctx, {
      brandColor: s.brandColor, brandColor2: s.brandColor2, accentColor: s.accentColor, accentColor2: s.accentColor2,
      fontFamily: s.fontFamily, uiStyle: s.uiStyle,
    }, `✅ ใช้โทนสี “${s.name}” แล้ว`, back([q("🧱 หน้าตาเว็บ", "a=set&f=tpl", "เปลี่ยนหน้าตาเว็บ")]));
  }
  if (p.cover === "clear") {
    await Hotel.updateOne({ _id: ctx.hotel._id }, { $set: { coverUrl: "" }, $unset: { coverData: 1 } });
    ctx.hotel.coverUrl = "";
    return saved(ctx, "🗑 ลบรูปหน้าปกแล้ว");
  }
  if (p.cx === "0") return setDone(ctx, { allowGuestCancel: false }, "✅ แขกยกเลิกออนไลน์ไม่ได้ (ต้องติดต่อที่พัก)");
  if (p.cx === "1") {
    return ask(ctx, "set", "cxdays", {}, text("ยกเลิกฟรีได้ก่อนวันเช็คอินกี่วัน?", ["1", "3", "7", "14"].map((n) => q(n + " วัน", "a=st&cd=" + n, `ยกเลิกฟรีก่อน ${n} วัน`)).concat(qCancel())));
  }
  if (p.cd != null) {
    const n = Math.max(0, Math.min(60, parseInt(p.cd, 10) || 0));
    return setDone(ctx, { allowGuestCancel: true, cancelDays: n }, `✅ แขกยกเลิกฟรีได้ก่อนเช็คอิน ${n} วัน`);
  }
  return stale(ctx);
}

async function setText(ctx, t) {
  const step = ctx.chat.step;
  const err = (m) => ctx.say(text(m, [qCancel()]));
  switch (step) {
    case "name": if (t.length < 2 || t.length > 80) return err("ชื่อยาว 2–80 ตัวอักษร"); return setDone(ctx, { name: t }, `✅ ชื่อที่พัก: ${t}`);
    case "tagline": if (t.length > 120) return err("คำโปรยไม่เกิน 120 ตัวอักษร"); return setDone(ctx, { tagline: t }, "✅ อัปเดตคำโปรยแล้ว");
    case "about": if (t.length > 1000) return err("ยาวไม่เกิน 1,000 ตัวอักษร"); return setDone(ctx, { about: t }, "✅ อัปเดต “เกี่ยวกับที่พัก” แล้ว");
    case "phone": { const ph = normPhone(t); if (!ph) return err("เบอร์ไม่ถูกต้อง เช่น 0812345678"); return setDone(ctx, { phone: ph }, `✅ เบอร์โทร: ${ph}`); }
    case "location": if (t.length < 2 || t.length > 80) return err("ยาว 2–80 ตัวอักษร"); return setDone(ctx, { location: t }, `✅ ทำเล: ${t}`);
    case "lineid": if (t.length > 40) return err("ยาวไม่เกิน 40 ตัวอักษร"); return setDone(ctx, { lineId: t }, `✅ LINE ที่พัก: ${t}`);
    case "nemail": { const em = t.toLowerCase(); if (!EMAIL_RE.test(em)) return err("อีเมลไม่ถูกต้อง"); return setDone(ctx, { notifyEmail: em }, `✅ แจ้งเตือนจองใหม่ไปที่ ${em}`); }
    case "address": if (t.length > 300) return err("ยาวไม่เกิน 300 ตัวอักษร"); return setDone(ctx, { address: t }, "✅ อัปเดตที่อยู่แล้ว");
    case "ppid": {
      const dg = thaiDigits(t).replace(/\D/g, "");
      if (!((dg.length === 10 && dg.startsWith("0")) || dg.length === 13)) return err("ใส่เบอร์ 10 หลัก (ขึ้นต้น 0) หรือเลขบัตร 13 หลัก");
      return ask(ctx, "set", "ppname", { ppid: dg }, text("ชื่อบัญชีที่จะแสดงคู่ QR (เช่น ชื่อที่พัก หรือชื่อเจ้าของบัญชี)", [q("ใช้ชื่อที่พัก", "a=st&ppn=hotel", "ใช้ชื่อที่พัก"), qCancel()]));
    }
    case "ppname": {
      const d = ctx.chat.data || {};
      if (!d.ppid) return stale(ctx);
      if (t.length > 60) return err("ยาวไม่เกิน 60 ตัวอักษร");
      return setDone(ctx, { promptpayId: d.ppid, promptpayName: t }, "✅ ตั้ง PromptPay แล้ว — แขกสแกน QR จ่ายได้ทันที");
    }
    case "cxdays": {
      const n = parseNum(t);
      if (n == null || n > 60) return err("พิมพ์จำนวนวัน 0–60");
      return setDone(ctx, { allowGuestCancel: true, cancelDays: n }, `✅ แขกยกเลิกฟรีได้ก่อนเช็คอิน ${n} วัน`);
    }
    case "cover": return ctx.say(text("ส่งเป็น “รูป” ได้เลย 📷", [qRoll(), qCam(), qCancel()]));
    case "amen": return amenText(ctx, t);
  }
  return stale(ctx);
}

// ลิงก์เข้าเว็บหลังบ้าน (ใช้ครั้งเดียว 10 นาที)
async function aMagic(ctx) {
  const h = ctx.hotel;
  let userId = ctx.chat.user;
  if (userId) {
    const u = await User.findById(userId).lean();
    if (!u || String(u.hotel) !== String(h._id)) userId = null;
  }
  if (!userId) {
    const u = await User.findOne({ hotel: h._id, role: "owner" }).sort("createdAt").lean();
    userId = u && u._id;
  }
  if (!userId) return ctx.say(text("ยังไม่มีบัญชีเว็บของที่พักนี้ — ติดต่อทีมงานเพื่อสร้างให้", [q("💬 คุยกับทีมงาน", "a=sup", "ขอคุยกับทีมงาน")]));
  const code = await issueMagic(h._id, userId);
  ctx.say(flex("ลิงก์เข้าเว็บหลังบ้าน (ใช้ได้ 10 นาที)", bubble({
    tag: "💻 เว็บหลังบ้าน", title: "เข้าหน้าจัดการเต็ม", sub: "ปฏิทิน รายงาน โปรโมชัน ราคาตามฤดู ใบเสร็จ ฯลฯ",
    lines: [T("🔒 ลิงก์ใช้ได้ครั้งเดียว ภายใน 10 นาที — อย่าส่งต่อให้คนอื่น", { size: "xs", color: C.amber, margin: "md" })],
    buttons: [btn(uri("💻 เปิดหน้าจัดการ", `${B()}/login.html?magic=${code}`))],
  }), mainQuick()));
}

// ================================================================ การจอง
const PAY_CH = ["direct", "walkin", "phone", "line", "other"];
const roomNames = async (hid) => {
  const rts = await RoomType.find({ hotel: hid }).select("name").lean();
  const m = {}; rts.forEach((r) => { m[String(r._id)] = r.name; }); return m;
};
const telBtn = (tel) => { const d = String(tel || "").replace(/[^\d+]/g, ""); return d.length >= 9 ? btn(uri("📞 โทรหาแขก", "tel:" + d), "link") : null; };

async function aBookings(ctx, p = {}) {
  const h = ctx.hotel;
  if (p.v === "pay") return showPayList(ctx);
  if (p.v === "today") return showToday(ctx);
  if (p.v === "week") return showWeek(ctx);
  const today = todayTH();
  const q0 = { hotel: h._id, status: { $ne: "cancelled" } };
  const [arr, dep, inh, rep, unpaid, week] = await Promise.all([
    Booking.countDocuments({ ...q0, checkin: today }),
    Booking.countDocuments({ ...q0, checkout: today }),
    Booking.countDocuments({ ...q0, checkin: { $lte: today }, checkout: { $gt: today } }),
    Booking.countDocuments({ ...q0, payStatus: "reported", checkout: { $gte: today } }),
    Booking.countDocuments({ ...q0, payStatus: { $in: ["unpaid", ""] }, channel: { $in: PAY_CH }, checkout: { $gte: today } }),
    Booking.countDocuments({ ...q0, checkin: { $gt: today, $lte: addDays(today, 7) } }),
  ]);
  ctx.say(flex("การจอง " + h.name, bubble({
    tag: `📅 การจอง · ${thDow(today)} ${thDate(today)}`, title: h.name,
    lines: [
      kv("🟢 เช็คอินวันนี้", arr + " ราย"), kv("🔵 เช็คเอาท์วันนี้", dep + " ราย"),
      kv("🏠 กำลังพักอยู่", inh + " ห้อง"), kv("📆 7 วันข้างหน้า", week + " การจอง"),
      sep(),
      kv("💸 แจ้งโอนรอตรวจ", rep + " รายการ", rep ? { color: C.amber, weight: "bold" } : {}),
      kv("⏳ ยังไม่ชำระ", unpaid + " รายการ"),
    ],
    buttons: [
      btn(pb(`💸 ตรวจเงิน (${rep + unpaid})`, "a=bk&v=pay", "รายการรอตรวจเงิน")),
      btn(pb("🟢 เข้า-ออกวันนี้", "a=bk&v=today", "เข้า-ออกวันนี้"), "secondary"),
      btn(pb("📆 7 วันข้างหน้า", "a=bk&v=week", "7 วันข้างหน้า"), "secondary"),
      btn(pb("➕ บันทึกการจองเอง", "a=nb", "บันทึกการจอง (walk-in/โทร)"), "secondary"),
      btn(pb("💻 ปฏิทินเต็มบนเว็บ", "a=magic", "เปิดเว็บหลังบ้าน"), "link"),
    ],
  }), [q("💸 ตรวจเงิน", "a=bk&v=pay", "รายการรอตรวจเงิน"), q("➕ บันทึกการจอง", "a=nb", "บันทึกการจอง"), qMenu()]));
}

async function showPayList(ctx) {
  const h = ctx.hotel, today = todayTH();
  const list = await Booking.find({
    hotel: h._id, status: { $ne: "cancelled" }, checkout: { $gte: today },
    $or: [{ payStatus: "reported" }, { payStatus: { $in: ["unpaid", ""] }, channel: { $in: PAY_CH } }],
  }).sort({ checkin: 1 }).limit(40).lean();
  list.sort((a, b) => (a.payStatus === "reported" ? 0 : 1) - (b.payStatus === "reported" ? 0 : 1) || (a.checkin < b.checkin ? -1 : 1));
  if (!list.length) return ctx.say(text("🎉 ไม่มีรายการค้างตรวจเงิน", [q("📅 การจอง", "a=bk", "การจอง"), qMenu()]));
  const rn = await roomNames(h._id);
  const top = list.slice(0, 10);
  const bubbles = top.map((b) => bubble({
    size: "kilo",
    tag: b.payStatus === "reported" ? "💸 แขกแจ้งโอนแล้ว · รอตรวจ" : "⏳ ยังไม่ชำระ", tagColor: b.payStatus === "reported" ? C.amber : C.muted,
    title: b.guestName || "แขก", sub: b.ref || "",
    lines: [
      kv("ห้อง", rn[String(b.roomType)] || "-"),
      kv("เข้าพัก", `${thDate(b.checkin)} → ${thDate(b.checkout)}`),
      kv("ยอด", money(b.amount)),
      b.payRef ? kv("อ้างอิงโอน", b.payRef) : null,
      b.guestTel ? kv("โทร", b.guestTel) : null,
    ],
    buttons: [btn(pb("✅ ได้รับเงินแล้ว", "a=bp&id=" + b._id, "ยืนยันรับเงิน " + (b.ref || ""))), telBtn(b.guestTel)],
  }));
  ctx.say(
    text(`💸 รอตรวจเงิน ${list.length} รายการ${list.length > 10 ? " (แสดง 10 รายการแรก)" : ""}\nเช็กยอดเข้าบัญชีก่อน แล้วกด “✅ ได้รับเงินแล้ว”`),
    flex("รายการรอตรวจเงิน", carousel(bubbles), [q("📅 การจอง", "a=bk", "การจอง"), qMenu()]),
  );
}

async function aMarkPaid(ctx, p) {
  if (!isId(p.id)) return;
  const b = await Booking.findOne({ _id: p.id, hotel: ctx.hotel._id }).lean();
  if (!b) return ctx.say(text("ไม่พบการจองนี้", [q("📅 การจอง", "a=bk", "การจอง")]));
  if (b.payStatus === "paid") return ctx.say(text(`การจอง ${b.ref || ""} ยืนยันรับเงินไปแล้ว ✅`, [q("💸 รายการอื่น", "a=bk&v=pay", "รายการรอตรวจเงิน"), qMenu()]));
  const g = /^(BP-[A-Z0-9]{6})(-\d+)?$/.exec(String(b.ref || ""));
  const filter = g ? { hotel: ctx.hotel._id, ref: new RegExp("^" + escRe(g[1]) + "(-\\d+)?$"), status: { $ne: "cancelled" } } : { _id: b._id };
  const r = await Booking.updateMany(filter, { $set: { payStatus: "paid" } });
  ctx.say(text(`✅ ยืนยันรับเงินแล้ว\n${b.ref || ""} · ${b.guestName || "แขก"}\nเข้าพัก ${thDate(b.checkin)} → ${thDate(b.checkout)}${r.modifiedCount > 1 ? `\n(${r.modifiedCount} ห้องในการจองเดียวกัน)` : ""}`, [q("💸 รายการอื่น", "a=bk&v=pay", "รายการรอตรวจเงิน"), qMenu()]));
}

async function showToday(ctx) {
  const h = ctx.hotel, today = todayTH();
  const q0 = { hotel: h._id, status: { $ne: "cancelled" } };
  const [arr, dep, inh] = await Promise.all([
    Booking.find({ ...q0, checkin: today }).lean(),
    Booking.find({ ...q0, checkout: today }).lean(),
    Booking.countDocuments({ ...q0, checkin: { $lt: today }, checkout: { $gt: today } }),
  ]);
  const rn = await roomNames(h._id);
  const line = (b) => `• ${b.guestName || "-"}${b.guestTel ? " (" + b.guestTel + ")" : ""} — ${rn[String(b.roomType)] || "ห้อง"}${b.pax ? " · " + b.pax + " คน" : ""}${b.payStatus === "paid" ? " ✅" : b.payStatus === "reported" ? " 💸" : ""}`;
  ctx.say(text(
    `📋 วันนี้ ${thDow(today)} ${thDate(today)} — ${h.name}\n\n` +
    `🟢 เช็คอิน ${arr.length} ราย\n${arr.map(line).join("\n") || "— ไม่มี —"}\n\n` +
    `🔵 เช็คเอาท์ ${dep.length} ราย\n${dep.map(line).join("\n") || "— ไม่มี —"}\n\n` +
    `🏠 พักต่อจากเมื่อวาน ${inh} ห้อง`,
    [q("📆 7 วันข้างหน้า", "a=bk&v=week", "7 วันข้างหน้า"), q("💸 ตรวจเงิน", "a=bk&v=pay", "รายการรอตรวจเงิน"), qMenu()]));
}

async function showWeek(ctx) {
  const h = ctx.hotel, today = todayTH();
  const list = await Booking.find({ hotel: h._id, status: { $ne: "cancelled" }, checkin: { $gte: today, $lte: addDays(today, 7) } }).sort({ checkin: 1 }).limit(60).lean();
  if (!list.length) return ctx.say(text("📆 7 วันข้างหน้ายังไม่มีการจองเข้าพัก", [q("➕ บันทึกการจอง", "a=nb", "บันทึกการจอง"), qMenu()]));
  const rn = await roomNames(h._id);
  const by = {};
  list.forEach((b) => { (by[b.checkin] = by[b.checkin] || []).push(b); });
  const body = Object.keys(by).sort().map((d) => `📅 ${thDow(d)} ${thDate(d)}\n` + by[d].map((b) =>
    `• ${b.guestName || "-"} — ${rn[String(b.roomType)] || "ห้อง"} · ${nightsOf(b.checkin, b.checkout)} คืน · ${money(b.amount)} ${b.payStatus === "paid" ? "✅" : b.payStatus === "reported" ? "💸" : "⏳"}`).join("\n")).join("\n\n");
  ctx.say(text(`📆 เข้าพัก 7 วันข้างหน้า (${list.length} การจอง)\n✅ จ่ายแล้ว · 💸 แจ้งโอน · ⏳ ยังไม่จ่าย\n\n${body}`, [q("💸 ตรวจเงิน", "a=bk&v=pay", "รายการรอตรวจเงิน"), qMenu()]));
}

// ---------- บันทึกการจองเอง (walk-in / โทร / ช่องทางอื่น) → กันห้องบนเว็บ ----------
async function askNb(ctx, step, d) {
  const today = todayTH();
  switch (step) {
    case "din":
      return ask(ctx, "nb", "din", d, text(`📅 2/6 · วันเข้าพัก (${d.rtName})\nกดเลือกจากปฏิทิน หรือพิมพ์ เช่น 25/10`, [
        qDate("📅 เลือกวันเข้าพัก", "a=nb&s=din", { initial: today, min: addDays(today, -30) }),
        q("วันนี้", "a=nb&s=din&d=" + today, "เข้าพักวันนี้"), q("พรุ่งนี้", "a=nb&s=din&d=" + addDays(today, 1), "เข้าพักพรุ่งนี้"), qCancel()]));
    case "dout":
      return ask(ctx, "nb", "dout", d, text(`📅 3/6 · เช็คเอาท์วันไหน? (เข้า ${thDate(d.din)})\nเลือกจำนวนคืน หรือเลือกวันจากปฏิทิน`, [
        q("1 คืน", "a=nb&s=nights&n=1", "1 คืน"), q("2 คืน", "a=nb&s=nights&n=2", "2 คืน"), q("3 คืน", "a=nb&s=nights&n=3", "3 คืน"),
        qDate("📅 เลือกวันออก", "a=nb&s=dout", { initial: addDays(d.din, 1), min: addDays(d.din, 1), max: addDays(d.din, 60) }), qCancel()]));
    case "name":
      return ask(ctx, "nb", "name", d, text("👤 4/6 · ชื่อแขก", [q("ไม่ระบุชื่อ", "a=nb&s=noname", "ไม่ระบุชื่อ"), qCancel()]));
    case "tel":
      return ask(ctx, "nb", "tel", d, text("📞 5/6 · เบอร์แขก", [q("⏭ ข้าม", "a=nb&s=notel", "ข้าม"), qCancel()]));
    case "ch":
      return ask(ctx, "nb", "ch", d, text("📲 6/6 · จองมาทางไหน?", Object.entries(CHS).map(([k, v]) => q(v, "a=nb&s=ch&v=" + k, "จองทาง " + v)).concat(qCancel())));
    case "amt": {
      const rt = await RoomType.findById(d.rt).lean();
      const n = nightsOf(d.din, d.dout);
      const sug = rt ? rateFor(rt, d.din).price * n : 0;
      return ask(ctx, "nb", "amt", d, text(`💰 ยอดรวม ${n} คืน (บาท)\nพิมพ์ยอด หรือกดใช้ราคาห้อง`, [sug ? q("ใช้ " + money(sug), "a=nb&s=amt&v=" + sug, "ยอด " + money(sug)) : null, q("ไม่ระบุ (0)", "a=nb&s=amt&v=0", "ไม่ระบุยอด"), qCancel()]));
    }
  }
}

async function nbCheck(ctx, d) {
  const rt = await RoomType.findOne({ _id: d.rt, hotel: ctx.hotel._id }).lean();
  if (!rt) return { ok: false, msg: "ไม่พบห้องนี้แล้ว" };
  const booked = await Booking.countDocuments({ roomType: rt._id, status: { $ne: "cancelled" }, checkin: { $lt: d.dout }, checkout: { $gt: d.din } });
  return booked >= rt.qty ? { ok: false, msg: `❌ “${rt.name}” เต็มช่วง ${thDate(d.din)} → ${thDate(d.dout)} (จองแล้ว ${booked}/${rt.qty} ห้อง)` } : { ok: true, rt, booked };
}

async function nbSetDates(ctx, which, date) {
  const d = { ...(ctx.chat.data || {}) };
  const today = todayTH();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return ctx.say(text("วันที่ไม่ถูกต้อง ลองใหม่ เช่น 25/10", [qCancel()]));
  if (which === "din") {
    if (date < addDays(today, -30) || date > addDays(today, 730)) return ctx.say(text("เลือกวันเข้าพักภายใน 2 ปีนี้", [qCancel()]));
    d.din = date; delete d.dout;
    return askNb(ctx, "dout", d);
  }
  if (!d.din) return askNb(ctx, "din", d);
  if (date <= d.din) return ctx.say(text("วันออกต้องหลังวันเข้าพัก", [qCancel()]));
  if (nightsOf(d.din, date) > 60) return ctx.say(text("บันทึกได้ไม่เกิน 60 คืนต่อครั้ง", [qCancel()]));
  d.dout = date;
  const c = await nbCheck(ctx, d);
  if (!c.ok) return ask(ctx, "nb", "dout", d, text(c.msg, [q("📅 เปลี่ยนวัน", "a=nb&s=redate", "เปลี่ยนวัน"), q("🛏 เปลี่ยนห้อง", "a=nb", "เปลี่ยนห้อง"), qCancel()]));
  return askNb(ctx, "name", d);
}

async function aNewBooking(ctx, p = {}, params = {}) {
  const h = ctx.hotel;
  if (!p.s) {
    const rooms = await RoomType.find({ hotel: h._id }).sort("sort").lean();
    if (!rooms.length) return ctx.say(text("ยังไม่มีห้อง — เพิ่มห้องก่อนนะ", [q("🛏 เพิ่มห้อง", "a=add&t=room", "เพิ่มห้องพัก"), qMenu()]));
    return ask(ctx, "nb", "room", {}, text("➕ บันทึกการจองเอง (walk-in / โทร / ช่องทางอื่น)\nห้องจะถูกกันไว้บนเว็บอัตโนมัติ กันจองซ้อน\n\n1/6 · ห้องไหน?",
      rooms.slice(0, 12).map((r) => q("🛏 " + r.name, "a=nb&s=room&id=" + r._id, r.name)).concat(qCancel())));
  }
  if (ctx.chat.flow !== "nb") return stale(ctx);
  const d = { ...(ctx.chat.data || {}) };
  switch (p.s) {
    case "room": {
      if (!isId(p.id)) return stale(ctx);
      const rt = await RoomType.findOne({ _id: p.id, hotel: h._id }).lean();
      if (!rt) return stale(ctx);
      d.rt = String(rt._id); d.rtName = rt.name;
      return askNb(ctx, "din", d);
    }
    case "din": return nbSetDates(ctx, "din", params.date || p.d);
    case "dout": return nbSetDates(ctx, "dout", params.date || p.d);
    case "nights": { if (!d.din) return askNb(ctx, "din", d); const n = Math.max(1, Math.min(60, parseInt(p.n, 10) || 1)); return nbSetDates(ctx, "dout", addDays(d.din, n)); }
    case "redate": delete d.din; delete d.dout; return askNb(ctx, "din", d);
    case "noname": d.name = "Walk-in"; return askNb(ctx, "tel", d);
    case "notel": d.tel = ""; return askNb(ctx, "ch", d);
    case "ch": d.ch = CHS[p.v] ? p.v : "walkin"; return askNb(ctx, "amt", d);
    case "amt": d.amt = Math.max(0, parseInt(p.v, 10) || 0); return nbConfirm(ctx, d);
    case "save": return nbSave(ctx, p.paid === "1");
  }
  return stale(ctx);
}

async function nbText(ctx, t) {
  const d = { ...(ctx.chat.data || {}) };
  switch (ctx.chat.step) {
    case "room": {
      const rt = await RoomType.findOne({ hotel: ctx.hotel._id, name: new RegExp("^" + escRe(t) + "$", "i") }).lean();
      if (!rt) return ctx.say(text("กดเลือกห้องจากปุ่มด้านล่างนะ", [qCancel()]));
      d.rt = String(rt._id); d.rtName = rt.name; return askNb(ctx, "din", d);
    }
    case "din": case "dout": {
      const iso = parseDate(t);
      if (!iso) return ctx.say(text("อ่านวันที่ไม่ออก ลองพิมพ์ เช่น 25/10 หรือ 25 ต.ค.", [qCancel()]));
      return nbSetDates(ctx, ctx.chat.step, iso);
    }
    case "name": if (t.length > 60) return ctx.say(text("ชื่อยาวไม่เกิน 60 ตัวอักษร", [qCancel()])); d.name = t; return askNb(ctx, "tel", d);
    case "tel": {
      if (/^(ข้าม|ไม่มี|-)$/.test(t)) { d.tel = ""; return askNb(ctx, "ch", d); }
      const ph = normPhone(t);
      if (!ph) return ctx.say(text("เบอร์ไม่ถูกต้อง เช่น 0812345678 หรือกดข้าม", [q("⏭ ข้าม", "a=nb&s=notel", "ข้าม"), qCancel()]));
      d.tel = ph; return askNb(ctx, "ch", d);
    }
    case "ch": return ctx.say(text("กดเลือกช่องทางจากปุ่มด้านล่างนะ", Object.entries(CHS).map(([k, v]) => q(v, "a=nb&s=ch&v=" + k, "จองทาง " + v)).concat(qCancel())));
    case "amt": { const n = parseNum(t); if (n == null || n > 5000000) return ctx.say(text("พิมพ์ยอดเป็นตัวเลข เช่น 2400", [qCancel()])); d.amt = n; return nbConfirm(ctx, d); }
    case "confirm": return ctx.say(text("กดปุ่ม “✅ บันทึก” ด้านบน หรือ “ยกเลิก”", [qCancel()]));
  }
  return stale(ctx);
}

async function nbConfirm(ctx, d) {
  await setFlow(ctx, "nb", "confirm", d);
  const ota = ["agoda", "booking", "trip"].includes(d.ch);
  const buttons = ota
    ? [btn(pb("✅ บันทึก", "a=nb&s=save&paid=0", "บันทึกการจอง"))]
    : [btn(pb("✅ บันทึก (จ่ายแล้ว)", "a=nb&s=save&paid=1", "บันทึก (จ่ายแล้ว)")), btn(pb("✅ บันทึก (ค้างจ่าย)", "a=nb&s=save&paid=0", "บันทึก (ยังไม่จ่าย)"), "secondary")];
  buttons.push(btn(pb("ยกเลิก", "a=x", "ยกเลิก"), "link"));
  ctx.say(flex("ตรวจก่อนบันทึกการจอง", bubble({
    tag: "ตรวจก่อนบันทึก ✍️", title: d.name || "แขก",
    lines: [
      kv("ห้อง", d.rtName), kv("เข้าพัก", `${thDate(d.din)} → ${thDate(d.dout)}`), kv("จำนวน", nightsOf(d.din, d.dout) + " คืน"),
      kv("เบอร์", d.tel || "—"), kv("ช่องทาง", CHS[d.ch] || d.ch), kv("ยอด", money(d.amt)),
    ],
    buttons,
  })));
}

async function nbSave(ctx, paid) {
  const claimed = await LineChat.findOneAndUpdate({ _id: ctx.chat._id, flow: "nb", step: "confirm" }, { $set: { step: "saving" } }).lean();
  if (!claimed) return stale(ctx);
  const d = claimed.data || {};
  const c = await nbCheck(ctx, d);
  if (!c.ok) { await setFlow(ctx, "nb", "dout", d); return ctx.say(text(c.msg, [q("📅 เปลี่ยนวัน", "a=nb&s=redate", "เปลี่ยนวัน"), q("🛏 เปลี่ยนห้อง", "a=nb", "เปลี่ยนห้อง"), qCancel()])); }
  const ota = ["agoda", "booking", "trip"].includes(d.ch);
  const b = await Booking.create({
    hotel: ctx.hotel._id, roomType: c.rt._id, guestName: d.name || "Walk-in", guestTel: d.tel || "",
    channel: d.ch || "walkin", checkin: d.din, checkout: d.dout, pax: c.rt.capacity || 1, amount: d.amt || 0,
    status: "confirmed", payStatus: ota ? "" : paid ? "paid" : "unpaid", payMethod: ota ? "ota" : paid ? "cash" : "",
    notifyChannel: "none", ref: "BP-" + Date.now().toString(36).toUpperCase().slice(-6), note: "บันทึกผ่าน LINE",
  });
  await clearFlow(ctx);
  ctx.say(text(`✅ บันทึกการจองแล้ว ${b.ref}\n${b.guestName} · ${d.rtName}\n${thDate(b.checkin)} → ${thDate(b.checkout)} (${nightsOf(b.checkin, b.checkout)} คืน) · ${money(b.amount)}\nห้องนี้ถูกกันบนเว็บแล้ว ✔`, [q("➕ บันทึกอีก", "a=nb", "บันทึกการจอง"), q("📅 การจอง", "a=bk", "การจอง"), qMenu()]));
}

// ================================================================ OTA
const OTA_SIGNUP = {
  agoda: ["1) ค้นหา “Agoda list your property” (สมัครฟรี)", "2) สร้างบัญชี → ใส่ข้อมูล รูป ห้อง ราคา", "3) Agoda ตรวจ ~3 วัน แล้วส่งสัญญาทางอีเมล", "4) เซ็นสัญญา → ได้ Agoda Hotel ID", "ที่พัก 1 หลัง/บ้านทั้งหลัง สมัครแบบ Agoda Homes"],
  booking: ["1) ไปที่ join.booking.com → List your property (ฟรี)", "2) ใส่ข้อมูล ที่อยู่ รูป ≥10 รูป ห้อง ราคา นโยบาย", "3) ยืนยันตัวตน + บัญชีรับเงิน + เลขภาษี", "4) ได้ Property ID (ตัวเลขบนหน้า Extranet)", "อาจมีจดหมายยืนยันส่งไปที่อยู่ที่พัก"],
  airbnb: ["1) airbnb.com → “Airbnb your home”", "2) สร้างประกาศ: ห้อง รูป ราคา กฎบ้าน", "3) ยืนยันตัวตน + ใส่บัญชีรับเงิน", "4) เปิดประกาศ → ได้ลิงก์ airbnb.com/rooms/…"],
  trip: ["1) ค้นหา “Trip.com list your property” (ฟรี)", "2) สร้างบัญชี eBooking", "3) กรอกชื่อ/ที่อยู่ภาษาอังกฤษ รูป ข้อมูลรับเงิน", "4) เซ็นสัญญาออนไลน์ → ได้ Hotel ID"],
};
const OTA_ID_PROMPT = {
  agoda: "🔢 พิมพ์ Agoda Hotel ID\n(ตัวเลขที่มุมบนของ Agoda Partner Portal / YCS)",
  booking: "🔢 พิมพ์ Booking.com Property ID\n(ตัวเลขด้านบนของหน้า Extranet)",
  airbnb: "🔗 วางลิงก์ประกาศ Airbnb\n(เช่น airbnb.com/rooms/12345678)",
  trip: "🔢 พิมพ์ Trip.com Hotel ID\n(จากหน้า eBooking)",
};
const OTA_NEXT = {
  booking: "ขั้นต่อไป (ทำใน Booking.com): Extranet → Account → Connectivity provider → ค้นหา “Channex” → เลือกและยอมรับ",
  agoda: "ขั้นต่อไป (ทำใน Agoda): Partner Portal → Property Settings → Optional Settings → Channel manager → เลือก “Channex” (ถ้าไม่เจอ ทักแชท Agoda ขอเชื่อม Channex)",
  airbnb: "ขั้นต่อไป: ทีมงานจะส่งลิงก์ให้คุณกดอนุญาตด้วยบัญชี Airbnb ของคุณเอง (ถ้าเคยเชื่อมระบบอื่นไว้ ต้องยกเลิกก่อน)",
  trip: "ขั้นต่อไป: ทีมงานจะประสานกับ Trip.com ให้ — รอทีมงานติดต่อกลับ",
};

async function aOta(ctx, p = {}) {
  const h = await Hotel.findById(ctx.hotel._id).lean();
  ctx.hotel = h;
  const o = OTAS.find((x) => x.k === p.c);
  if (p.s === "req") return ctx.say(text("จะเชื่อม OTA ไหน?", OTAS.map((x) => q(x.name, "a=ota&s=has&c=" + x.k, "ขอเชื่อม " + x.name)).concat(qCancel())));
  if (p.s === "has" && o) return ctx.say(text(`มีบัญชี ${o.name} สำหรับที่พักนี้แล้วหรือยัง?`, [q("✅ มีแล้ว", `a=ota&s=id&c=${o.k}`, "มีบัญชีแล้ว"), q("ยังไม่มี", `a=ota&s=guide&c=${o.k}`, "ยังไม่มีบัญชี"), qCancel()]));
  if (p.s === "guide" && o) {
    return ctx.say(flex("วิธีสมัคร " + o.name, bubble({
      tag: "📘 วิธีสมัคร " + o.name, title: o.name, sub: "สมัครฟรี จ่ายเป็นค่าคอมมิชชันเมื่อมีคนจอง",
      lines: OTA_SIGNUP[o.k].map((l) => T(l, { size: "sm", color: C.navy, margin: "sm" })),
      buttons: [btn(uri("📘 คู่มือเต็ม", B() + "/ota-guide.html#" + o.k)), btn(pb("✅ สมัครแล้ว ส่ง ID", `a=ota&s=id&c=${o.k}`, "ส่ง ID " + o.name), "secondary")],
    })));
  }
  if (p.s === "id" && o) return ask(ctx, "ota", "id", { c: o.k }, text(OTA_ID_PROMPT[o.k], [qCancel()]));
  if (p.s) return stale(ctx);
  const st = (k) => {
    const x = (h.ota || []).find((y) => y.channel === k);
    if (!x) return "⚪ ยังไม่เชื่อม";
    return x.status === 1 ? "✅ เชื่อมแล้ว" : x.status === 3 ? "⏳ ส่งคำขอแล้ว" : x.status === 2 ? "⚠️ ขัดข้อง" : "⚪ ยังไม่เชื่อม";
  };
  ctx.say(flex("OTA ของ " + h.name, bubble({
    tag: "🌐 OTA · ขายห้องบนเว็บจองดัง", title: "เชื่อม OTA", sub: "ห้องว่างและราคาจะซิงก์อัตโนมัติ กันจองซ้อน",
    lines: [
      ...OTAS.map((x) => kv(x.name, st(x.k))),
      T("ระบบซิงก์อัตโนมัติกำลังเปิดให้บริการ — ส่งคำขอไว้ได้เลย ทีมงานจะติดต่อกลับเพื่อเชื่อมให้", { size: "xs", color: C.muted, margin: "md" }),
    ],
    buttons: [
      btn(pb("🔗 ขอเชื่อม OTA", "a=ota&s=req", "ขอเชื่อม OTA")),
      btn(uri("📘 วิธีสมัคร OTA", B() + "/ota-guide.html"), "secondary"),
      btn(pb("💬 ถามทีมงาน", "a=sup", "ขอคุยกับทีมงาน"), "link"),
    ],
  }), [q("🔗 ขอเชื่อม OTA", "a=ota&s=req", "ขอเชื่อม OTA"), qMenu()]));
}

async function otaText(ctx, t) {
  const d = ctx.chat.data || {};
  const o = OTAS.find((x) => x.k === d.c);
  if (!o || ctx.chat.step !== "id") return stale(ctx);
  let id = t.trim();
  if (o.k === "airbnb") { const m = /rooms\/(\d+)/.exec(id); if (m) id = m[1]; }
  if (id.length < 3 || id.length > 120) return ctx.say(text("ID สั้นหรือยาวเกินไป ลองใหม่อีกครั้ง", [qCancel()]));
  const h = await Hotel.findById(ctx.hotel._id).lean();
  const list = (h.ota || []).map((x) => ({ ...x }));
  const i = list.findIndex((x) => x.channel === o.k);
  const rec = { channel: o.k, status: i >= 0 && list[i].status === 1 ? 1 : 3, propertyId: id, requestedAt: new Date() };
  if (i >= 0) list[i] = { ...list[i], ...rec }; else list.push(rec);
  await Hotel.updateOne({ _id: h._id }, { $set: { ota: list } });
  await clearFlow(ctx);
  notifyAdmin(`🌐 ขอเชื่อม OTA: ${o.name}`, [
    `ที่พัก: ${h.name} (${h.slug})`, `${o.name} ID: ${id}`, `โทร: ${h.phone || "-"}`, `LINE: ${ctx.chat.name || "-"}`,
  ]).catch(() => {});
  ctx.say(flex("ส่งคำขอเชื่อม " + o.name + " แล้ว", bubble({
    tag: "✅ ส่งคำขอแล้ว", title: o.name, sub: "ID: " + id,
    lines: [T(OTA_NEXT[o.k], { size: "sm", color: C.navy, margin: "md" }), T("ทีมงานจะติดต่อกลับเมื่อพร้อมเชื่อม", { size: "xs", color: C.muted, margin: "md" })],
    buttons: [btn(uri("📘 ดูขั้นตอนเต็ม", B() + "/ota-guide.html#" + o.k), "secondary")],
  }), [q("🔗 เชื่อม OTA อื่น", "a=ota&s=req", "ขอเชื่อม OTA"), qMenu()]));
}

// ================================================================ บัญชี
async function aAccount(ctx) {
  const h = await Hotel.findById(ctx.hotel._id).lean();
  ctx.hotel = h;
  const many = (ctx.chat.hotels || []).length > 1;
  ctx.say(flex("บัญชี " + h.name, bubble({
    tag: "👤 บัญชี & ช่วยเหลือ", title: h.name,
    lines: [
      kv("สถานะ", h.approved === false ? "⏳ รออนุมัติ" : "✅ เปิดรับจอง"),
      kv("ลิงก์เว็บ", "?h=" + h.slug), kv("LINE ที่เชื่อม", ctx.chat.name || "คุณ"),
      many ? kv("เชื่อมไว้", (ctx.chat.hotels || []).length + " ที่พัก") : null,
    ],
    buttons: [
      btn(pb("📤 ลิงก์+QR ให้ลูกค้า", "a=share", "ขอลิงก์จองให้ลูกค้า")),
      btn(pb("💻 เข้าเว็บหลังบ้าน", "a=magic", "เปิดเว็บหลังบ้าน"), "secondary"),
      many ? btn(pb("🔁 สลับที่พัก", "a=sw", "สลับที่พัก"), "secondary") : null,
      btn(pb("➕ เชื่อมที่พักอื่น", "a=code", "เชื่อมที่พักอื่น"), "secondary"),
      btn(pb("💬 คุยกับทีมงาน", "a=sup", "ขอคุยกับทีมงาน"), "secondary"),
      btn(pb("🚪 เลิกเชื่อม LINE", "a=unlink", "เลิกเชื่อม LINE"), "link", C.red),
    ],
  }), mainQuick()));
}

async function aShare(ctx) {
  const h = ctx.hotel;
  const url = bookUrl(h);
  ctx.say(text(`🔗 ลิงก์จองตรงของ “${h.name}”\n${url}\n\nส่งต่อให้ลูกค้า หรือแปะในโปรไฟล์ Facebook / IG / Google Maps ได้เลย\n(กดค้างที่รูป QR ด้านล่างเพื่อบันทึกไปพิมพ์ติดหน้าที่พัก)`));
  ctx.say(U.image(`${B()}/api/public/qr/${encodeURIComponent(h.slug)}.png`));
}

async function aSwitch(ctx, p = {}) {
  const ids = (ctx.chat.hotels || []).map(String);
  if (p.h) {
    if (!ids.includes(p.h)) return stale(ctx);
    const h = await Hotel.findById(p.h).lean();
    if (!h) { await detachHotel(ctx, p.h); return stale(ctx); }
    await LineChat.updateOne({ _id: ctx.chat._id }, { $set: { hotel: h._id } });
    ctx.chat.hotel = h._id; ctx.hotel = h;
    return ctx.say(hotelMenu(ctx, "สลับมาจัดการที่พักนี้แล้ว ✅"));
  }
  const hs = await Hotel.find({ _id: { $in: ids.filter(isId) } }).select("name").lean();
  return ctx.say(text("จะจัดการที่พักไหน?", hs.slice(0, 12).map((x) => q((String(x._id) === String(ctx.hotel._id) ? "✓ " : "") + x.name, "a=sw&h=" + x._id, "จัดการ " + x.name)).concat(qCancel())));
}

async function aUnlink(ctx, p = {}) {
  const h = ctx.hotel;
  if (p.ok !== "1") {
    return ctx.say(text(`เลิกเชื่อม LINE นี้กับ “${h.name}”?\n(ที่พักและเว็บยังอยู่ครบ — แค่ LINE นี้จะจัดการไม่ได้ จนกว่าจะใส่รหัสใหม่)`, [q("🚪 ยืนยันเลิกเชื่อม", "a=unlink&ok=1", "ยืนยันเลิกเชื่อม"), q("ไม่", "a=acc", "ไม่เลิกเชื่อม")]));
  }
  await detachHotel(ctx, h._id);
  ctx.say(text(`เลิกเชื่อม “${h.name}” แล้ว` + (ctx.hotel ? `\nตอนนี้จัดการ: ${ctx.hotel.name}` : ""), ctx.hotel ? mainQuick() : guestQuick()));
}

// เอาโรงแรมออกจากแชทนี้ (ใช้ทั้งตอนเลิกเชื่อม / โรงแรมถูกลบ / เจ้าของถอดสิทธิ์จากเว็บ)
async function detachHotel(ctx, hid) {
  const rest = (ctx.chat.hotels || []).map(String).filter((x) => x !== String(hid));
  const cur = ctx.chat.hotel && String(ctx.chat.hotel) !== String(hid) ? String(ctx.chat.hotel) : null;
  const next = cur || rest[0] || null;
  await LineChat.updateOne({ _id: ctx.chat._id }, { $set: { hotels: rest, hotel: next } });
  ctx.chat.hotels = rest; ctx.chat.hotel = next;
  ctx.hotel = next ? await Hotel.findById(next).lean() : null;
  if (!ctx.hotel) await unlinkHotelMenu(ctx.uid);
}
export async function detachHotelFromChat(chatId, hotelId) {
  const chat = await LineChat.findById(chatId).lean();
  if (!chat) return false;
  const ctx = makeCtx({}, { ...chat, hotels: chat.hotels || [], data: chat.data || {} });
  await detachHotel(ctx, hotelId);
  return true;
}

// ================================================================ แอดมิน Barn Park
async function aAdminPending(ctx) {
  const list = await Hotel.find({ approved: false }).sort("-createdAt").limit(10).lean();
  if (!list.length) return ctx.say(text("✅ ไม่มีที่พักรออนุมัติ"));
  const owners = await User.find({ hotel: { $in: list.map((h) => h._id) }, role: "owner" }).lean();
  const bubbles = list.map((h) => {
    const o = owners.find((u) => String(u.hotel) === String(h._id));
    return bubble({
      size: "kilo", tag: "⏳ รออนุมัติ", tagColor: C.amber, title: h.name, sub: "📍 " + (h.location || "-"),
      lines: [kv("โทร", h.phone || "-"), kv("อีเมล", (o && o.email) || "-"), kv("สมัครเมื่อ", h.createdAt ? thDate(new Date(h.createdAt).toISOString().slice(0, 10)) : "-")],
      buttons: [btn(pb("✅ อนุมัติ + ส่งรหัส", "a=ap&h=" + h._id, "อนุมัติ " + h.name)), btn(uri("👀 ดูหน้าเว็บ", bookUrl(h)), "link")],
    });
  });
  ctx.say(text(`⏳ ที่พักรออนุมัติ ${list.length} แห่ง`), flex("ที่พักรออนุมัติ", carousel(bubbles)));
}

async function aAdminApprove(ctx, p = {}) {
  if (!isId(p.h)) return;
  const h = await Hotel.findById(p.h).lean();
  if (!h) return ctx.say(text("ไม่พบที่พักนี้"));
  if (h.approved !== false) return ctx.say(text(`“${h.name}” อนุมัติไปแล้ว ✅`));
  const r = await approveHotel(h._id, { base: B() });
  ctx.say(text(`✅ อนุมัติ “${h.name}” แล้ว\nรหัสเชื่อม: ${r.code}\nส่งให้ผู้สมัครทาง LINE: ${r.pushed ? "✅ แล้ว" : "— (สมัครผ่านเว็บ)"}\nส่งอีเมล: ${r.emailed ? "✅ แล้ว" : "—"}`));
}
