// ===== วิธีรับเงินจากแขก — ที่พักเปิด/ปิดเองได้ทีละช่องทาง =====
//   📱 พร้อมเพย์ (QR ตามยอด)  ·  🏦 โอนเข้าบัญชีธนาคาร  ·  💵 จ่ายที่เคาน์เตอร์ (ตอนเช็คอิน)
// ใช้ร่วมกัน: หน้าจอง · อีเมลยืนยัน · การ์ด LINE · เช็กลิสต์ · เว็บหลังบ้าน · บอท LINE
import { normalizePromptPayId } from "./promptpay.js";

export const BANKS = [
  "กสิกรไทย", "ไทยพาณิชย์", "กรุงเทพ", "กรุงไทย", "กรุงศรีอยุธยา", "ทีทีบี (ttb)",
  "ออมสิน", "ธ.ก.ส.", "ยูโอบี", "ซีไอเอ็มบี ไทย", "เกียรตินาคินภัทร", "แลนด์ แอนด์ เฮ้าส์", "อาคารสงเคราะห์ (ธอส.)",
];

// เลขบัญชี: ตัวเลข 10–15 หลัก (รับแบบมีขีด/ช่องว่างได้)
export const normAccountNo = (s) => { const d = String(s ?? "").replace(/[\s-]/g, ""); return /^\d{10,15}$/.test(d) ? d : null; };
export const fmtAccountNo = (d) => { const s = String(d || ""); return s.length === 10 ? s.replace(/(\d{3})(\d)(\d{5})(\d)/, "$1-$2-$3-$4") : s; };

export function bankOf(h = {}) {
  const no = normAccountNo(h.bankAccountNo);
  if (!no) return null;
  return { name: String(h.bankName || "").slice(0, 60), no, noFmt: fmtAccountNo(no), acct: String(h.bankAccountName || h.name || "").slice(0, 80) };
}

// ช่องทางที่เปิดให้แขกเลือกจริง (ต้องเปิดสวิตช์ + มีข้อมูลครบ)
// ถ้าไม่มีช่องทางไหนเลย → fallback ให้จองแบบชำระกับที่พักโดยตรง (ไม่ให้แขกจองไม่ได้ / ระบบไม่ยกเลิกเอง)
export function payMethodsOf(h = {}) {
  const promptpay = !!normalizePromptPayId(h.promptpayId) && h.payPromptpay !== false;
  const bank = bankOf(h);
  const transfer = !!bank && h.payTransfer !== false;
  const onsiteOn = h.payOnsite === true;
  const fallback = !promptpay && !transfer && !onsiteOn;
  return { promptpay, transfer, onsite: onsiteOn || fallback, fallback, online: promptpay || transfer, bank: transfer ? bank : null };
}

export const METHOD_TH = { promptpay: "พร้อมเพย์", transfer: "โอนเข้าบัญชี", onsite: "จ่ายที่เคาน์เตอร์", cash: "เงินสด", ota: "ผ่าน OTA" };
export const methodTh = (m) => METHOD_TH[m] || "";

// สรุปสั้น ๆ เช่น "พร้อมเพย์ · โอนเข้าบัญชี" (ใช้ใน LINE/แอดมิน)
export function payMethodsText(h) {
  const m = payMethodsOf(h);
  const list = [m.promptpay ? "พร้อมเพย์" : null, m.transfer ? "โอนเข้าบัญชี" : null, m.onsite && !m.fallback ? "จ่ายที่เคาน์เตอร์" : null].filter(Boolean);
  return list.length ? list.join(" · ") : "ยังไม่ได้ตั้ง ⚠️";
}

// วิธีชำระที่แขกเลือกมา → ค่าที่บันทึก (ตรวจกับที่เปิดไว้จริง) — คืน { method, payStatus } หรือ { error }
//   paid=true  = แขกกด "โอนแล้ว · แจ้งชำระ"  → reported
//   paid=false + พร้อมเพย์/โอน = จองไว้ก่อน โอนทีหลัง → unpaid (ระบบปล่อยห้องตาม holdHours)
//   onsite = จ่ายที่เคาน์เตอร์ → onsite (ระบบไม่ยกเลิกเอง)
export function resolvePayChoice(h, want, paid) {
  const m = payMethodsOf(h);
  let w = String(want || "").toLowerCase();
  if (w === "hotel" || w === "later") w = ""; // ค่าจากหน้าเว็บรุ่นเก่า
  if (!w) w = paid ? (m.promptpay ? "promptpay" : m.transfer ? "transfer" : "promptpay") : (m.onsite ? "onsite" : m.promptpay ? "promptpay" : "transfer");
  if (w === "onsite") {
    if (!m.onsite) return { error: "ที่พักนี้ไม่ได้เปิดรับชำระที่เคาน์เตอร์ — กรุณาเลือกโอน/พร้อมเพย์" };
    return { method: "", payStatus: "onsite" };
  }
  if (w === "promptpay" || w === "transfer") {
    // แขกที่ใช้หน้าเว็บรุ่นเก่า/ที่พักเพิ่งปิดช่องทาง: ยอมรับการแจ้งโอนไว้ก่อน (ที่พักตรวจยอดเองอยู่แล้ว) แต่ไม่ให้เลือกช่องทางที่ปิดแบบจองค้างจ่าย
    if (!m[w] && !paid) return { error: "ที่พักไม่ได้เปิดรับชำระช่องทางนี้ กรุณาเลือกช่องทางอื่น" };
    return { method: w, payStatus: paid ? "reported" : "unpaid" };
  }
  return { error: "วิธีชำระเงินไม่ถูกต้อง" };
}

// ตรวจ/ทำความสะอาดฟิลด์วิธีรับเงินใน PATCH /hotels — คืนข้อความ error หรือ null
export function cleanPayFields(body) {
  for (const k of ["payPromptpay", "payTransfer", "payOnsite"]) {
    if (body[k] === undefined) continue;
    body[k] = body[k] === true || body[k] === "true" || body[k] === 1 || body[k] === "1";
  }
  if (body.bankName !== undefined) body.bankName = String(body.bankName || "").trim().slice(0, 60);
  if (body.bankAccountName !== undefined) body.bankAccountName = String(body.bankAccountName || "").trim().slice(0, 80);
  if (body.bankAccountNo !== undefined) {
    const s = String(body.bankAccountNo || "").trim();
    if (!s) body.bankAccountNo = "";
    else {
      const n = normAccountNo(s);
      if (!n) return "เลขบัญชีไม่ถูกต้อง (ตัวเลข 10–15 หลัก)";
      if (body.bankName !== undefined && !body.bankName) return "เลือกธนาคารของบัญชีด้วย";
      body.bankAccountNo = n;
    }
  }
  return null;
}
