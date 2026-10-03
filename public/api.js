// BARN-PARK frontend API client (talks to the Express backend on same origin)
window.API = (function () {
  const KEY = "bp_token";
  const token = () => localStorage.getItem(KEY);
  const setToken = (t) => localStorage.setItem(KEY, t);
  const clear = () => localStorage.removeItem(KEY);

  async function req(method, path, body) {
    const h = { "content-type": "application/json" };
    const t = token(); if (t) h.authorization = "Bearer " + t;
    const r = await fetch("/api" + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401) { clear(); if (!location.pathname.endsWith("login.html")) location.href = "login.html"; }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || ("HTTP " + r.status));
    return data;
  }
  async function pub(path) { const r = await fetch("/api/public" + path); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "error"); return d; }

  function pad(n) { return String(n).length < 2 ? "0" + n : String(n); }
  function ymd(d) { const x = new Date(d); return x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate()); }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function nights(a, b) { return Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000)); }
  const THM = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
  function thDate(d) { const x = new Date(d); return x.getDate() + " " + THM[x.getMonth()]; }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }
  function money(n) { return "฿" + Number(n || 0).toLocaleString("en-US"); }
  // ===== ธีมต่อโรงแรม (สี 4 + ฟอนต์ + สไตล์ UI) =====
  const THEME_FONTS = {
    "Sarabun": "Sarabun", "Prompt": "Prompt", "Kanit": "Kanit", "Mitr": "Mitr",
    "Bai Jamjuree": "Bai+Jamjuree", "IBM Plex Sans Thai": "IBM+Plex+Sans+Thai",
    "Noto Sans Thai": "Noto+Sans+Thai", "Mali": "Mali", "Chakra Petch": "Chakra+Petch",
    "Charmonman": "Charmonman", "Sriracha": "Sriracha", "Taviraj": "Taviraj",
  };
  const UI_STYLES = {
    pill:    { label: "โค้งมน (พิลล์)", btn: "999px", card: "18px", input: "10px" },
    soft:    { label: "นุ่ม",           btn: "14px",  card: "16px", input: "12px" },
    minimal: { label: "มินิมอล",        btn: "8px",   card: "10px", input: "8px"  },
    sharp:   { label: "เหลี่ยมคม",      btn: "3px",   card: "5px",  input: "5px"  },
  };
  function loadFont(name) {
    const g = THEME_FONTS[name]; if (!g) return;
    const id = "gf-" + g; if (document.getElementById(id)) return;
    const l = document.createElement("link"); l.id = id; l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=" + g + ":wght@400;500;600;700;800&display=swap";
    document.head.appendChild(l);
  }
  function applyTheme(h) {
    if (!h) return;
    const S = (k, v) => { if (v) document.documentElement.style.setProperty(k, v); };
    S("--brand", h.brandColor);
    S("--brand2", h.brandColor2 || h.brandColor);
    S("--accent", h.accentColor || h.brandColor2 || h.brandColor);
    S("--accent2", h.accentColor2 || h.accentColor);
    const st = UI_STYLES[h.uiStyle] || UI_STYLES.pill;
    S("--btn-radius", st.btn); S("--card-radius", st.card); S("--input-radius", st.input);
    if (h.fontFamily) { loadFont(h.fontFamily); S("--font", '"' + h.fontFamily + '","Sarabun",sans-serif'); }
  }
  function applyBrand(c) { if (c) document.documentElement.style.setProperty("--brand", c); }

  // ย่อรูปในเบราว์เซอร์แล้วคืนเป็น data URL (ไม่ต้องใช้ที่เก็บรูปภายนอก)
  function resizeImage(file, maxW = 1000, quality = 0.82) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error("ไม่พบไฟล์"));
      if (!/^image\//.test(file.type)) return reject(new Error("กรุณาเลือกไฟล์รูปภาพ"));
      const rd = new FileReader();
      rd.onerror = () => reject(new Error("อ่านไฟล์ไม่สำเร็จ"));
      rd.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("ไฟล์รูปเสียหาย"));
        img.onload = () => {
          let w = img.width, h = img.height;
          if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
          const c = document.createElement("canvas"); c.width = w; c.height = h;
          c.getContext("2d").drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL("image/jpeg", quality));
        };
        img.src = rd.result;
      };
      rd.readAsDataURL(file);
    });
  }
  const CHAN = { direct:"จองตรง", walkin:"Walk-in", phone:"โทรศัพท์", line:"LINE", agoda:"Agoda", booking:"Booking.com", trip:"Trip.com", other:"อื่น ๆ" };
  function chColor(c){ return ({direct:"c0",agoda:"c1",booking:"c2",trip:"c3"})[c] || "c4"; }
  function shortCh(c){ return ({direct:"ตรง",agoda:"Agoda",booking:"Book",trip:"Trip",walkin:"Walk",phone:"โทร",line:"LINE"})[c] || "อื่น"; }
  function toast(msg, kind) {
    let t = document.getElementById("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
    t.style.background = kind === "err" ? "#b91c1c" : kind === "ok" ? "#047857" : "#0f2540";
    t.textContent = msg; t.style.opacity = "1";
    clearTimeout(t._h); t._h = setTimeout(() => { t.style.opacity = "0"; }, 2600);
  }

  async function guard(role) {
    if (!token()) { location.href = "login.html"; return null; }
    try {
      const me = await req("GET", "/auth/me");
      if (role === "admin" && me.role !== "admin") { location.href = "app.html"; return null; }
      return me;
    } catch { location.href = "login.html"; return null; }
  }

  return {
    token, setToken, clear, guard,
    login: (email, password) => req("POST", "/auth/login", { email, password }),
    register: (body) => req("POST", "/auth/register", body),
    verifyOtp: (email, otp) => req("POST", "/auth/verify-otp", { email, otp }),
    me: () => req("GET", "/auth/me"),
    get: (p) => req("GET", p), post: (p, b) => req("POST", p, b), patch: (p, b) => req("PATCH", p, b), del: (p) => req("DELETE", p),
    pubHotel: (slug) => pub("/hotel/" + encodeURIComponent(slug)),
    pubServices: (slug) => pub("/services/" + encodeURIComponent(slug)),
    pubAvailability: (slug, din, dout) => pub("/availability?slug=" + encodeURIComponent(slug) + "&din=" + din + "&dout=" + dout),
    pubBook: async (b) => { const r = await fetch("/api/public/book", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "error"); return d; },
    pubCancel: async (b) => { const r = await fetch("/api/public/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "error"); return d; },
    money, ymd, addDays, nights, thDate, esc, applyBrand, applyTheme, loadFont, resizeImage, THEME_FONTS, UI_STYLES, CHAN, chColor, shortCh, toast, signOut: () => { clear(); location.href = "login.html"; },
    mountSupport,
  };

  // ===== ปุ่มติดต่อซัพพอร์ตของ BARN-PARK (LINE OA ของแพลตฟอร์ม) =====
  // 🔧 แก้ลิงก์นี้เป็น LINE OA ของ BARN-PARK: https://line.me/R/ti/p/@<basic id>  หรือ  https://lin.ee/xxxxxxx
  const SUPPORT_LINE_URL = "https://line.me/R/ti/p/@barnpark";
  async function mountSupport(url) {
    if (document.getElementById("bp-support")) return;
    let href = url || SUPPORT_LINE_URL;
    try { const c = await fetch("/api/public/config").then((r) => r.json()); if (c && c.supportLineUrl) href = c.supportLineUrl; } catch {}
    if (document.getElementById("bp-support")) return;
    const a = document.createElement("a");
    a.id = "bp-support";
    a.href = href;
    a.target = "_blank"; a.rel = "noopener";
    a.title = "ติดต่อทีมงาน BARN-PARK ทาง LINE";
    a.innerHTML = '<span style="font-size:20px">💬</span><span>ช่วยเหลือ</span>';
    a.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:9999;display:flex;align-items:center;gap:8px;background:#06C755;color:#fff;font-family:inherit;font-weight:700;font-size:14px;text-decoration:none;padding:11px 16px;border-radius:999px;box-shadow:0 8px 24px rgba(6,199,85,.4)";
    const add = () => document.body && document.body.appendChild(a);
    if (document.body) add(); else document.addEventListener("DOMContentLoaded", add);
  }
})();
