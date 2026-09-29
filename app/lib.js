// ============================================================
// Barn Pak · shared library (loaded after supabase-js UMD + config.js)
// Exposes window.EB with the client, auth helpers, and small utilities.
// ============================================================
(function () {
  const cfg = window.EB_CONFIG || {};
  if (!window.supabase) { console.error("supabase-js not loaded"); }
  const sb = window.supabase.createClient(cfg.url, cfg.key, {
    auth: { persistSession: true, autoRefreshToken: true }
  });

  const CUR = cfg.currency || "฿";

  // ---- formatting ----
  const money = n => CUR + Number(n || 0).toLocaleString("th-TH");
  const pad = n => String(n).length < 2 ? "0" + n : String(n);
  function ymd(d) { const x = new Date(d); return x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate()); }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function nights(a, b) { return Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000)); }
  // Thai short date "24 ก.ค." from an ISO date
  const THM = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
  function thDate(d) { const x = new Date(d); return x.getDate() + " " + THM[x.getMonth()]; }
  const CHANNELS = { direct:"จองตรง", walkin:"Walk-in", phone:"โทรศัพท์", line:"LINE",
                     agoda:"Agoda", booking:"Booking.com", trip:"Trip.com", other:"อื่น ๆ" };
  // colour class per channel
  function chColor(ch){ return ({direct:"c0",agoda:"c1",booking:"c2",trip:"c3"})[ch] || "c4"; }

  // ---- toast ----
  function toast(msg, kind) {
    let t = document.getElementById("eb-toast");
    if (!t) { t = document.createElement("div"); t.id = "eb-toast"; document.body.appendChild(t);
      t.style.cssText = "position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:999;" +
        "background:#152238;color:#fff;padding:11px 18px;border-radius:10px;font-size:14px;" +
        "box-shadow:0 8px 24px rgba(0,0,0,.3);opacity:0;transition:opacity .2s;max-width:90vw"; }
    t.style.background = kind === "err" ? "#b91c1c" : kind === "ok" ? "#047857" : "#152238";
    t.textContent = msg; t.style.opacity = "1";
    clearTimeout(t._h); t._h = setTimeout(() => { t.style.opacity = "0"; }, 2600);
  }

  // ---- auth ----
  async function currentProfile() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;
    const { data, error } = await sb.from("profiles").select("*, hotels(*)").eq("id", user.id).single();
    if (error) { console.warn(error); return { id: user.id, email: user.email, role: null }; }
    return Object.assign({ email: user.email }, data);
  }
  // Redirect to login if not signed in; optionally require a role.
  async function guard(requireRole) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.href = "login.html"; return null; }
    const p = await currentProfile();
    if (requireRole === "admin" && (!p || p.role !== "admin")) { location.href = "app.html"; return null; }
    return p;
  }
  async function signOut() { await sb.auth.signOut(); location.href = "login.html"; }

  // ---- per-hotel theming ----
  function darken(hex, f) {
    hex = (hex || "#0d9488").replace("#", "");
    if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
    const n = parseInt(hex, 16); f = f == null ? 0.85 : f;
    const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
    return "#" + [r, g, b].map(x => x.toString(16).padStart(2, "0")).join("");
  }
  function applyBrand(color) {
    if (!color) return;
    const r = document.documentElement;
    r.style.setProperty("--brand", color);
    r.style.setProperty("--brand2", darken(color, 0.85));
  }

  window.EB = { sb, cfg, money, ymd, thDate, addDays, nights, CHANNELS, chColor,
                toast, currentProfile, guard, signOut, applyBrand, darken };
})();
