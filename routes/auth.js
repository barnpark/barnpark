import { Router } from "express";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { sign, requireAuth } from "../lib/auth.js";

const r = Router();

r.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  const u = await User.findOne({ email: (email || "").toLowerCase() }).select("+passwordHash");
  if (!u || !u.passwordHash || !bcrypt.compareSync(password || "", u.passwordHash))
    return res.status(401).json({ error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
  res.json({ token: sign(u), user: { id: u._id, email: u.email, role: u.role, hotel: u.hotel, name: u.name } });
});

r.get("/me", requireAuth, async (req, res) => {
  const u = await User.findById(req.user.id).populate("hotel");
  if (!u) return res.status(404).json({ error: "not found" });
  res.json({ id: u._id, email: u.email, role: u.role, hotel: u.hotel, name: u.name });
});

export default r;
