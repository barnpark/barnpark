// ===== ตัวคำนวณต้นทุน Channex (หน้าแอดมิน) =====
// ราคา Channex (แผน WhiteLabel, channex.io/pricing ตรวจ 16 ต.ค. 2026):
// $130/เดือน + $7 ต่อที่พักที่เชื่อม OTA อย่างน้อย 1 ช่องทาง (500+ ที่ $6 · 1,000+ $5 · 2,000+ $4)
// ค่าที่ทีมกรอกเก็บใน Setting key "calc:channex" ให้ทุกคนที่เข้าหน้าแอดมินเห็นตรงกัน

export const CALC_KEY = "calc:channex";

const numIn = (v, lo, hi) => {
  if (v === "" || v === null || v === undefined || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};
const intIn = (v, lo, hi) => { const n = numIn(v, lo, hi); return n === null ? null : Math.floor(n); };

// รับค่าจากหน้าเว็บ → เก็บเฉพาะที่ถูกต้อง (ตัวเลขอยู่ในช่วง, ข้อความสั้น, ราคาไม่เกิน 12 แถว)
export function cleanCalc(b = {}) {
  const src = b && typeof b === "object" ? b : {};
  const prices = (Array.isArray(src.prices) ? src.prices : []).slice(0, 12)
    .map((p) => ({
      label: String((p && p.label) || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 40),
      thb: numIn(p && p.thb, 0, 1e6),
    }))
    .filter((p) => p.label || p.thb !== null);
  return {
    fx: numIn(src.fx, 0.0001, 1000),          // ว่าง = ยังไม่ได้ใส่อัตราแลกเปลี่ยน
    hotels: intIn(src.hotels, 0, 1e5),        // ว่าง = ใช้จำนวนที่พักจริงในระบบ
    same: src.same !== false,                 // ทุกที่เชื่อม Channex
    cxh: intIn(src.cxh, 0, 1e5),
    pf: numIn(src.pf, 0, 1e5) ?? 130,
    ph: numIn(src.ph, 0, 1e4) ?? 7,
    chat: src.chat === true,
    extra: numIn(src.extra, 0, 100) ?? 0,
    prices,
  };
}

// ค่าต่อที่พักตามจำนวน (ส่วนลดตามขั้นของ Channex คิดทั้งพอร์ต)
export function tierRate(n, base) {
  if (n >= 2000) return Math.min(base, 4);
  if (n >= 1000) return Math.min(base, 5);
  if (n >= 500) return Math.min(base, 6);
  return base;
}

// ค่า Channex ต่อเดือน (USD) สำหรับที่พักที่เชื่อม n แห่ง
export function channexUSD(n, c) {
  const k = Math.max(0, Math.floor(n || 0));
  return ((c.pf || 0) + k * (tierRate(k, c.ph || 0) + (c.chat ? 7 : 0))) * (1 + (c.extra || 0) / 100);
}
