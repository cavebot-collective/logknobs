const { _electron } = require("playwright");
(async () => {
  const app = await _electron.launch({ args: ["electron/main.js", "--no-sandbox", "--disable-gpu"], env: { ...process.env, GITLOG_REPO: "/home/claude/fixture" } });
  const win = await app.firstWindow(); await win.waitForSelector("#term .sp");
  const n = await win.locator("#ctl-list .ctl").count();
  const spans = await win.locator("#term .sp").count();
  const tpl = await win.inputValue("#tpl");
  console.log(`controls rendered: ${n}, preview spans: ${spans}, template: ${tpl}`);
  await win.screenshot({ path: "tests/smoke.png" });
  await app.close();
})().catch(e => { console.log("SMOKE FAILED:", e.message.split("\n")[0]); process.exit(1); });
