// ข้อมูลชุดเดียวกับ public/api.js (STYLE_PRESETS) + รายชื่อเทมเพลตหน้าจอง — ใช้ฝั่งเซิร์ฟเวอร์ (บอท LINE)
// ⚠️ ถ้าแก้ชุดสีใน public/api.js ให้แก้ที่นี่ด้วย

export const STYLE_PRESETS = [
  { key: "organic",  name: "Warm Organic · อบอุ่นธรรมชาติ", brandColor: "#6b7a4f", brandColor2: "#9aa86b", accentColor: "#c57b4e", accentColor2: "#caa23e", fontFamily: "Mitr",         uiStyle: "pill" },
  { key: "zen",      name: "Zen Minimal · สงบมินิมอล",      brandColor: "#8a8172", brandColor2: "#b8ad99", accentColor: "#a98f6b", accentColor2: "#6f6757", fontFamily: "Taviraj",      uiStyle: "minimal" },
  { key: "playful",  name: "Playful · สนุกสีสด",            brandColor: "#ff4d6d", brandColor2: "#ffb13d", accentColor: "#7c4dff", accentColor2: "#ffd23f", fontFamily: "Kanit",        uiStyle: "pill" },
  { key: "heritage", name: "Heritage · คลาสสิกหรู",         brandColor: "#0f3d2e", brandColor2: "#1c5a44", accentColor: "#c8a24b", accentColor2: "#0a2b20", fontFamily: "Taviraj",      uiStyle: "sharp" },
  { key: "wellness", name: "Wellness · สดชื่นสปา",          brandColor: "#2b8ca6", brandColor2: "#56c1d6", accentColor: "#7fd1b9", accentColor2: "#14506b", fontFamily: "Prompt",       uiStyle: "soft" },
  { key: "luxe",     name: "Luxe Gold · หรูทอง",            brandColor: "#1f2430", brandColor2: "#3a4150", accentColor: "#d4af37", accentColor2: "#e8c766", fontFamily: "Chakra Petch", uiStyle: "sharp" },
  { key: "tropical", name: "Tropical · เขตร้อนสดใส",        brandColor: "#0bc5b4", brandColor2: "#36d1a0", accentColor: "#ff6f5e", accentColor2: "#ffd23f", fontFamily: "Bai Jamjuree", uiStyle: "pill" },
  { key: "scandi",   name: "Scandinavian · นอร์ดิก",        brandColor: "#8a9a86", brandColor2: "#a7b5a0", accentColor: "#c98a6b", accentColor2: "#2c3330", fontFamily: "Sarabun",      uiStyle: "soft" },
  { key: "ryokan",   name: "Japanese Ryokan · ญี่ปุ่น",     brandColor: "#35495e", brandColor2: "#5a6e82", accentColor: "#a6563f", accentColor2: "#2e2b28", fontFamily: "Taviraj",      uiStyle: "minimal" },
  { key: "boho",     name: "Bohemian · โบโฮฟาร์มสเตย์",     brandColor: "#b5533b", brandColor2: "#d98b5f", accentColor: "#caa23e", accentColor2: "#f3d9a4", fontFamily: "Mali",         uiStyle: "pill" },
];

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
