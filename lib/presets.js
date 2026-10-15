// ข้อมูลชุดเดียวกับ public/api.js (STYLE_PRESETS) + รายชื่อเทมเพลตหน้าจอง — ใช้ฝั่งเซิร์ฟเวอร์ (บอท LINE)
// ⚠️ ถ้าแก้ชุดสีใน public/api.js ให้แก้ที่นี่ด้วย

export const STYLE_PRESETS = [
  { key: "organic",  name: "Warm Organic · อบอุ่นธรรมชาติ", brandColor: "#556b2f", brandColor2: "#8a9a5b", accentColor: "#c0673f", accentColor2: "#e0b04b", fontFamily: "Mitr",               uiStyle: "pill" },
  { key: "zen",      name: "Zen Minimal · สงบมินิมอล",      brandColor: "#4a463f", brandColor2: "#8c8577", accentColor: "#a8834f", accentColor2: "#e7dfd2", fontFamily: "Noto Sans Thai",     uiStyle: "minimal" },
  { key: "playful",  name: "Playful · สนุกสีสด",            brandColor: "#d6336c", brandColor2: "#ff8a3d", accentColor: "#6f4ef2", accentColor2: "#ffd23f", fontFamily: "Kanit",              uiStyle: "pill" },
  { key: "heritage", name: "Heritage · คลาสสิกหรู",         brandColor: "#17483a", brandColor2: "#2f6b52", accentColor: "#b8913a", accentColor2: "#efe4cc", fontFamily: "Taviraj",            uiStyle: "sharp" },
  { key: "wellness", name: "Wellness · สดชื่นสปา",          brandColor: "#1b6f80", brandColor2: "#4fb3bf", accentColor: "#7fcfbd", accentColor2: "#f2c6a0", fontFamily: "Prompt",             uiStyle: "soft" },
  { key: "luxe",     name: "Luxe Gold · หรูทอง",            brandColor: "#1c1f26", brandColor2: "#3d4250", accentColor: "#c9a646", accentColor2: "#e8d48b", fontFamily: "Bai Jamjuree",       uiStyle: "sharp" },
  { key: "tropical", name: "Tropical · เขตร้อนสดใส",        brandColor: "#0b6e6a", brandColor2: "#17a589", accentColor: "#f0604d", accentColor2: "#ffc94a", fontFamily: "Sriracha",           uiStyle: "pill" },
  { key: "scandi",   name: "Scandinavian · นอร์ดิก",        brandColor: "#4f6352", brandColor2: "#8fa394", accentColor: "#c47d5e", accentColor2: "#e9e3d8", fontFamily: "IBM Plex Sans Thai", uiStyle: "soft" },
  { key: "ryokan",   name: "Japanese Ryokan · ญี่ปุ่น",     brandColor: "#2c3e57", brandColor2: "#566e8c", accentColor: "#b0452c", accentColor2: "#ddcfb4", fontFamily: "Taviraj",            uiStyle: "minimal" },
  { key: "boho",     name: "Bohemian · โบโฮฟาร์มสเตย์",     brandColor: "#9c4127", brandColor2: "#d0804f", accentColor: "#c99a35", accentColor2: "#f3e2c4", fontFamily: "Mali",               uiStyle: "pill" },
];

// ชุดสีรุ่นแรก (ก่อน ต.ค. 2026) — ใช้ย้ายที่พักที่ยังใช้ชุดเดิมแบบไม่แก้เอง ไปเป็นชุดใหม่ที่อ่านง่ายกว่า
const OLD_PRESETS = {
  organic:  { brandColor: "#6b7a4f", accentColor: "#c57b4e", fontFamily: "Mitr" },
  zen:      { brandColor: "#8a8172", accentColor: "#a98f6b", fontFamily: "Taviraj" },
  playful:  { brandColor: "#ff4d6d", accentColor: "#7c4dff", fontFamily: "Kanit" },
  heritage: { brandColor: "#0f3d2e", accentColor: "#c8a24b", fontFamily: "Taviraj" },
  wellness: { brandColor: "#2b8ca6", accentColor: "#7fd1b9", fontFamily: "Prompt" },
  luxe:     { brandColor: "#1f2430", accentColor: "#d4af37", fontFamily: "Chakra Petch" },
  tropical: { brandColor: "#0bc5b4", accentColor: "#ff6f5e", fontFamily: "Bai Jamjuree" },
  scandi:   { brandColor: "#8a9a86", accentColor: "#c98a6b", fontFamily: "Sarabun" },
  ryokan:   { brandColor: "#35495e", accentColor: "#a6563f", fontFamily: "Taviraj" },
  boho:     { brandColor: "#b5533b", accentColor: "#caa23e", fontFamily: "Mali" },
};
// ที่พักที่สีหลัก+สีรองตรงกับชุดเดิมเป๊ะ (= ยังไม่ได้ปรับเอง) → อัปเกรดเป็นชุดใหม่ (ฟอนต์เปลี่ยนเฉพาะถ้ายังเป็นฟอนต์ของชุดเดิม)
// รันตอนเซิร์ฟเวอร์เริ่ม — ทำซ้ำได้ไม่มีผลเสีย (ชุดใหม่ไม่ตรงกับชุดเก่า)
export async function migratePalettes(Hotel) {
  let n = 0;
  for (const p of STYLE_PRESETS) {
    const o = OLD_PRESETS[p.key];
    if (!o) continue;
    const list = await Hotel.find({ brandColor: { $in: [o.brandColor, o.brandColor.toUpperCase()] }, accentColor: { $in: [o.accentColor, o.accentColor.toUpperCase()] } }).select("_id fontFamily").lean();
    for (const h of list) {
      const set = { brandColor: p.brandColor, brandColor2: p.brandColor2, accentColor: p.accentColor, accentColor2: p.accentColor2 };
      if (!h.fontFamily || h.fontFamily === o.fontFamily) set.fontFamily = p.fontFamily;
      await Hotel.updateOne({ _id: h._id }, { $set: set });
      n++;
    }
  }
  if (n) console.log(`[presets] อัปเกรดชุดสีใหม่ให้ ${n} ที่พัก`);
  return n;
}

export const TEMPLATES = [
  { key: "rich",       name: "Rich",        th: "มาตรฐาน",        desc: "เมนูบน + ภาพใหญ่ + การ์ดห้องเรียงกริด", fit: "ใช้ได้กับทุกที่พัก" },
  { key: "editorial",  name: "Editorial",   th: "นิตยสารหรู",       desc: "ภาพห้องใหญ่สลับซ้าย-ขวา ตัวอักษรเรียบหรู", fit: "บูทีค / ที่พักมีเรื่องเล่า" },
  { key: "magazine",   name: "Magazine",    th: "หัวใหญ่สีสัน",      desc: "หัวเรื่องตัวโต การ์ดเรียงแบบนิตยสาร", fit: "ที่พักสนุก สีสันสดใส" },
  { key: "split",      name: "Split-screen",th: "จองซ้าย ห้องขวา",   desc: "กล่องจองติดซ้าย รายการห้องด้านขวา", fit: "อยากให้แขกจองไว" },
  { key: "simple",     name: "Simple",      th: "คอลัมน์เดียว",      desc: "หน้าเดียวแบบลิงก์ไบโอ อ่านง่ายบนมือถือ", fit: "ที่พักเล็ก / โฮมสเตย์" },
  { key: "catalog",    name: "Catalog",     th: "แบบ Airbnb",        desc: "แถบค้นหาด้านบน รายการห้องชัดเจน", fit: "มีห้องหลายแบบ" },
  { key: "classic",    name: "Classic",     th: "คลาสสิกมีกรอบ",     desc: "จัดกึ่งกลาง กรอบลายเส้น ดูเป็นทางการ", fit: "โรงแรมเก่าแก่ / หรู" },
  { key: "bento",      name: "Bento",       th: "กล่องไทล์",         desc: "แบ่งเป็นกล่องไทล์ทันสมัย", fit: "คาเฟ่สเตย์ / โมเดิร์น" },
  { key: "fullscreen", name: "Full-screen", th: "ภาพเต็มจอ",         desc: "เปิดมาเจอภาพเต็มจอ ว้าวตั้งแต่แรกเห็น", fit: "ที่พักวิวสวย" },
  { key: "immersive",  name: "Immersive",   th: "เล่าเรื่องทีละฉาก", desc: "เลื่อนดูทีละฉากเหมือนดูหนังสั้น", fit: "รีสอร์ต / ประสบการณ์" },
];

export const presetByKey = (k) => STYLE_PRESETS.find((p) => p.key === k);
export const templateByKey = (k) => TEMPLATES.find((t) => t.key === k);

// เดาว่าตอนนี้โรงแรมใช้ชุดสีไหน (ถ้าสีหลักตรงกับชุดสำเร็จรูป)
export function presetOfHotel(h) {
  return STYLE_PRESETS.find((p) => (h.brandColor || "").toLowerCase() === p.brandColor && (h.accentColor || "").toLowerCase() === p.accentColor) || null;
}
