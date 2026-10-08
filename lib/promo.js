import PromoCode from "../models/PromoCode.js";

// ตรวจและคำนวณส่วนลด — คืน { ok, discount, label, promo } หรือ { ok:false, error }
export async function evalPromo(hotelId, codeRaw, nights, subtotal) {
  const code = String(codeRaw || "").toUpperCase().trim();
  if (!code) return { ok: false, error: "no code" };
  const p = await PromoCode.findOne({ hotel: hotelId, code });
  if (!p || !p.active) return { ok: false, error: "โค้ดไม่ถูกต้องหรือปิดใช้งาน" };
  if (p.expiresAt && new Date() > p.expiresAt) return { ok: false, error: "โค้ดหมดอายุแล้ว" };
  if (p.maxUses && p.usedCount >= p.maxUses) return { ok: false, error: "โค้ดถูกใช้ครบจำนวนแล้ว" };
  if (p.minNights && nights < p.minNights) return { ok: false, error: `ต้องพักอย่างน้อย ${p.minNights} คืน` };
  let discount = p.type === "percent" ? Math.round(subtotal * p.value / 100) : Math.min(p.value, subtotal);
  discount = Math.max(0, Math.min(discount, subtotal));
  const label = p.type === "percent" ? `${code} (ลด ${p.value}%)` : `${code} (ลด ฿${p.value})`;
  return { ok: true, discount, label, promo: p };
}
