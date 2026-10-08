// ===== เตรียมเชื่อม OTA ผ่าน Channex (channel manager) =====
// ยังไม่เปิดใช้งานจนกว่าจะตั้ง env CHANNEX_API_KEY (ต้องมีบัญชี Channex ก่อน)
// เอกสาร: https://docs.channex.io  · staging: https://staging.channex.io
// เมื่อพร้อม: เติม logic ใน syncAvailability/importBookings ให้เรียก Channex API จริง
const KEY = process.env.CHANNEX_API_KEY || "";
const BASE = process.env.CHANNEX_BASE_URL || "https://staging.channex.io/api/v1";

export function channexReady() { return !!KEY; }

async function cx(path, opts = {}) {
  if (!KEY) throw new Error("CHANNEX_API_KEY ยังไม่ได้ตั้ง — ยังไม่เปิดใช้ OTA sync");
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { "user-api-key": KEY, "content-type": "application/json", ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error("channex " + r.status + " " + (await r.text()));
  return r.json();
}

// ส่งห้องว่าง/ราคาไป OTA (ยังไม่เปิดใช้งาน — โครงไว้ต่อภายหลัง)
export async function syncAvailability(/* hotel, roomType, dates */) {
  if (!channexReady()) return { skipped: true };
  // TODO: map ห้อง/ราคาของเราเป็น ARI ของ Channex แล้ว cx("/availability",{method:"POST",...})
  return { ok: true };
}

// ดึงการจองจาก OTA เข้าระบบเรา (ยังไม่เปิดใช้งาน)
export async function importBookings(/* hotel */) {
  if (!channexReady()) return { skipped: true };
  // TODO: cx("/bookings?...") แล้วสร้าง Booking (channel: ota, extUid: <channex booking id>)
  return { ok: true, imported: 0 };
}
