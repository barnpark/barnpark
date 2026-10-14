// ===== สมัคร / อนุมัติ / รหัสเชื่อม LINE ของโรงแรม =====
import crypto from "crypto";
import Hotel from "../models/Hotel.js";
import User from "../models/User.js";
import LinkCode from "../models/LinkCode.js";
import LineChat from "../models/LineChat.js";
import * as L from "./line.js";
import * as U from "./lineui.js";
import { sendEmail } from "./notify.js";
import { brevoReady } from "./mailer.js";
import { baseUrl } from "./baseurl.js";

export const slugify = (s) => String(s || "").toLowerCase().trim()
  .replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,29}$/;

export async function isSlugFree(s) { return !(await Hotel.exists({ slug: s })); }

export async function uniqueSlug(base) {
  let b = slugify(base) || "stay";
  if (b.length < 3) b = (b + "-stay").slice(0, 30);
  let s = b, n = 1;
  while (await Hotel.exists({ slug: s })) {
    n++; s = b.slice(0, 26) + "-" + n;
    if (n > 50) { s = b.slice(0, 24) + "-" + crypto.randomBytes(2).toString("hex"); break; }
  }
  return s;
}

// ---------- รหัส ----------
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ตัด O/0/I/1 ที่สับสนง่าย
export function genCode(len = 6) {
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHA[crypto.randomInt(ALPHA.length)];
  return s;
}
export const fmtCode = (c) => (String(c).length === 6 ? c.slice(0, 3) + "-" + c.slice(3) : String(c));
export const normCode = (t) => String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function issueLinkCode(hotelId, userId, days = 7) {
  for (let i = 0; i < 6; i++) {
    const code = genCode(6);
    try {
      await LinkCode.create({ code, purpose: "link", hotel: hotelId, user: userId || undefined, expiresAt: new Date(Date.now() + days * 864e5) });
      return code;
    } catch (e) { if (e?.code !== 11000) throw e; }
  }
  throw new Error("สร้างรหัสไม่สำเร็จ ลองใหม่อีกครั้ง");
}

// ลิงก์เข้าเว็บหลังบ้านแบบใช้ครั้งเดียว (10 นาที)
export async function issueMagic(hotelId, userId) {
  const code = crypto.randomBytes(24).toString("hex");
  await LinkCode.create({ code, purpose: "magic", hotel: hotelId, user: userId, expiresAt: new Date(Date.now() + 10 * 60e3) });
  return code;
}
export async function consumeMagic(code) {
  if (!/^[a-f0-9]{48}$/.test(String(code || ""))) return null;
  return LinkCode.findOneAndUpdate(
    { code, purpose: "magic", usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } }, { new: true });
}

// ---------- LINE OA ของ Barn Park ----------
export function oaId() {
  if (process.env.LINE_OA_ID) return process.env.LINE_OA_ID.trim();
  const m = /\/ti\/p\/(@?[\w.-]+)/.exec(process.env.SUPPORT_LINE_URL || "");
  return m ? decodeURIComponent(m[1]) : "";
}
export const oaAddUrl = () => process.env.SUPPORT_LINE_URL || (oaId() ? "https://line.me/R/ti/p/" + encodeURIComponent(oaId()) : "");
// ลิงก์เปิดแชท OA พร้อมพิมพ์ข้อความไว้ให้ (กดส่งอย่างเดียว)
export const oaPrefillUrl = (text) => (oaId() ? "https://line.me/R/oaMessage/" + encodeURIComponent(oaId()) + "/?" + encodeURIComponent(text) : oaAddUrl());

// ---------- สมัคร ----------
export async function createHotelWithOwner({ name, slug, location, phone, email, contactName }) {
  const em = String(email || "").toLowerCase().trim();
  if (await User.exists({ email: em })) { const e = new Error("อีเมลนี้มีบัญชีแล้ว"); e.code = "EMAIL_TAKEN"; throw e; }
  let hotel;
  for (let i = 0; i < 3 && !hotel; i++) {
    const s = slug && i === 0 && (await isSlugFree(slug)) ? slug : await uniqueSlug(slug || em.split("@")[0]);
    try {
      hotel = await Hotel.create({
        name, slug: s, location: location || "", phone: phone || "", notifyEmail: em,
        status: "onboarding", approved: false,
        ota: [{ channel: "agoda", status: 0 }, { channel: "booking", status: 0 }, { channel: "trip", status: 0 }],
      });
    } catch (e) { if (e?.code !== 11000) throw e; }
  }
  if (!hotel) throw new Error("สร้างที่พักไม่สำเร็จ ลองใหม่อีกครั้ง");
  try {
    const owner = await User.create({ email: em, role: "owner", name: contactName || name, hotel: hotel._id });
    return { hotel, owner };
  } catch (e) {
    await Hotel.deleteOne({ _id: hotel._id });
    throw e;
  }
}

// ---------- อนุมัติ (แอดมิน) → ออกรหัสเชื่อม → ส่งให้ผู้สมัครทาง LINE + อีเมล ----------
export function approvedMessage(h, code) {
  return U.flex("อนุมัติแล้ว! รหัสเชื่อมของคุณ " + fmtCode(code), U.bubble({
    tag: "BARN PARK · อนุมัติแล้ว 🎉",
    title: h.name,
    sub: "ที่พักของคุณพร้อมเปิดรับจองแล้ว",
    lines: [
      U.box([
        U.T("รหัสเชื่อม LINE ของคุณ", { size: "xs", color: U.C.muted, align: "center" }),
        U.T(fmtCode(code), { size: "3xl", weight: "bold", color: U.C.teal, align: "center" }),
      ], { backgroundColor: U.C.soft, cornerRadius: "12px", paddingAll: "12px", margin: "md" }),
      U.T("กดปุ่มด้านล่าง แล้วเมนูจัดการที่พักจะเปิดให้ทันที · รหัสใช้ได้ 7 วัน ครั้งเดียว", { size: "xs", color: U.C.muted, margin: "md" }),
    ],
    buttons: [U.btn(U.pb("🔑 เชื่อมเลย", "a=code&c=" + code, "ใช้รหัส " + fmtCode(code)))],
  }));
}

export async function approveHotel(hotelId, { base } = {}) {
  const h = await Hotel.findById(hotelId);
  if (!h) throw new Error("ไม่พบที่พัก");
  await Hotel.updateOne({ _id: h._id }, { $set: { approved: true, status: "active" } });
  const owner = await User.findOne({ hotel: h._id, role: "owner" }).sort("createdAt");
  const code = await issueLinkCode(h._id, owner?._id);
  const B = base || baseUrl();
  let pushed = false, emailed = false;

  const chat = await LineChat.findOne({ pendingHotel: h._id }).lean();
  if (chat && L.lineReady()) {
    try { await L.push(chat.userId, [approvedMessage(h, code)]); pushed = true; }
    catch (e) { console.error("approve push", e.message); }
  }
  if (owner?.email && brevoReady()) {
    const add = oaAddUrl(), pre = oaPrefillUrl("เชื่อม " + fmtCode(code));
    const html = `<div style="font-family:sans-serif;max-width:520px;margin:auto;color:#0f2540">
      <h2 style="color:#0d9488;margin:0 0 8px">อนุมัติแล้ว 🎉 — ${esc(h.name)}</h2>
      <p>ที่พักของคุณพร้อมเปิดรับจองบน BARN-PARK แล้ว</p>
      <p style="margin:16px 0 4px;color:#5b7089">รหัสเชื่อม LINE (ใช้ได้ 7 วัน)</p>
      <p style="font-size:30px;font-weight:800;letter-spacing:4px;margin:0 0 16px">${fmtCode(code)}</p>
      <p><b>จัดการที่พักผ่าน LINE (ง่ายสุด):</b><br>
      1) แอด LINE Barn Park ${add ? `<a href="${add}">${add}</a>` : ""}<br>
      2) กด "มีรหัสแล้ว" ที่เมนู แล้วพิมพ์รหัสด้านบน${pre ? ` — หรือ <a href="${pre}">กดลิงก์นี้บนมือถือ</a> แล้วกดส่ง` : ""}<br>
      3) เมนูจัดการจะเปิดให้ เพิ่มห้อง/กิจกรรม ตั้งค่าเว็บ ดูการจอง ได้ในแชทเลย</p>
      ${B ? `<p>ลิงก์หน้าจองของคุณ: <a href="${B}/book.html?h=${h.slug}">${B}/book.html?h=${h.slug}</a></p>` : ""}
      <p style="color:#94a3b8;font-size:12px">ส่งอัตโนมัติโดย BARN-PARK</p></div>`;
    try { await sendEmail(owner.email, `อนุมัติแล้ว: ${h.name} — รหัสเชื่อม LINE ${fmtCode(code)}`, html); emailed = true; }
    catch (e) { console.error("approve email", e.message); }
  }
  return { code: fmtCode(code), pushed, emailed, hotel: { id: h._id, name: h.name, slug: h.slug } };
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
