// ตัวคำนวณต้นทุน Channex (lib/calc.js)
import { cleanCalc, channexUSD, tierRate } from "../lib/calc.js";

let ok = 0, bad = 0;
const t = (name, cond) => { if (cond) ok++; else { bad++; console.log("FAIL", name); } };

const d = cleanCalc({});
t("defaults", d.fx === null && d.hotels === null && d.same === true && d.pf === 130 && d.ph === 7 && d.chat === false && d.extra === 0 && Array.isArray(d.prices) && d.prices.length === 0);
const c = cleanCalc({ fx: "33.5", hotels: "10", same: false, cxh: "4", pf: "130", ph: "7", chat: true, extra: "7", prices: [{ label: " First 10 ", thb: "800" }, { label: "", thb: "" }, { label: "x".repeat(80), thb: 1e9 }, { label: "<b>ok</b>", thb: -5 }] });
t("fx parsed", c.fx === 33.5); t("hotels int", c.hotels === 10); t("same false", c.same === false); t("cxh", c.cxh === 4);
t("chat true", c.chat === true); t("extra", c.extra === 7);
t("empty price row dropped", c.prices.length === 3);
t("label trimmed", c.prices[0].label === "First 10" && c.prices[0].thb === 800);
t("label capped at 40", c.prices[1].label.length === 40 && c.prices[1].thb === null);
t("negative price -> null", c.prices[2].thb === null && c.prices[2].label === "<b>ok</b>");
t("bad numbers", cleanCalc({ fx: "abc", hotels: -1, pf: "x", ph: 1e9, extra: 500 }).fx === null);
const b = cleanCalc({ fx: true, chat: "yes", same: "no", pf: 1e9, ph: -1, extra: 500 });
t("boolean fx rejected", b.fx === null); t("chat only when true", b.chat === false); t("same stays true unless false", b.same === true);
t("pf fallback", b.pf === 130); t("ph fallback", b.ph === 7); t("extra fallback", b.extra === 0);
t("max 12 prices", cleanCalc({ prices: Array.from({ length: 30 }, (_, i) => ({ label: "p" + i, thb: i + 1 })) }).prices.length === 12);
t("non-object body", cleanCalc(null).pf === 130 && cleanCalc("x").pf === 130);
t("tiers 499/500/1000/2000", tierRate(499, 7) === 7 && tierRate(500, 7) === 6 && tierRate(1000, 7) === 5 && tierRate(2000, 7) === 4);
t("100 hotels = $830 (Channex example)", channexUSD(100, { pf: 130, ph: 7 }) === 830);
t("0 hotels = platform fee", channexUSD(0, { pf: 130, ph: 7 }) === 130);
t("chat + 7% extra", Math.abs(channexUSD(10, { pf: 130, ph: 7, chat: true, extra: 7 }) - 288.9) < 1e-9);

console.log(`calc: ${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
