// ===== ประกาศอัปเดตระบบ → แจ้งทุกที่พักที่เชื่อม LINE Barn Park ว่ามีอะไรใหม่ + ที่พักนั้นยังขาดอะไร =====
// ส่ง 1 push ต่อ 1 คน (ข้อความประกาศ + การ์ดเช็กลิสต์ของทุกที่พักที่คนนั้นดูแล) → นับโควตา LINE คนละ 1 ข้อความ
import Hotel from "../models/Hotel.js";
import LineChat from "../models/LineChat.js";
import Setting from "../models/Setting.js";
import * as L from "./line.js";
import * as U from "./lineui.js";
import { checklist } from "./checklist.js";
import { sendEmail } from "./notify.js";
import { baseUrl } from "./baseurl.js";

const BREVO = () => process.env.BREVO_API_KEY || "";
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// การ์ดเช็กลิสต์ของ 1 ที่พัก (ใช้ทั้งในประกาศ และปุ่ม "เช็กความครบ" ใน LINE)
export function checklistBubble(h, c) {
  const B = baseUrl();
  const hh = "&hh=" + h._id;
  const bar = U.box([U.box([], { width: Math.max(4, c.pct) + "%", height: "8px", backgroundColor: c.pct === 100 ? U.C.green : U.C.teal, cornerRadius: "4px" })],
    { height: "8px", backgroundColor: U.C.line, cornerRadius: "4px", margin: "md" });
  const miss = [...c.missing].sort((a, b) => (b.must ? 1 : 0) - (a.must ? 1 : 0));
  const lines = [bar, U.T(`ครบแล้ว ${c.done}/${c.total} (${c.pct}%)`, { size: "xs", color: U.C.muted, margin: "sm" })];
  if (!miss.length) lines.push(U.T("🎉 ครบทุกอย่างแล้ว พร้อมรับจอง!", { size: "sm", color: U.C.green, weight: "bold", margin: "md" }));
  else {
    lines.push(U.T("ยังขาด:", { size: "sm", color: U.C.navy, weight: "bold", margin: "md" }));
    for (const it of miss.slice(0, 8)) lines.push(U.T(`${it.must ? "🔴" : "⚪️"} ${it.label}`, { size: "sm", color: U.C.navy, margin: "xs" }));
    if (miss.length > 8) lines.push(U.T(`…และอีก ${miss.length - 8} อย่าง`, { size: "xs", color: U.C.muted }));
    lines.push(U.T("🔴 = ควรทำก่อนเปิดรับจอง", { size: "xxs", color: U.C.muted, margin: "md" }));
  }
  return U.bubble({
    tag: "✅ เช็กความครบ", tagColor: c.mustMissing.length ? U.C.amber : U.C.teal,
    title: h.name, lines,
    buttons: [
      ...miss.slice(0, 4).map((it, i) => U.btn(U.pb(it.fixLabel, it.fix + hh, it.fixLabel), i === 0 ? "primary" : "secondary")),
      B && h.slug ? U.btn(U.uri("🔗 เปิดดูเว็บ", `${B}/book.html?h=${encodeURIComponent(h.slug)}`), "link") : null,
    ],
  });
}

// dryRun = true → แค่นับว่าจะส่งหาใครบ้าง (ไม่ส่งจริง)
export async function announceUpdate({ title, message = "", dryRun = true, email = false, onlyMissing = false }) {
  const hotels = await Hotel.find({ approved: { $ne: false }, status: { $ne: "paused" } }).lean();
  const byId = new Map(hotels.map((h) => [String(h._id), h]));
  const lists = new Map();
  for (const h of hotels) lists.set(String(h._id), await checklist(h));
  const target = hotels.filter((h) => !onlyMissing || lists.get(String(h._id)).missing.length);
  const targetIds = new Set(target.map((h) => String(h._id)));
  const chats = await LineChat.find({ hotels: { $in: target.map((h) => h._id) } }).select("userId hotels").lean();

  const report = {
    dryRun, title,
    hotels: target.map((h) => { const c = lists.get(String(h._id)); return { name: h.name, pct: c.pct, missing: c.missing.map((i) => i.label), linked: chats.filter((x) => x.hotels.map(String).includes(String(h._id))).length, email: !!h.notifyEmail }; }),
    lineUsers: chats.length, lineQuota: chats.length, emails: email && BREVO() ? target.filter((h) => h.notifyEmail).length : 0,
    lineReady: L.lineReady(), sentLine: 0, sentEmail: 0, errors: [],
  };
  if (dryRun) return report;

  const head = `📣 ${title}` + (message ? `\n\n${message}` : "") + "\n\nด้านล่างคือสิ่งที่ที่พักของคุณยังขาด กดปุ่มเพื่อเพิ่มได้เลย 👇";
  for (const chat of chats) {
    const mine = chat.hotels.map(String).filter((id) => targetIds.has(id)).map((id) => byId.get(id)).filter(Boolean).slice(0, 12);
    if (!mine.length) continue;
    const bubbles = mine.map((h) => checklistBubble(h, lists.get(String(h._id))));
    const card = U.flex("เช็กความครบของที่พัก", bubbles.length === 1 ? bubbles[0] : U.carousel(bubbles), [U.q("✅ เช็กความครบ", "a=chk", "เช็กความครบ"), U.qMenu()]);
    try { await L.push(chat.userId, [U.text(head), card]); report.sentLine++; }
    catch (e) { report.errors.push(String(e.message || e).slice(0, 160)); }
  }
  if (email && BREVO()) {
    const B = baseUrl();
    for (const h of target) {
      if (!h.notifyEmail) continue;
      const c = lists.get(String(h._id));
      const html = `<div style="font-family:-apple-system,'Segoe UI',Tahoma,sans-serif;max-width:540px;margin:auto;color:#0f2540;line-height:1.55">
        <h2 style="color:#0d9488;margin:0 0 8px">📣 ${esc(title)}</h2>${message ? `<p style="white-space:pre-line">${esc(message)}</p>` : ""}
        <h3 style="margin:16px 0 6px">${esc(h.name)} — ครบแล้ว ${c.done}/${c.total} (${c.pct}%)</h3>
        ${c.missing.length ? `<ul style="padding-left:18px">${c.missing.map((i) => `<li>${i.must ? "🔴" : "⚪️"} ${esc(i.label)}</li>`).join("")}</ul>` : "<p>🎉 ครบทุกอย่างแล้ว</p>"}
        ${B ? `<p><a href="${B}/app.html" style="background:#0d9488;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">เข้าไปเพิ่มในเว็บหลังบ้าน</a></p>` : ""}
        <p style="color:#5b7089;font-size:13px">หรือทำผ่าน LINE Barn Park: พิมพ์ “เช็กความครบ”</p></div>`;
      try { await sendEmail(h.notifyEmail, `📣 ${title} — ${h.name}`, html); report.sentEmail++; }
      catch (e) { report.errors.push(String(e.message || e).slice(0, 160)); }
    }
  }
  const log = await Setting.findOne({ key: "announce:log" }).lean();
  const entry = { at: new Date(), title, lineUsers: report.sentLine, emails: report.sentEmail, hotels: target.length, errors: report.errors.length };
  await Setting.updateOne({ key: "announce:log" }, { $set: { value: [entry, ...((log && log.value) || [])].slice(0, 20) } }, { upsert: true });
  return report;
}

export async function announceLog() {
  const log = await Setting.findOne({ key: "announce:log" }).lean();
  return (log && log.value) || [];
}
