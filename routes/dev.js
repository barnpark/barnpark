import { Router } from "express";
import crypto from "crypto";
import { applyCallback } from "../lib/devjobs.js";

// GitHub Actions (workflow line-job.yml) แจ้งผลงานกลับมาที่นี่ → ระบบแจ้งคนสั่งงานทาง LINE
// ต้องส่ง header x-dev-secret ให้ตรงกับ env DEV_JOB_SECRET (อย่างน้อย 16 ตัวอักษร)
const r = Router();

const sameSecret = (given, expected) => {
  const a = Buffer.from(String(given || "")), b = Buffer.from(String(expected || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
};

r.post("/job-callback", async (req, res) => {
  const secret = process.env.DEV_JOB_SECRET || "";
  if (secret.length < 16 || !sameSecret(req.get("x-dev-secret"), secret)) return res.status(401).json({ error: "unauthorized" });
  try { res.json(await applyCallback(req.body || {})); }
  catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : "error" }); }
});

export default r;
