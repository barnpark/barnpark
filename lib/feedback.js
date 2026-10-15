// ===== ความเห็นจากที่พัก (feedback) =====
// ที่พักส่งได้ทุกเมื่อ: LINE (💡 ส่งความเห็น) · เว็บหลังบ้าน (แท็บ 💡 ความเห็น)
// แบบสอบถามรายเดือน: ทุกวันที่ FEEDBACK_DAY (ค่าเริ่มต้น 1) ระบบส่งการ์ดให้คะแนน 1 คลิกเข้า LINE ของทุกคนที่เชื่อมที่พัก
// แอดมินตอบกลับ/เปลี่ยนสถานะ → แจ้งกลับคนที่ส่งทาง LINE (หรืออีเมลของที่พัก)
import Feedback from "../models/Feedback.js";
import Hotel from "../models/Hotel.js";
import LineChat from "../models/LineChat.js";
import Setting from "../models/Setting.js";
import * as L from "./line.js";
import * as U from "./lineui.js";
import { sendEmail } from "./notify.js";
import { baseUrl } from "./baseurl.js";

const BREVO = () => process.env.BREVO_API_KEY || "";
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const CATS = { bug: "🐞 เจอปัญหา", idea: "💡 อยากได้ฟีเจอร์", praise: "💚 ชมเชย", other: "💬 อื่น ๆ" };
export const STATUS = { new: "🆕 รับเรื่องแล้ว", planned: "🛠 อยู่ในแผน / กำลังทำ", done: "✅ ทำเสร็จแล้ว", wontfix: "🙏 ยังไม่ทำตอนนี้" };
export const SOURCES = { line: "LINE", web: "เว็บหลังบ้าน", monthly: "แบบสอบถามรายเดือน" };
export const RATES = [[5, "😍 ดีมาก"], [4, "🙂 ดี"], [3, "😐 พอใช้"], [2, "🙁 ควรปรับปรุง"], [1, "😞 ไม่ดี"]];
const TH_M = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

// เดือนปัจจุบันตามเวลาไทย "YYYY-MM"
export const monthKey = (d = new Date()) => new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 7);
export const prevMonth = (m) => { const [y, mo] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mo - 2, 1)); return d.toISOString().slice(0, 7); };
export const thMonth = (m) => { const [y, mo] = String(m).split("-").map(Number); return y && mo ? `${TH_M[mo - 1]} ${y + 543}` : String(m); };

// บันทึกความเห็น + แจ้งแอดมิน (เฉพาะที่มีข้อความ/รูป — คะแนนอย่างเดียวไม่แจ้ง เพื่อประหยัดโควตา LINE)
export async function createFeedback(o) {
  const text = String(o.text || "").trim().slice(0, 2000);
  const doc = await Feedback.create({
    hotel: o.hotel, hotelName: o.hotelName || "", source: SOURCES[o.source] ? o.source : "line",
    category: CATS[o.category] ? o.category : "other", rating: o.rating || undefined, month: o.month || undefined,
    text, image: o.image || undefined, hasImage: !!o.image, senderName: String(o.senderName || "").slice(0, 80),
    lineUserId: o.lineUserId || undefined, user: o.user || undefined,
  });
  if (text || o.image) notifyAdminFeedback(doc).catch((e) => console.error("feedback notify", e.message));
  return doc;
}

export async function notifyAdminFeedback(fb) {
  const adminLineTo = process.env.ADMIN_LINE_TO || "";
  const adminEmail = process.env.ADMIN_NOTIFY_EMAIL || process.env.SEED_ADMIN_EMAIL || "";
  const stars = fb.rating ? " · " + "★".repeat(fb.rating) + "☆".repeat(5 - fb.rating) : "";
  const head = `💬 ความเห็นใหม่ · ${fb.hotelName || "ที่พัก"}`;
  const body = `${CATS[fb.category] || ""}${stars}\nจาก ${fb.senderName || "-"} (${SOURCES[fb.source] || fb.source})\n\n${fb.text || "(ไม่มีข้อความ)"}${fb.hasImage ? "\n📷 มีภาพหน้าจอ — ดูในหน้าแอดมิน" : ""}`;
  const jobs = [];
  if (adminLineTo && L.lineReady()) jobs.push(L.push(adminLineTo, [U.text(head + "\n" + body)]));
  if (BREVO() && adminEmail) {
    const B = baseUrl();
    jobs.push(sendEmail(adminEmail, head, `<div style="font-family:sans-serif;color:#0f2540"><h3 style="margin:0 0 8px">${esc(head)}</h3><p style="white-space:pre-line">${esc(body)}</p>${B ? `<p><a href="${B}/admin.html">เปิดหน้าแอดมิน → 💬 Feedback</a></p>` : ""}</div>`));
  }
  await Promise.allSettled(jobs);
}

// แจ้งกลับคนที่ส่งความเห็น (คำตอบจากทีมงาน / สถานะเปลี่ยน)
export async function replyToSender(fb) {
  const msg = `📬 ตอบกลับจากทีม Barn Park\nเรื่องที่ส่งมา: ${U.cut(fb.text || (fb.rating ? `ให้คะแนน ${fb.rating}/5` : "-"), 90)}\nสถานะ: ${STATUS[fb.status] || fb.status}${fb.reply ? `\n\n${fb.reply}` : ""}`;
  if (fb.lineUserId && L.lineReady()) {
    await L.push(fb.lineUserId, [U.text(msg, [U.q("💡 ส่งความเห็นอีก", "a=fb", "ส่งความเห็น"), U.q("📋 ที่เคยส่ง", "a=fbl", "ดูความเห็นที่เคยส่ง"), U.qMenu()])]);
    return "line";
  }
  const h = fb.hotel ? await Hotel.findById(fb.hotel).select("notifyEmail name").lean() : null;
  if (BREVO() && h && h.notifyEmail) {
    await sendEmail(h.notifyEmail, "📬 ตอบกลับจากทีม Barn Park", `<div style="font-family:sans-serif;color:#0f2540;white-space:pre-line">${esc(msg)}</div>`);
    return "email";
  }
  return "";
}

// การ์ดแบบสอบถามรายเดือน (กดคะแนน 1 ครั้ง)
export function surveyBubble(h, month) {
  const hh = "&hh=" + h._id;
  return U.bubble({
    tag: `📝 แบบสอบถามประจำเดือน · ${thMonth(month)}`, tagColor: U.C.teal,
    title: "เดือนนี้ Barn Park ช่วยงานคุณได้ดีแค่ไหน?",
    sub: `${h.name} · กดคะแนน 1 ครั้ง ไม่ถึง 10 วินาที — ความเห็นของคุณกำหนดว่าเราจะอัปเดตอะไรต่อ`,
    buttons: [
      ...RATES.map(([r, label]) => U.btn(U.pb(label, `a=fbr&r=${r}&m=${month}${hh}`, `ให้คะแนน ${r}/5 (${label})`), r === 5 ? "primary" : "secondary")),
      U.btn(U.pb("💡 มีเรื่องอยากบอก", "a=fb" + hh, "ส่งความเห็น"), "link"),
    ],
  });
}

// ส่งแบบสอบถามรายเดือน — 1 push ต่อ 1 คน (ใช้ที่พักที่คนนั้นดูแลอยู่) · ที่พักที่ไม่มีใครเชื่อม LINE → อีเมล
export async function askMonthlyFeedback({ dryRun = true, force = false, month = monthKey() } = {}) {
  const key = "feedback:asked:" + month;
  const prev = await Setting.findOne({ key }).lean();
  const hotels = await Hotel.find({ approved: { $ne: false }, status: { $ne: "paused" } }).select("name slug notifyEmail").lean();
  const byId = new Map(hotels.map((h) => [String(h._id), h]));
  const chats = await LineChat.find({ hotels: { $in: hotels.map((h) => h._id) } }).select("userId hotel hotels").lean();
  const targets = [];
  for (const c of chats) {
    const hid = [c.hotel, ...(c.hotels || [])].filter(Boolean).map(String).find((id) => byId.has(id));
    if (hid && c.userId) targets.push({ uid: c.userId, h: byId.get(hid) });
  }
  const linked = new Set(chats.flatMap((c) => (c.hotels || []).map(String)));
  const emailHotels = hotels.filter((h) => h.notifyEmail && !linked.has(String(h._id)));
  const report = {
    month, monthLabel: thMonth(month), dryRun, alreadyAsked: !!prev, askedAt: prev && prev.value && prev.value.at,
    lineUsers: targets.length, lineQuota: targets.length, emails: BREVO() ? emailHotels.length : 0, sentLine: 0, sentEmail: 0, errors: [],
  };
  if (dryRun) return report;
  if (prev && !force) return { ...report, skipped: true };
  await Setting.updateOne({ key }, { $set: { value: { at: new Date(), sending: true } } }, { upsert: true }); // จองไว้ก่อน กันส่งซ้ำ
  for (const t of targets) {
    try { await L.push(t.uid, [U.flex(`แบบสอบถามประจำเดือน ${thMonth(month)} — ${t.h.name}`, surveyBubble(t.h, month))]); report.sentLine++; }
    catch (e) { report.errors.push(String(e.message || e).slice(0, 160)); }
  }
  if (BREVO()) {
    const B = baseUrl();
    for (const h of emailHotels) {
      try {
        await sendEmail(h.notifyEmail, `📝 เดือนนี้ Barn Park เป็นอย่างไรบ้าง? — ${h.name}`,
          `<div style="font-family:-apple-system,'Segoe UI',Tahoma,sans-serif;max-width:520px;margin:auto;color:#0f2540;line-height:1.6">
           <h2 style="color:#2e5e4a;margin:0 0 8px">ช่วยบอกเราหน่อย 🙏</h2>
           <p>เดือน${thMonth(month)} Barn Park ช่วยงาน “${esc(h.name)}” ได้ดีแค่ไหน อยากให้ปรับหรือเพิ่มอะไร ใช้เวลาไม่ถึง 1 นาที</p>
           ${B ? `<p><a href="${B}/app.html#feedback" style="background:#2e5e4a;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">ให้คะแนน / ส่งความเห็น</a></p>` : ""}
           <p style="color:#5b7089;font-size:13px">หรือตอบผ่าน LINE Barn Park: พิมพ์ “ส่งความเห็น”</p></div>`);
        report.sentEmail++;
      } catch (e) { report.errors.push(String(e.message || e).slice(0, 160)); }
    }
  }
  await Setting.updateOne({ key }, { $set: { value: { at: new Date(), lineUsers: report.sentLine, emails: report.sentEmail, errors: report.errors.length } } }, { upsert: true });
  return report;
}

// เรียกจาก cron รายวัน — ส่งแบบสอบถามเฉพาะวันที่ FEEDBACK_DAY ของเดือน (0 = ปิด) และไม่เกินเดือนละครั้ง
export async function maybeMonthlyFeedback(now = new Date()) {
  const day = process.env.FEEDBACK_DAY === undefined ? 1 : Number(process.env.FEEDBACK_DAY);
  if (!day) return null;
  if (new Date(now.getTime() + 7 * 3600e3).getUTCDate() !== day) return null;
  return askMonthlyFeedback({ dryRun: false, month: monthKey(now) });
}

// สรุปสำหรับหน้าแอดมิน
export async function feedbackSummary(month = monthKey()) {
  const pm = prevMonth(month);
  const rated = await Feedback.find({ rating: { $gte: 1 }, month: { $in: [month, pm] } }).select("rating month").lean();
  const avg = (a) => (a.length ? Math.round((a.reduce((s, x) => s + x.rating, 0) / a.length) * 10) / 10 : null);
  const cur = rated.filter((x) => x.month === month), prev = rated.filter((x) => x.month === pm);
  const open = await Feedback.countDocuments({ status: { $in: ["new", "planned"] }, text: { $nin: ["", null] } });
  const asked = await Setting.findOne({ key: "feedback:asked:" + month }).lean();
  return {
    month, monthLabel: thMonth(month), avg: avg(cur), responses: cur.length, dist: [1, 2, 3, 4, 5].map((r) => cur.filter((x) => x.rating === r).length),
    prevMonth: pm, prevLabel: thMonth(pm), prevAvg: avg(prev), prevResponses: prev.length, open, asked: (asked && asked.value) || null,
  };
}
