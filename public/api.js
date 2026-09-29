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
  function applyBrand(c) { if (c) document.documentElement.style.setProperty("--brand", c); }
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
    me: () => req("GET", "/auth/me"),
    get: (p) => req("GET", p), post: (p, b) => req("POST", p, b), patch: (p, b) => req("PATCH", p, b), del: (p) => req("DELETE", p),
    pubHotel: (slug) => pub("/hotel/" + encodeURIComponent(slug)),
    pubServices: (slug) => pub("/services/" + encodeURIComponent(slug)),
    pubAvailability: (slug, din, dout) => pub("/availability?slug=" + encodeURIComponent(slug) + "&din=" + din + "&dout=" + dout),
    pubBook: async (b) => { const r = await fetch("/api/public/book", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "error"); return d; },
    money, ymd, addDays, nights, thDate, esc, applyBrand, CHAN, chColor, shortCh, toast, signOut: () => { clear(); location.href = "login.html"; },
  };
})();
