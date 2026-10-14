// ===== Rich menu ของ LINE OA Barn Park =====
//  guest : เมนูเริ่มต้น (ทุกคนเห็น) — สมัครที่พัก / มีรหัสแล้ว / คุยกับทีมงาน
//  hotel : เมนูจัดการที่พัก (ผูกเฉพาะคนที่ใส่รหัสเชื่อมแล้ว) — 6 ปุ่ม
// ตั้งค่าครั้งเดียวจากหน้าแอดมิน → แท็บ "LINE OA" → ปุ่ม "ติดตั้งเมนู LINE"
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import * as L from "./line.js";
import Setting from "../models/Setting.js";
import LineChat from "../models/LineChat.js";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "richmenu");

const area = (x, y, width, height, data, displayText) => ({
  bounds: { x, y, width, height },
  action: { type: "postback", data, displayText },
});

// พิกัดต้องตรงกับรูปใน public/richmenu/*.jpg (2500 x 1686)
export const MENUS = {
  guest: {
    file: "guest.jpg",
    def: {
      size: { width: 2500, height: 1686 }, selected: true, name: "barnpark-guest", chatBarText: "เมนู Barn Park",
      areas: [
        area(0, 0, 2500, 760, "a=about", "Barn Park คืออะไร"),
        area(0, 760, 833, 926, "a=reg", "สมัครที่พักกับ Barn Park"),
        area(833, 760, 834, 926, "a=code", "มีรหัสเชื่อมแล้ว"),
        area(1667, 760, 833, 926, "a=sup", "ขอคุยกับทีมงาน"),
      ],
    },
  },
  hotel: {
    file: "hotel.jpg",
    def: {
      size: { width: 2500, height: 1686 }, selected: true, name: "barnpark-hotel", chatBarText: "จัดการที่พัก",
      areas: [
        area(0, 0, 2500, 300, "a=web", "ดูเว็บของฉัน"),
        area(0, 300, 833, 693, "a=add", "เพิ่มห้อง/กิจกรรม"),
        area(833, 300, 834, 693, "a=edit", "แก้ไขรายการ"),
        area(1667, 300, 833, 693, "a=set", "ตั้งค่าเว็บ"),
        area(0, 993, 833, 693, "a=bk", "การจอง"),
        area(833, 993, 834, 693, "a=ota", "OTA"),
        area(1667, 993, 833, 693, "a=acc", "บัญชี & ช่วยเหลือ"),
      ],
    },
  },
};

let cache = null;
export async function menuIds() {
  if (cache) return cache;
  const s = await Setting.findOne({ key: "richmenu" }).lean();
  cache = (s && s.value) || {};
  return cache;
}
export function resetMenuCache() { cache = null; }

export async function linkHotelMenu(userId) {
  const ids = await menuIds();
  if (!ids.hotel || !L.lineReady()) return false;
  try { await L.richMenu.linkUser(userId, ids.hotel); return true; }
  catch (e) { console.error("richmenu link", e.message); return false; }
}
export async function unlinkHotelMenu(userId) {
  if (!L.lineReady()) return;
  try { await L.richMenu.unlinkUser(userId); } catch {}
}

export async function setupRichMenus() {
  if (!L.lineReady()) throw new Error("ยังไม่ได้ตั้ง LINE_CHANNEL_TOKEN ใน Render");
  // ลบเมนูเก่าของ Barn Park (ถ้าเคยติดตั้ง)
  const old = await L.richMenu.list().catch(() => ({ richmenus: [] }));
  for (const m of old.richmenus || []) {
    if (/^barnpark-/.test(m.name || "")) await L.richMenu.remove(m.richMenuId).catch(() => {});
  }
  const ids = {};
  for (const [key, m] of Object.entries(MENUS)) {
    const { richMenuId } = await L.richMenu.create(m.def);
    const buf = await fs.readFile(path.join(DIR, m.file));
    await L.richMenu.upload(richMenuId, buf, m.file.endsWith(".png") ? "image/png" : "image/jpeg");
    ids[key] = richMenuId;
  }
  await L.richMenu.setDefault(ids.guest);
  await Setting.updateOne({ key: "richmenu" }, { $set: { value: { ...ids, at: new Date().toISOString() } } }, { upsert: true });
  resetMenuCache();
  // ผูกเมนูจัดการให้ทุกคนที่เชื่อมที่พักไว้แล้ว
  const chats = await LineChat.find({ hotel: { $ne: null } }).select("userId").lean();
  let linked = 0;
  for (const c of chats) {
    try { await L.richMenu.linkUser(c.userId, ids.hotel); linked++; } catch {}
  }
  return { ids, linked };
}
