// หน้าต้อนรับ Barn Park = บ้านพัก (public/welcome.html) + สคริปต์ที่พาไปหน้านี้ใน public/index.html
// รันสคริปต์ในหน้าเว็บจริงด้วย vm กับ location / localStorage / document จำลอง — ไม่ต้องมีเบราว์เซอร์
import { readFileSync } from "fs";
import vm from "vm";

const root = new URL("../", import.meta.url);
const index = readFileSync(new URL("public/index.html", root), "utf8");
const welcome = readFileSync(new URL("public/welcome.html", root), "utf8");

let ok = 0, bad = 0;
const t = (n, c, x) => { if (c) ok++; else { bad++; console.log("FAIL", n, x !== undefined ? JSON.stringify(x).slice(0, 300) : ""); } };
const eq = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

// ---- ตัวพาไปหน้าต้อนรับ: สคริปต์แรกใน <head> ของหน้าแรก
const head = index.slice(0, index.indexOf("</head>"));
const m = /<script>([\s\S]*?)<\/script>/.exec(head);
const code = m ? m[1] : "";
t("index.html has the welcome redirect in <head>", code.includes('location.replace("/welcome.html")'));
t("it runs before the page's stylesheets", head.indexOf("/welcome.html") > 0 && head.indexOf("/welcome.html") < head.indexOf('rel="stylesheet"'));

const run = ({ path = "/", search = "", hash = "", ls = {}, ref = "", ua = "Mozilla/5.0 (iPhone)", webdriver = false } = {}) => {
  const store = { ...ls }, went = [];
  vm.runInNewContext(code, {
    location: { pathname: path, search, hash, origin: "https://barnpark.onrender.com", replace: (u) => went.push(u) },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    document: { referrer: ref },
    navigator: { userAgent: ua, webdriver },
  });
  return { went, store };
};
let r = run();
t("first visit to / → welcome.html", eq(r.went, ["/welcome.html"]), r);
t("/index.html too", run({ path: "/index.html" }).went.length === 1);
t("seen it before → stays on the homepage", run({ ls: { bp_welcomed: "1" } }).went.length === 0);
t("chose a language before → stays", run({ ls: { bp_lang: "th" } }).went.length === 0);
t("link to a section (#owners) → stays", run({ hash: "#owners" }).went.length === 0);
t("link with ?… → stays", run({ search: "?utm_source=line" }).went.length === 0);
r = run({ ref: "https://barnpark.onrender.com/book.html?h=barnbarn" });
t("came from another page of the site → stays and remembers", r.went.length === 0 && r.store.bp_welcomed === "1", r);
t("came from another website → welcome", run({ ref: "https://www.google.com/" }).went.length === 1);
t("look-alike domain is not our site", run({ ref: "https://barnpark.onrender.com.example.net/" }).went.length === 1);
t("search engine bot → stays", run({ ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }).went.length === 0);
t("link preview (Facebook / LINE) → stays", run({ ua: "facebookexternalhit/1.1" }).went.length === 0);
t("automated browser → stays", run({ webdriver: true }).went.length === 0);
t("other paths served by the catch-all → stays", run({ path: "/some/page" }).went.length === 0);
let threw = false;
try {
  vm.runInNewContext(code, { location: { pathname: "/", search: "", hash: "", origin: "x", replace() {} }, localStorage: { getItem() { throw new Error("blocked"); } }, document: { referrer: "" }, navigator: {} });
} catch { threw = true; }
t("storage blocked (private mode) → no error, homepage still loads", !threw);

// ---- หน้าต้อนรับ
t("5 speaker buttons, each with the Thai text to read", (welcome.match(/class="spk[^"]*" data-say="[^"]+" data-rate="[\d.]+"/g) || []).length === 5);
t("photos come from the map API through a URL check", welcome.includes('fetch("/api/public/map")') && welcome.includes("okUrl(h.cover)"));
t("no redirect of its own", !welcome.includes("location.replace"));
t("links back into the site: Enter, ภาษาไทย, Skip, activities", ["en", "th", "skip"].every((g) => welcome.includes(`data-go="${g}"`)) && welcome.includes('href="/#activities"'));

// ปุ่มเข้าเว็บ: จำว่าเห็นแล้ว + ภาษา
const wcode = (/<script>([\s\S]*?)<\/script>/.exec(welcome) || [])[1] || "";
const press = (go, ls = {}) => {
  const store = { ...ls }; let onClick = null;
  const el = (g) => ({ getAttribute: (k) => (k === "data-go" ? g : null), addEventListener: (_e, fn) => { if (g === go) onClick = fn; } });
  const box = { hidden: true, remove() {}, querySelectorAll: () => [] };
  vm.runInNewContext(wcode, {
    document: { querySelectorAll: (s) => (s === "[data-go]" ? ["skip", "th", "en"].map(el) : []), getElementById: () => box },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    window: {}, fetch: () => Promise.reject(new Error("offline")),
  });
  if (onClick) onClick();
  return store;
};
t("Enter Barn Park → English site", eq(press("en"), { bp_welcomed: "1", bp_lang: "en" }), press("en"));
t("ภาษาไทย → Thai site", eq(press("th"), { bp_welcomed: "1", bp_lang: "th" }));
t("Skip with no language yet → English", eq(press("skip"), { bp_welcomed: "1", bp_lang: "en" }));
t("Skip keeps a language chosen before", eq(press("skip", { bp_lang: "th" }), { bp_welcomed: "1", bp_lang: "th" }));
t("English chosen on the welcome page wins over an old Thai choice", eq(press("en", { bp_lang: "th" }), { bp_welcomed: "1", bp_lang: "en" }));

console.log(`welcome: ${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
