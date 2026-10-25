// ===== เช็กความครบของที่พัก =====
// ใช้ 3 ที่: แดชบอร์ดเว็บหลังบ้าน · ปุ่ม "เช็กความครบ" ใน LINE · ประกาศอัปเดตระบบ (บอกแต่ละที่ว่ายังขาดอะไร)
// เพิ่มฟีเจอร์ใหม่เมื่อไร → เพิ่มรายการที่นี่ที่เดียว แล้วกด "แจ้งอัปเดตระบบ" ในหน้าแอดมิน
import RoomType from "../models/RoomType.js";
import LineChat from "../models/LineChat.js";
import Staff from "../models/Staff.js";
import { hotelUsage } from "./storage.js";
import { BF_MODES, LEGACY_BF, stayInfo, lineContactUrl } from "./stay.js";
import { payMethodsOf } from "./pay.js";

// must = ต้องมีก่อนเปิดรับจองจริง · fix = ปุ่มแก้ใน LINE (null = ทำได้ในเว็บหลังบ้านเท่านั้น) · web = แท็บในเว็บหลังบ้าน
export const ITEMS = [
  { key: "rooms",     must: true, label: "มีห้องพักบนเว็บ",               fix: "a=add&t=room",  web: "v-rooms", fixLabel: "🛏 เพิ่มห้อง" },
  { key: "photos",    must: true, label: "ทุกห้องมีรูป",                   fix: "a=edit",        web: "v-rooms", fixLabel: "📷 ใส่รูปห้อง" },
  { key: "pp",        must: true, label: "วิธีรับเงิน (พร้อมเพย์/โอน/เคาน์เตอร์)", fix: "a=set&f=pay", web: "v-set",   fixLabel: "💳 ตั้งวิธีรับเงิน" },
  { key: "phone",     must: true, label: "เบอร์โทรที่พัก",                  fix: "a=set&f=phone", web: "v-set",   fixLabel: "📞 ใส่เบอร์โทร" },
  { key: "notify",    must: true, label: "ช่องทางรับแจ้งเตือนจองใหม่",     fix: "a=set&f=nemail", web: "v-set",  fixLabel: "🔔 ตั้งแจ้งเตือน" },
  { key: "line",      label: "ปุ่ม LINE ให้แขกทักแชท",                     fix: "a=set&f=lineid", web: "v-set",  fixLabel: "💬 ใส่ LINE ที่พัก" },
  { key: "times",     label: "เวลาเช็คอิน–เช็คเอาท์",                       fix: "a=set&f=times", web: "v-set",   fixLabel: "🕑 ตั้งเวลาเข้า-ออก" },
  { key: "map",       label: "แผนที่ / ที่ตั้ง",                            fix: "a=set&f=map",   web: "v-set",   fixLabel: "📍 ใส่แผนที่" },
  { key: "rules",     label: "กฎที่พัก / ข้อควรรู้",                        fix: "a=set&f=rules", web: "v-set",   fixLabel: "📜 ใส่กฎที่พัก" },
  { key: "breakfast", label: "ระบุอาหารเช้าของทุกห้อง",                    fix: "a=bf",          web: "v-rooms", fixLabel: "🍳 ตั้งอาหารเช้า" },
  { key: "cover",     label: "รูปหน้าปกเว็บ",                               fix: "a=set&f=cover", web: "v-set",   fixLabel: "🖼 ใส่รูปปก" },
  { key: "about",     label: "แนะนำที่พัก (เกี่ยวกับเรา)",                  fix: "a=set&f=about", web: "v-set",   fixLabel: "📖 เขียนแนะนำ" },
  { key: "amen",      label: "สิ่งอำนวยความสะดวกของที่พัก",                fix: "a=set&f=amen",  web: "v-set",   fixLabel: "🏊 ใส่สิ่งอำนวยฯ" },
  // ระบบหน้าเคาน์เตอร์ / ทีมงาน / พื้นที่ (25 ต.ค. 2026) — ทำในเว็บหลังบ้าน
  { key: "units",     label: "ตั้งเลขห้อง (ใช้หน้าเคาน์เตอร์)",              fix: null, web: "v-rooms", fixLabel: "🔢 ตั้งเลขห้อง" },
  { key: "team",      label: "ตั้งผู้จัดการ + รหัสพนักงาน (รู้ว่าใครทำอะไร)", fix: null, web: "v-set",   fixLabel: "👥 ตั้งทีมงาน" },
  { key: "space",     label: "พื้นที่ของที่พักยังไม่เต็ม (อัปรูปใหม่ได้)",      fix: null, web: "v-set",   fixLabel: "💾 ดูพื้นที่" },
];

// h = เอกสารโรงแรม (lean ได้) · คืน { items:[{...ITEM, ok}], done, total, pct, missing, mustMissing }
export async function checklist(h, pre = {}) {
  const rooms = pre.rooms || await RoomType.find({ hotel: h._id }).select("images imageUrl hidden breakfast amenities units").lean();
  const linked = pre.linked != null ? pre.linked : await LineChat.countDocuments({ hotels: h._id });
  const managers = pre.managers != null ? pre.managers : await Staff.countDocuments({ hotel: h._id, manager: true, active: true });
  // นับพื้นที่ไม่ได้ (เช่น Supabase ล่ม) → ไม่นับว่าขาด
  const usage = pre.usage !== undefined ? pre.usage : await hotelUsage(h._id).catch(() => null);
  const st = stayInfo(h);
  const live = rooms.filter((r) => !r.hidden);
  const ok = {
    rooms: live.length > 0,
    photos: live.length > 0 && live.every((r) => (r.images && r.images.length) || r.imageUrl),
    pp: !payMethodsOf(h).fallback, // เปิดอย่างน้อย 1 ช่องทาง (พร้อมเพย์ / โอนเข้าบัญชี / จ่ายที่เคาน์เตอร์)
    phone: !!String(h.phone || "").trim(),
    notify: linked > 0 || !!String(h.notifyEmail || "").trim() || !!String(h.notifyLineTo || "").trim(),
    line: !!lineContactUrl(h.lineId),
    times: !!(st.checkInTime && st.checkOutTime),
    map: !!(st.mapUrl || st.address.trim()),
    rules: !!st.houseRules.trim(),
    breakfast: live.length > 0 && live.every((r) => BF_MODES.includes(r.breakfast) || (r.amenities || []).includes(LEGACY_BF)),
    cover: !!(h.coverUrl || h.coverData),
    about: String(h.about || "").trim().length >= 20,
    amen: (h.amenities || []).length > 0,
    units: live.length > 0 && live.every((r) => (r.units || []).length > 0),
    team: managers > 0,
    space: !(usage && usage.over),
  };
  const items = ITEMS.map((it) => ({ ...it, ok: !!ok[it.key] }));
  const done = items.filter((i) => i.ok).length;
  return {
    items, done, total: items.length, pct: Math.round((done / items.length) * 100),
    missing: items.filter((i) => !i.ok), mustMissing: items.filter((i) => i.must && !i.ok),
  };
}
