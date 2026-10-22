// งานแก้เว็บผ่าน LINE → GitHub → Claude Code (lib/devjobs.js, routes/dev.js, คำสั่ง "งาน:" ใน lib/linebot.js)
// แทน fetch ด้วยตัวปลอม: จับว่าเรียก GitHub/LINE ถูกต้อง โดยไม่ออกอินเทอร์เน็ตจริง
const ALLOWED = "U" + "a".repeat(32), ADMIN = "U" + "b".repeat(32), STRANGER = "U" + "c".repeat(32);
Object.assign(process.env, {
  GITHUB_TOKEN: "gh-test-token", GITHUB_REPO: "bell/barn-park", DEV_LINE_USERS: `${ALLOWED}, not-an-id`,
  ADMIN_LINE_TO: ADMIN, LINE_CHANNEL_TOKEN: "line-test-token", DEV_JOB_SECRET: "s3cret-0123456789abcd",
});
const calls = [];
let githubStatus = 204;
globalThis.fetch = async (url, opt = {}) => {
  url = String(url);
  calls.push({ url, opt, body: opt.body ? JSON.parse(opt.body) : null });
  if (url.includes("api.github.com")) return new Response(githubStatus === 204 ? null : '{"message":"Not Found"}', { status: githubStatus });
  if (url.includes("/v2/bot/profile/")) return new Response('{"displayName":"เบลล์"}', { status: 200 });
  return new Response("{}", { status: 200 });
};

const express = (await import("express")).default;
const DevJob = (await import("../models/DevJob.js")).default;
const Setting = (await import("../models/Setting.js")).default;
const LineChat = (await import("../models/LineChat.js")).default;
const dj = await import("../lib/devjobs.js");
const devRoutes = (await import("../routes/dev.js")).default;
const { handleEvent } = await import("../lib/linebot.js");

let ok = 0, bad = 0;
const t = (n, c, x) => { if (c) ok++; else { bad++; console.log("FAIL", n, x !== undefined ? JSON.stringify(x) : ""); } };

// ---- ตัวปลอมของโมเดล
let seq = 0; const jobs = []; let recentCount = 0;
Setting.findOneAndUpdate = (q, u) => ({ lean: async () => ({ key: q.key, value: ++seq }) });
DevJob.countDocuments = async () => recentCount;
DevJob.create = async (doc) => { const j = { _id: "j" + doc.no, ...doc, createdAt: new Date() }; jobs.push(j); return { ...j }; };
DevJob.updateOne = async (q, u) => { const j = jobs.find((x) => x._id === q._id); if (j) Object.assign(j, u.$set); return { modifiedCount: j ? 1 : 0 }; };
DevJob.findOne = (q) => ({ lean: async () => { const j = jobs.find((x) => x.no === q.no); return j ? { ...j } : null; } });
DevJob.find = () => ({ sort: () => ({ limit: (n) => ({ lean: async () => jobs.slice().sort((a, b) => b.no - a.no).slice(0, n) }) }) });
const chats = {};
LineChat.findOne = (q) => ({ lean: async () => (chats[q.userId] ? { ...chats[q.userId] } : null) });
LineChat.create = async (d) => { chats[d.userId] = { _id: "c-" + d.userId, userId: d.userId, hotels: [], data: {}, flow: "", step: "" }; return chats[d.userId]; };
LineChat.updateOne = async () => ({ modifiedCount: 1 });

// ---- ใครสั่งงานได้
t("allowlist has DEV_LINE_USERS + ADMIN_LINE_TO only", JSON.stringify(dj.devUsers().sort()) === JSON.stringify([ALLOWED, ADMIN].sort()), dj.devUsers());
t("allowed user", dj.devAllowed(ALLOWED) && dj.devAllowed(ADMIN));
t("stranger not allowed", !dj.devAllowed(STRANGER) && !dj.devAllowed("") && !dj.devAllowed(undefined));
t("ready with token + repo", dj.devReady());
process.env.GITHUB_REPO = "not a repo"; t("not ready with bad repo", !dj.devReady()); process.env.GITHUB_REPO = "bell/barn-park";

// ---- สร้างงาน → สั่ง GitHub
let job = await dj.createDevJob({ text: "  เพิ่มช่องเบอร์ WhatsApp ในหน้าจอง  ", uid: ALLOWED, name: "เบลล์" });
const gh = calls.find((c) => c.url.includes("api.github.com"));
t("job sent", job.no === 1 && job.status === "sent" && jobs[0].status === "sent", job);
t("GitHub URL = workflow dispatch", gh && gh.url === "https://api.github.com/repos/bell/barn-park/actions/workflows/line-job.yml/dispatches", gh && gh.url);
t("GitHub auth header", gh && gh.opt.headers.authorization === "Bearer gh-test-token");
t("GitHub inputs", gh && gh.body.ref === "main" && gh.body.inputs.job_id === "1" && gh.body.inputs.request === "เพิ่มช่องเบอร์ WhatsApp ในหน้าจอง" && gh.body.inputs.requester === "เบลล์", gh && gh.body);
let err = null; try { await dj.createDevJob({ text: "แก้", uid: ALLOWED }); } catch (e) { err = e; }
t("too short -> 400", err && err.status === 400);
recentCount = 10; err = null; try { await dj.createDevJob({ text: "งานที่ยาวพอสมควร", uid: ALLOWED }); } catch (e) { err = e; }
t("10 jobs/hour limit -> 429", err && err.status === 429); recentCount = 0;
githubStatus = 404; job = await dj.createDevJob({ text: "งานที่ GitHub หาไม่เจอ", uid: ALLOWED });
t("GitHub 404 -> job failed with reason", job.status === "failed" && /404/.test(job.error) && jobs.find((j) => j.no === job.no).status === "failed", job);
githubStatus = 204;
t("long text capped at 2000", (await dj.createDevJob({ text: "ก".repeat(5000), uid: ALLOWED })).text.length === 2000);

// ---- ผลจาก GitHub (callback)
const app = express(); app.use(express.json()); app.use("/api/dev", devRoutes);
const srv = app.listen(0); const cb = `http://127.0.0.1:${srv.address().port}/api/dev/job-callback`;
const post = (body, secret = process.env.DEV_JOB_SECRET) => httpPost(cb, body, secret);
// เรียก API ในเครื่องด้วย node:http (fetch ถูกแทนด้วยตัวปลอมด้านบน)
async function httpPost(url, body, secret) {
  const http = await import("node:http");
  return new Promise((res, rej) => {
    const data = JSON.stringify(body);
    const req = http.request(url, { method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data), ...(secret ? { "x-dev-secret": secret } : {}) } }, (r) => {
      let s = ""; r.on("data", (c) => (s += c)); r.on("end", () => res({ status: r.statusCode, json: (() => { try { return JSON.parse(s); } catch { return null; } })() }));
    });
    req.on("error", rej); req.end(data);
  });
}
let r = await post({ job: 1, status: "done" }, ""); t("callback without secret 401", r.status === 401, r);
r = await post({ job: 1, status: "done" }, "wrong-secret-0123456789"); t("callback wrong secret 401", r.status === 401, r);
r = await post({ job: 999, status: "done" }); t("callback unknown job 404", r.status === 404, r);
r = await post({ job: 1, status: "merged" }); t("callback bad status 400", r.status === 400, r);
const pushesBefore = calls.filter((c) => c.url.includes("/message/push")).length;
r = await post({ job: 1, status: "running", runUrl: "https://github.com/bell/barn-park/actions/runs/123" });
t("running saved, no LINE push", r.status === 200 && jobs[0].status === "running" && calls.filter((c) => c.url.includes("/message/push")).length === pushesBefore, r);
r = await post({ job: 1, status: "done", tests: "success", summary: "เพิ่มช่อง WhatsApp ในหน้าจองแล้ว", prUrl: "https://github.com/bell/barn-park/pull/7", runUrl: "https://evil.example.com/x" });
const push = calls.filter((c) => c.url.includes("/message/push")).pop();
t("done saved", r.status === 200 && jobs[0].status === "done" && jobs[0].prUrl === "https://github.com/bell/barn-park/pull/7", jobs[0]);
t("non-GitHub link ignored", jobs[0].runUrl === "https://github.com/bell/barn-park/actions/runs/123", jobs[0].runUrl);
t("LINE push to requester", push && push.body.to === ALLOWED && push.body.messages[0].type === "flex", push && push.body);
t("LINE card has PR button", push && JSON.stringify(push.body.messages[0]).includes("https://github.com/bell/barn-park/pull/7"));
const n = calls.filter((c) => c.url.includes("/message/push")).length;
await post({ job: 1, status: "done", prUrl: "https://github.com/bell/barn-park/pull/7" });
t("repeated callback -> no second push", calls.filter((c) => c.url.includes("/message/push")).length === n);
process.env.DEV_JOB_SECRET = "short";
r = await post({ job: 1, status: "done" }, "short"); t("short secret on server -> always 401", r.status === 401, r);
process.env.DEV_JOB_SECRET = "s3cret-0123456789abcd";
srv.close();

// ---- คำสั่งใน LINE
const ev = (uid, text) => ({ type: "message", replyToken: "rt-" + Math.random(), source: { type: "user", userId: uid }, message: { type: "text", text } });
const lastReply = () => calls.filter((c) => c.url.includes("/message/reply")).pop();
let ghBefore = calls.filter((c) => c.url.includes("api.github.com")).length;
await handleEvent(ev(ALLOWED, "งาน: เปลี่ยนปุ่มจองเป็นสีเขียว\nในหน้า Rich"));
let rep = lastReply();
t("LINE: allowed user gets job number", rep && /รับงาน #\d+ แล้ว/.test(rep.body.messages[0].text), rep && rep.body);
t("LINE: job dispatched to GitHub", calls.filter((c) => c.url.includes("api.github.com")).length === ghBefore + 1);
t("LINE: multi-line request kept", jobs[jobs.length - 1].text === "เปลี่ยนปุ่มจองเป็นสีเขียว\nในหน้า Rich", jobs[jobs.length - 1].text);
ghBefore = calls.filter((c) => c.url.includes("api.github.com")).length;
await handleEvent(ev(STRANGER, "งาน: ลบข้อมูลทั้งหมด"));
t("LINE: stranger cannot create jobs", calls.filter((c) => c.url.includes("api.github.com")).length === ghBefore && !/รับงาน/.test((lastReply()?.body.messages[0].text) || ""));
await handleEvent(ev(ADMIN, "สถานะงาน"));
rep = lastReply();
t("LINE: status list for admin", rep && /งานล่าสุด/.test(rep.body.messages[0].text) && /#1 /.test(rep.body.messages[0].text), rep && rep.body.messages[0].text);
process.env.GITHUB_TOKEN = "";
await handleEvent(ev(ALLOWED, "งาน: ทดสอบตอนยังไม่ตั้งค่า"));
t("LINE: setup hint when GitHub not configured", /GITHUB_TOKEN/.test(lastReply().body.messages[0].text));

console.log(`devjobs: ${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
