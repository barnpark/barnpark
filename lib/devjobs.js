// ===== รับงานแก้เว็บจาก LINE Barn Park → ส่งให้ Claude Code บน GitHub Actions =====
// ทีมพิมพ์ในแชท: "งาน: เพิ่มช่องเบอร์ WhatsApp ในหน้าจอง"
//   1) เช็กว่าเป็น LINE ที่อนุญาต (DEV_LINE_USERS + ADMIN_LINE_TO)
//   2) บันทึก DevJob แล้วสั่ง GitHub รัน workflow .github/workflows/line-job.yml (workflow_dispatch)
//   3) Claude Code แก้โค้ด → รันทดสอบ → เปิด Pull Request + ทำไฟล์ zip (ไม่ merge เอง)
//   4) GitHub เรียก POST /api/dev/job-callback กลับมา → แจ้งผลทาง LINE ให้คนสั่ง
// env: GITHUB_TOKEN (fine-grained, เฉพาะ repo นี้, สิทธิ์ Actions: Read and write)
//      GITHUB_REPO (เช่น bell/barn-park) · DEV_LINE_USERS (userId คั่นด้วย ,) · DEV_JOB_SECRET (ตรงกับ GitHub secret)
//      DEV_GITHUB_REF (ไม่บังคับ ค่าเริ่มต้น main) · DEV_WORKFLOW (ไม่บังคับ ค่าเริ่มต้น line-job.yml)
import DevJob from "../models/DevJob.js";
import Setting from "../models/Setting.js";
import * as L from "./line.js";
import * as U from "./lineui.js";

const LINE_UID = /^U[0-9a-f]{32}$/i;

// LINE ที่สั่งงานได้: DEV_LINE_USERS + แอดมิน (ADMIN_LINE_TO ถ้าเป็น userId ไม่ใช่กลุ่ม)
export function devUsers() {
  const ids = String(process.env.DEV_LINE_USERS || "").split(/[\s,]+/).filter((x) => LINE_UID.test(x));
  const admin = String(process.env.ADMIN_LINE_TO || "").trim();
  if (LINE_UID.test(admin)) ids.push(admin);
  return [...new Set(ids)];
}
export const devAllowed = (uid) => !!uid && devUsers().includes(String(uid));
export const devReady = () => !!(process.env.GITHUB_TOKEN && /^[\w.-]+\/[\w.-]+$/.test(String(process.env.GITHUB_REPO || "")));

const STATUS_TH = { queued: "⏳ รอคิว", sent: "📨 ส่งให้ Claude Code แล้ว", running: "🛠 กำลังทำ", done: "✅ เสร็จ รอตรวจ/merge", nochange: "ℹ️ ไม่มีการแก้", failed: "⚠️ ไม่สำเร็จ" };
export const statusTh = (s) => STATUS_TH[s] || s;

async function nextNo() {
  const s = await Setting.findOneAndUpdate({ key: "devjob:seq" }, { $inc: { value: 1 } }, { upsert: true, new: true }).lean();
  return Number(s && s.value) || 1;
}

// สั่ง GitHub รัน workflow (ตอบ 204 = สำเร็จ)
export async function dispatchToGitHub(job) {
  const repo = String(process.env.GITHUB_REPO || "");
  const wf = encodeURIComponent(process.env.DEV_WORKFLOW || "line-job.yml");
  const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${wf}/dispatches`, {
    method: "POST",
    headers: {
      authorization: "Bearer " + process.env.GITHUB_TOKEN,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "barnpark-line-agent",
      "content-type": "application/json",
    },
    body: JSON.stringify({ ref: process.env.DEV_GITHUB_REF || "main", inputs: { job_id: String(job.no), request: job.text, requester: job.byName || "" } }),
  });
  if (r.status !== 204) {
    const t = await r.text().catch(() => "");
    throw new Error(`GitHub ตอบ ${r.status}` + (r.status === 404 ? " (ไม่พบ repo/workflow หรือ token ไม่มีสิทธิ์)" : r.status === 401 || r.status === 403 ? " (token ไม่ถูกต้องหรือไม่มีสิทธิ์ Actions)" : "") + (t ? ": " + t.slice(0, 160) : ""));
  }
}

// สร้างงานจากข้อความใน LINE แล้วส่งต่อให้ GitHub
export async function createDevJob({ text, uid, name = "" }) {
  const clean = String(text || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, 2000);
  if (Array.from(clean).length < 5) throw Object.assign(new Error("พิมพ์รายละเอียดงานต่อจาก “งาน:” เช่น งาน: เพิ่มช่องเบอร์ WhatsApp ในหน้าจอง"), { status: 400 });
  const recent = await DevJob.countDocuments({ by: uid, createdAt: { $gt: new Date(Date.now() - 3600e3) } });
  if (recent >= 10) throw Object.assign(new Error("ส่งงานได้ไม่เกิน 10 งานต่อชั่วโมง รอสักครู่แล้วลองใหม่"), { status: 429 });
  const no = await nextNo();
  const job = await DevJob.create({ no, text: clean, by: uid, byName: String(name || "").slice(0, 60), status: "queued" });
  try {
    await dispatchToGitHub(job);
    await DevJob.updateOne({ _id: job._id }, { $set: { status: "sent" } });
    job.status = "sent";
  } catch (e) {
    const msg = String(e.message || e).slice(0, 300);
    await DevJob.updateOne({ _id: job._id }, { $set: { status: "failed", error: msg, finishedAt: new Date() } });
    job.status = "failed"; job.error = msg;
  }
  return job;
}

export async function listDevJobs(n = 5) {
  return DevJob.find().sort({ no: -1 }).limit(Math.max(1, Math.min(20, n))).lean();
}

export function fmtJobLine(j) {
  const head = `#${j.no} ${statusTh(j.status)}`;
  const body = U.cut(String(j.text || "").replace(/\s+/g, " "), 70);
  const link = j.prUrl ? "\n🔍 " + j.prUrl : j.runUrl && j.status !== "sent" ? "\n🔗 " + j.runUrl : "";
  return `${head}\n${body}${link}`;
}

// ---- ผลจาก GitHub (POST /api/dev/job-callback) ----
const CB_STATUS = new Set(["running", "done", "nochange", "failed"]);
const ghUrl = (v) => (/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(pull|actions\/runs)\/\d+(\/[\w/-]*)?$/.test(String(v || "")) ? String(v) : "");
const str = (v, n) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, n);

export async function applyCallback(b = {}) {
  const no = parseInt(b.job, 10);
  if (!(no > 0)) throw Object.assign(new Error("job ไม่ถูกต้อง"), { status: 400 });
  if (!CB_STATUS.has(b.status)) throw Object.assign(new Error("status ไม่ถูกต้อง"), { status: 400 });
  const job = await DevJob.findOne({ no }).lean();
  if (!job) throw Object.assign(new Error("ไม่พบงาน"), { status: 404 });
  const set = { status: b.status };
  if (b.summary) set.summary = str(b.summary, 1500);
  if (ghUrl(b.prUrl)) set.prUrl = ghUrl(b.prUrl);
  if (ghUrl(b.runUrl)) set.runUrl = ghUrl(b.runUrl);
  if (b.tests) set.tests = str(b.tests, 20);
  if (b.error) set.error = str(b.error, 500);
  if (b.status !== "running") set.finishedAt = new Date();
  await DevJob.updateOne({ _id: job._id }, { $set: set });
  const merged = { ...job, ...set };
  // แจ้งคนสั่งงานเมื่อจบงาน (ข้อความ push 1 ข้อความ) — ตอน "กำลังทำ" ไม่แจ้ง เพื่อประหยัดโควตา
  if (b.status !== "running" && job.status !== b.status) {
    try { await L.push(job.by, [jobResultMessage(merged)]); } catch (e) { console.error("devjob push", e.message); }
  }
  return { ok: true, no, status: b.status };
}

export function jobResultMessage(j) {
  const tag = j.status === "done" ? (j.tests === "success" ? "✅ งานเสร็จ · ทดสอบผ่าน" : "⚠️ งานเสร็จ · ทดสอบไม่ผ่าน") : j.status === "nochange" ? "ℹ️ ไม่มีการแก้ไฟล์" : "⚠️ งานไม่สำเร็จ";
  const color = j.status === "done" && j.tests === "success" ? U.C.green : j.status === "nochange" ? U.C.muted : U.C.amber;
  const lines = [
    U.T(U.cut(String(j.text || ""), 160), { size: "sm", color: U.C.muted }),
    U.sep(),
    j.summary ? U.T(U.cut(j.summary, 900), { size: "sm", color: U.C.navy, margin: "md" }) : null,
    j.error ? U.T("สาเหตุ: " + U.cut(j.error, 300), { size: "sm", color: U.C.red, margin: "md" }) : null,
    j.status === "done" ? U.T("ยังไม่ขึ้นเว็บจริง — ตรวจแล้วกด Merge ใน GitHub (หรือใช้ไฟล์ zip) เมื่อพร้อม", { size: "xs", color: U.C.muted, margin: "md" }) : null,
  ];
  const buttons = [
    j.prUrl ? U.btn(U.uri("🔍 ดูการแก้ / Merge", j.prUrl)) : null,
    j.runUrl ? U.btn(U.uri(j.status === "done" ? "⬇ ไฟล์ zip" : "📄 ดูบันทึกการทำงาน", j.runUrl), "secondary") : null,
  ];
  return U.flex(`งาน #${j.no}: ${tag}`, U.bubble({ tag, tagColor: color, title: `งาน #${j.no}`, lines, buttons }));
}
