import { Router } from "express";
import crypto from "crypto";
import Hotel from "../models/Hotel.js";

const r = Router();

// Webhook ต่อโรงแรม — ตั้งใน LINE Developers Console เป็น:
//   https://<your-app>.onrender.com/api/line/webhook/<slug>
// เมื่อเจ้าของ (หรือใครก็ตาม) ทักแชตเข้า OA ระบบจะตอบ userId กลับไป
// เอาไว้ก็อปวางในช่อง "LINE ผู้รับแจ้งเตือน" ของหน้าตั้งค่า
r.post("/webhook/:slug", async (req, res) => {
  const h = await Hotel.findOne({ slug: req.params.slug }).select("+lineChannelToken +lineChannelSecret");
  if (!h || !h.lineChannelToken) return res.sendStatus(200); // ตอบ 200 เสมอ กัน LINE retry

  // ตรวจลายเซ็น (ถ้าตั้ง secret ไว้)
  if (h.lineChannelSecret) {
    const sig = req.get("x-line-signature") || "";
    const expected = crypto.createHmac("sha256", h.lineChannelSecret).update(req.rawBody || Buffer.from("")).digest("base64");
    if (sig !== expected) return res.sendStatus(401);
  }

  const events = (req.body && req.body.events) || [];
  for (const ev of events) {
    const uid = ev?.source?.userId;
    const gid = ev?.source?.groupId;
    if (ev.type === "message" && ev.replyToken) {
      const id = gid || uid || "";
      const msg = gid
        ? `groupId ของกลุ่มนี้คือ:\n${gid}\nนำไปวางในช่อง "LINE ผู้รับแจ้งเตือน" ในหน้าตั้งค่า BARN-PARK`
        : `userId ของคุณคือ:\n${uid}\nนำไปวางในช่อง "LINE ผู้รับแจ้งเตือน" ในหน้าตั้งค่า BARN-PARK เพื่อรับแจ้งเตือนเมื่อมีจองใหม่`;
      try {
        await fetch("https://api.line.me/v2/bot/message/reply", {
          method: "POST",
          headers: { authorization: "Bearer " + h.lineChannelToken, "content-type": "application/json" },
          body: JSON.stringify({ replyToken: ev.replyToken, messages: [{ type: "text", text: msg }] }),
        });
      } catch (e) { console.error("line reply", e); }
    }
  }
  res.sendStatus(200);
});

export default r;
