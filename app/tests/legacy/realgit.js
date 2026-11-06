const { _electron } = require("playwright");
(async () => {
  const app = await _electron.launch({ args: ["electron/main.js", "--no-sandbox", "--disable-gpu"], env: { ...process.env, GITLOG_REPO: "/home/claude/fixture" } });
  const win = await app.firstWindow(); await win.waitForSelector("#term .sp");
  const visible = await win.locator("#gitmode").isVisible();
  await win.evaluate(() => { const g = window.__gitlog; g.setTemplate("%h %<(14,trunc)%an %s", "t"); });
  const sim = await win.locator("#term").textContent();
  await win.check("#realgit"); await win.waitForFunction(() => document.getElementById("status").textContent.startsWith("real git"));
  const real = await win.locator("#term").textContent(); const status = await win.locator("#status").textContent();
  // click a span to select, then screenshot the whole app for the record
  await win.uncheck("#realgit"); await win.waitForTimeout(150);
  await win.evaluate(() => { const g = window.__gitlog; g.setTemplate("%C(auto)%h%Creset %<(14,trunc)%an %s%d", "t"); g.S.sel = 3; g.update("t"); });
  await win.hover('#term .sp[data-i="3"]'); await win.waitForTimeout(100);
  await win.screenshot({ path: "tests/final.png" });
  await app.close();
  const lines = real.trim().split("\n");
  console.log(`real-git toggle visible: ${visible}\nstatus: ${status}\nreal git lines: ${lines.length} (simulated preview is 1 commit; real mode shows -3)\nfirst real line: ${JSON.stringify(lines[0])}\nsimulated line:  ${JSON.stringify(sim.trim())}`);
  console.log(`REAL-GIT MODE: ${visible && lines.length === 3 && status.includes("fixture") ? "PASS" : "FAIL"}`);
})().catch(e => { console.log("ERR", e.message.split("\n")[0]); process.exit(1); });
