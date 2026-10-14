// ให้ error ใน route แบบ async ไปถึงตัวจัดการ error ของ Express 4
// (ไม่งั้น request จะค้างจนหมดเวลา เช่น id ผิดรูปแบบ → CastError)
import Layer from "express/lib/router/layer.js";

const orig = Layer.prototype.handle_request;
Layer.prototype.handle_request = function handle(req, res, next) {
  const fn = this.handle;
  if (fn.length > 3) return orig.call(this, req, res, next); // error middleware ปล่อยตามเดิม
  try {
    const ret = fn(req, res, next);
    if (ret && typeof ret.catch === "function") ret.catch(next);
  } catch (e) { next(e); }
};
