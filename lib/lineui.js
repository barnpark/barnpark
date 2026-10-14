// ===== ตัวช่วยสร้างข้อความ LINE (ข้อความ / ปุ่มตอบด่วน / การ์ด Flex) =====
// ข้อจำกัด LINE: ป้ายปุ่ม ≤ 20 ตัวอักษร · ปุ่มตอบด่วน ≤ 13 · การ์ดเลื่อน ≤ 12 ใบ · ตอบได้ ≤ 5 ข้อความ

export const C = {
  teal: "#0d9488", navy: "#0f2540", muted: "#5b7089", line: "#e3eaf2",
  sage: "#4f7a5e", cream: "#f7f3e8", amber: "#b45309", red: "#b91c1c", green: "#047857", soft: "#eef6f4",
};

export const cut = (s, n) => {
  const a = Array.from(String(s ?? ""));
  return a.length > n ? a.slice(0, n - 1).join("") + "…" : a.join("");
};
export const safeColor = (c, d = C.teal) => (/^#[0-9a-f]{6}$/i.test(String(c || "")) ? c : d);
export const money = (n) => "฿" + Number(n || 0).toLocaleString("en-US");

// ---------- actions ----------
export const pb = (label, data, display) => ({ type: "postback", label: cut(label, 20), data, displayText: cut(display || label, 290) });
export const pbQuiet = (label, data) => ({ type: "postback", label: cut(label, 20), data });
export const uri = (label, url) => ({ type: "uri", label: cut(label, 20), uri: url });

// ---------- quick replies ----------
export const q = (label, data, display) => ({ type: "action", action: pb(label, data, display) });
export const qText = (label, text) => ({ type: "action", action: { type: "message", label: cut(label, 20), text: cut(text ?? label, 290) } });
export const qRoll = (label = "🖼 เลือกรูป") => ({ type: "action", action: { type: "cameraRoll", label: cut(label, 20) } });
export const qCam = (label = "📷 ถ่ายรูป") => ({ type: "action", action: { type: "camera", label: cut(label, 20) } });
export const qDate = (label, data, o = {}) => ({
  type: "action",
  action: { type: "datetimepicker", label: cut(label, 20), data, mode: "date", ...(o.initial ? { initial: o.initial } : {}), ...(o.min ? { min: o.min } : {}), ...(o.max ? { max: o.max } : {}) },
});
export const qCancel = () => q("✖ ยกเลิก", "a=x", "ยกเลิก");
export const qMenu = () => q("🏠 เมนู", "a=menu", "เมนู");

const withQuick = (m, quick) => {
  const items = (quick || []).filter(Boolean).slice(0, 13);
  if (items.length) m.quickReply = { items };
  return m;
};

// ---------- messages ----------
export const text = (t, quick) => withQuick({ type: "text", text: cut(t || "-", 4900) }, quick);
export const flex = (alt, contents, quick) => withQuick({ type: "flex", altText: cut(alt || "Barn Park", 380), contents }, quick);
export const image = (url, preview) => ({ type: "image", originalContentUrl: url, previewImageUrl: preview || url });

// ---------- flex components ----------
export const T = (t, o = {}) => ({ type: "text", text: cut(t || "-", 1900), wrap: true, ...o });
export const box = (contents, o = {}) => ({ type: "box", layout: "vertical", contents: contents.filter(Boolean), ...o });
export const row = (contents, o = {}) => ({ type: "box", layout: "horizontal", contents: contents.filter(Boolean), ...o });
export const sep = (o = {}) => ({ type: "separator", margin: "md", color: C.line, ...o });
export const btn = (action, style = "primary", color) => ({
  type: "button", action, style, height: "sm",
  ...(style === "primary" ? { color: color || C.teal } : color ? { color } : {}),
});
export const kv = (k, v, o = {}) => row([
  T(k, { size: "sm", color: C.muted, flex: 4 }),
  T(String(v ?? "-") || "-", { size: "sm", color: C.navy, flex: 6, align: "end", ...o }),
], { margin: "sm" });

// วางปุ่มเป็นแถวละ 2
export const grid2 = (buttons) => {
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons[i + 1] ? row([buttons[i], buttons[i + 1]], { spacing: "sm" }) : buttons[i]);
  }
  return rows;
};

// การ์ดมาตรฐานของ Barn Park
export function bubble({ tag, tagColor, title, sub, hero, lines = [], buttons = [], size = "mega", footerGrid = false }) {
  const b = { type: "bubble", size };
  if (tag) {
    b.header = box([T(tag, { size: "xs", color: "#ffffff", weight: "bold" })], {
      backgroundColor: safeColor(tagColor, C.teal), paddingAll: "10px", paddingStart: "16px",
    });
  }
  if (hero) b.hero = { type: "image", url: hero, size: "full", aspectRatio: "20:13", aspectMode: "cover" };
  const contents = [];
  if (title) contents.push(T(title, { weight: "bold", size: "lg", color: C.navy }));
  if (sub) contents.push(T(sub, { size: "sm", color: C.muted, margin: "xs" }));
  for (const l of lines) {
    if (!l) continue;
    contents.push(typeof l === "string" ? T(l, { size: "sm", color: C.navy, margin: "sm" }) : l);
  }
  b.body = box(contents.length ? contents : [T("-")], { spacing: "xs", paddingAll: "16px" });
  const btns = buttons.filter(Boolean);
  if (btns.length) b.footer = box(footerGrid ? grid2(btns) : btns, { spacing: "sm", paddingAll: "12px", paddingTop: "0px" });
  return b;
}

export const carousel = (bubbles) => ({ type: "carousel", contents: bubbles.slice(0, 12) });
