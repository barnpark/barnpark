// รายการอัปเดต (lib/changelog.js) → ข้อความประกาศใน 📣 แจ้งอัปเดต + จำว่าประกาศไปแล้ว (lib/announce.js)
const Setting = (await import("../models/Setting.js")).default;
const { CHANGELOG, composeAnnouncement } = await import("../lib/changelog.js");
const { changelogStatus } = await import("../lib/announce.js");

let ok = 0, bad = 0;
const t = (n, c, x) => { if (c) ok++; else { bad++; console.log("FAIL", n, x !== undefined ? JSON.stringify(x).slice(0, 300) : ""); } };

const ids = CHANGELOG.map((c) => c.id);
t("ids are unique", new Set(ids).size === ids.length, ids);
t("every entry has date/title/items", CHANGELOG.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.date) && c.title && Array.isArray(c.items) && c.items.length));
t("newest first", CHANGELOG.every((c, i) => !i || CHANGELOG[i - 1].date >= c.date));
for (const c of CHANGELOG) {
  const a = composeAnnouncement([c.id]);
  t(`compose ${c.id}: title = entry title, fits limits`, a.title === c.title.slice(0, 80) && Array.from(a.title).length <= 80 && Array.from(a.message).length <= 1500 && c.items.every((i) => a.message.includes(i.slice(0, 20))), a);
}
const all = composeAnnouncement(ids);
t("compose many: combined title + all sections, within limits", all.title.startsWith("อัปเดตใหม่: ") && Array.from(all.title).length <= 80 && Array.from(all.message).length <= 1500, all);
t("unknown ids ignored", composeAnnouncement(["nope"]).title === "");

let log = [{ at: new Date(), title: "x", changelogIds: [ids[1]] }];
Setting.findOne = () => ({ lean: async () => ({ key: "announce:log", value: log }) });
const st = await changelogStatus();
t("sent entries marked, others new", st.find((c) => c.id === ids[1]).sent === true && st.filter((c) => c.sent).length === 1, st.map((c) => [c.id, c.sent]));

console.log(`changelog: ${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
