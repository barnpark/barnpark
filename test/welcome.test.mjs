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

const run = ({ path = "/", search = "", hash = "", ls = {}, ss = {}, ref = "", ua = "Mozilla/5.0 (iPhone)", webdriver = false } = {}) => {
  const store = { ...ls }, sess = { ...ss }, went = [];
  const mem = (o) => ({ getItem: (k) => (k in o ? o[k] : null), setItem: (k, v) => { o[k] = String(v); } });
  vm.runInNewContext(code, {
    location: { pathname: path, search, hash, origin: "https://barnpark.onrender.com", replace: (u) => went.push(u) },
    localStorage: mem(store), sessionStorage: mem(sess),
    document: { referrer: ref },
    navigator: { userAgent: ua, webdriver },
  });
  return { went, store, sess };
};
let r = run();
t("opening / from outside → welcome.html", eq(r.went, ["/welcome.html"]), r);
t("/index.html too", run({ path: "/index.html" }).went.length === 1);
t("every time: seen it on an earlier day → welcome again", run({ ls: { bp_welcomed: "1" } }).went.length === 1);
t("every time: chose a language before → welcome again", run({ ls: { bp_lang: "th" } }).went.length === 1);
t("link to a section (#owners) → stays", run({ hash: "#owners" }).went.length === 0);
t("link from Facebook (?fbclid=…) → welcome", run({ search: "?fbclid=IwAR0abc" }).went.length === 1);
t("link with utm tags (LINE / ads) → welcome", run({ search: "?utm_source=line&utm_medium=oa" }).went.length === 1);
r = run({ ref: "https://barnpark.onrender.com/book.html?h=barnbarn" });
t("came from another page of the site → stays", r.went.length === 0, r);
t("just pressed Enter on the welcome page in this tab → stays (no loop, even with no referrer)", run({ ss: { bp_entered: "1" } }).went.length === 0);
t("came from another website → welcome", run({ ref: "https://www.google.com/" }).went.length === 1);
t("look-alike domain is not our site", run({ ref: "https://barnpark.onrender.com.example.net/" }).went.length === 1);
t("search engine bot → stays", run({ ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }).went.length === 0);
t("link preview (Facebook / LINE) → stays", run({ ua: "facebookexternalhit/1.1" }).went.length === 0);
t("automated browser → stays", run({ webdriver: true }).went.length === 0);
t("other paths served by the catch-all → stays", run({ path: "/some/page" }).went.length === 0);
let threw = false;
try {
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  vm.runInNewContext(code, { location: { pathname: "/", search: "", hash: "", origin: "x", replace() {} }, localStorage: blocked, sessionStorage: blocked, document: { referrer: "" }, navigator: {} });
} catch { threw = true; }
t("storage blocked (private mode) → no error, homepage still loads", !threw);

// ---- หน้าต้อนรับ
t("5 speaker buttons, each with the Thai text to read", (welcome.match(/class="spk[^"]*" data-say="[^"]+" data-rate="[\d.]+"/g) || []).length === 5);
t("photos come from the map API through a URL check", welcome.includes('fetch("/api/public/map")') && welcome.includes("okUrl(h.cover)"));
t("no redirect of its own", !welcome.includes("location.replace"));
t("links back into the site: Enter, ภาษาไทย, Skip, activities", ["en", "th", "skip"].every((g) => welcome.includes(`data-go="${g}"`)) && welcome.includes('href="/#activities"'));

// ปุ่มเข้าเว็บ: ภาษา (localStorage) + บอกหน้าแรกว่าเพิ่งเข้ามาจากหน้านี้ (sessionStorage ของแท็บนี้)
const wcode = (/<script>([\s\S]*?)<\/script>/.exec(welcome) || [])[1] || "";
const press = (go, ls = {}) => {
  const store = { ...ls }, sess = {}; let onClick = null;
  const el = (g) => ({ getAttribute: (k) => (k === "data-go" ? g : null), addEventListener: (_e, fn) => { if (g === go) onClick = fn; } });
  const box = { hidden: true, remove() {}, querySelectorAll: () => [] };
  const mem = (o) => ({ getItem: (k) => (k in o ? o[k] : null), setItem: (k, v) => { o[k] = String(v); } });
  vm.runInNewContext(wcode, {
    document: { querySelectorAll: (s) => (s === "[data-go]" ? ["skip", "th", "en"].map(el) : []), getElementById: () => box },
    localStorage: mem(store), sessionStorage: mem(sess),
    window: {}, fetch: () => Promise.reject(new Error("offline")),
  });
  if (onClick) onClick();
  return { ...store, entered: sess.bp_entered };
};
t("Enter Barn Park → English site", eq(press("en"), { bp_lang: "en", entered: "1" }), press("en"));
t("ภาษาไทย → Thai site", eq(press("th"), { bp_lang: "th", entered: "1" }));
t("Skip with no language yet → English", eq(press("skip"), { bp_lang: "en", entered: "1" }));
t("Skip keeps a language chosen before", eq(press("skip", { bp_lang: "th" }), { bp_lang: "th", entered: "1" }));
t("English chosen on the welcome page wins over an old Thai choice", eq(press("en", { bp_lang: "th" }), { bp_lang: "en", entered: "1" }));
// หน้าต้อนรับ → กดเข้าเว็บ → หน้าแรก: ไม่วนกลับมาหน้าต้อนรับ แม้เบราว์เซอร์ไม่ส่ง referrer
const entered = press("en");
t("after pressing Enter the homepage stays put (no redirect loop)", run({ ss: { bp_entered: entered.entered }, ls: { bp_lang: entered.bp_lang } }).went.length === 0);

// รูปที่พัก: ลิงก์รูปปกแบบเดียวกับที่ /api/public/map ส่งจริง (มี ?v=…)
const photos = async (list) => {
  const figs = ["barnbarn", "kok-eden-farm-kabin-buri", "paleo-pateo"].map((slug) => ({ slug, ph: { style: {} }, removed: false }));
  const box = {
    removed: false, remove() { this.removed = true; },
    querySelectorAll: () => figs.map((f) => ({ getAttribute: () => f.slug, querySelector: () => f.ph, remove: () => { f.removed = true; } })),
  };
  vm.runInNewContext(wcode, {
    document: { querySelectorAll: () => [], getElementById: (id) => (id === "photos" ? box : { hidden: true }) },
    localStorage: { getItem: () => null, setItem() {} }, sessionStorage: { getItem: () => null, setItem() {} }, window: {},
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(list) }),
  });
  for (let i = 0; i < 5; i++) await new Promise((res) => setTimeout(res, 0));
  return { figs: figs.map((f) => (f.removed ? "-" : f.ph.style.backgroundImage || "")), boxRemoved: box.removed };
};
const ID = "6ad04dbf825e5bef1fbabb67";
let ph = await photos([
  { slug: "barnbarn", cover: `/api/public/img/cover/${ID}/0?v=1732170000000` },
  { slug: "kok-eden-farm-kabin-buri", cover: "https://abc.supabase.co/storage/v1/object/public/covers/k.jpg" },
  { slug: "paleo-pateo", cover: `/api/public/img/cover/${ID}/0?v=1") url("https://evil.example/x.png` },
]);
t("cover link with ?v=… (as the map API sends it) is shown", ph.figs[0] === `url("/api/public/img/cover/${ID}/0?v=1732170000000")`, ph);
t("https cover is shown", ph.figs[1] === 'url("https://abc.supabase.co/storage/v1/object/public/covers/k.jpg")', ph);
t("a cover link that could break out of url(\"…\") is dropped, the rest stay", ph.figs[2] === "-" && !ph.boxRemoved, ph);
ph = await photos([{ slug: "barnbarn", cover: "" }, { slug: "@753ctjdq", cover: `/api/public/img/cover/${ID}/0?v=1` }]);
t("no usable cover → the whole photo block is hidden", ph.boxRemoved && ph.figs.every((f) => f === "-"), ph);

console.log(`welcome: ${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
