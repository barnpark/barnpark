// npm test — ไม่ต้องมีฐานข้อมูลหรืออินเทอร์เน็ต
//   1) ตรวจ syntax ทุกไฟล์ .js/.mjs  2) ตรวจ <script> ในหน้าเว็บ public/*.html  3) รัน test/*.test.mjs ทีละไฟล์
import { readdirSync, readFileSync, statSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import vm from "vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let fails = 0;
const mark = (ok, msg, detail) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) { fails++; if (detail) console.log(String(detail).trim().split("\n").slice(0, 12).map((l) => "    " + l).join("\n")); } };

// 1) syntax ของไฟล์ JavaScript ทั้งหมด
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    if (f === "node_modules" || f === ".git") continue;
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(m?js)$/.test(f)) files.push(p);
  }
})(root);
let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
  if (r.status !== 0) { bad++; mark(false, "syntax " + relative(root, f), r.stderr); }
}
if (!bad) mark(true, `syntax ไฟล์ JS ${files.length} ไฟล์`);

// 2) <script> ในหน้า HTML (สคริปต์แบบธรรมดา ไม่ใช่ module/json)
let scripts = 0;
for (const f of readdirSync(join(root, "public")).filter((x) => x.endsWith(".html"))) {
  const html = readFileSync(join(root, "public", f), "utf8");
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let m, i = 0;
  while ((m = re.exec(html))) {
    const attrs = m[1] || "";
    if (/\bsrc=/.test(attrs) || (/\btype=/.test(attrs) && !/type=["']?(text\/javascript|application\/javascript)/i.test(attrs))) continue;
    i++; scripts++;
    try { new vm.Script(m[2], { filename: `${f}#script${i}` }); }
    catch (e) { mark(false, `syntax ${f} <script> ที่ ${i}`, e.message); }
  }
}
mark(true, `syntax <script> ในหน้าเว็บ ${scripts} ชุด`);

// 3) ชุดทดสอบ
for (const f of readdirSync(join(root, "test")).filter((x) => x.endsWith(".test.mjs")).sort()) {
  const r = spawnSync(process.execPath, [join(root, "test", f)], { encoding: "utf8", cwd: root, timeout: 120000 });
  const out = (r.stdout || "") + (r.stderr || "");
  const last = out.trim().split("\n").filter((l) => /passed|failed/.test(l)).pop() || "";
  mark(r.status === 0, `${f}${last ? " — " + last : ""}`, r.status === 0 ? "" : out);
}

console.log(fails ? `\n✗ ไม่ผ่าน ${fails} รายการ` : "\n✓ ผ่านทั้งหมด");
process.exit(fails ? 1 : 0);
