// Screenshots for the delivery record (not a gate).
const { launch, call } = require("./lib");
(async () => { const { app, win } = await launch();
  const S = require("node:path").join(__dirname, "results") + "/";
  await win.evaluate(() => { const g = window.__logknobs; g.setTemplate("%C(auto)%h%Creset %C(green) -- %Creset%<(14,trunc)%an %s%C(auto)%d", "s"); g.setCase(2); g.select(4); });
  await win.mouse.move(2, 2); await win.screenshot({ path: S + "screen-single-literal.png" });
  await win.evaluate(() => { const g = window.__logknobs; g.setPreviewMode("history"); g.setGraph("on"); g.setRefs("all"); g.setTokenView("bnf"); g.select(7); });
  await win.mouse.move(2, 2); await win.screenshot({ path: S + "screen-history-grammar.png" });
  await win.evaluate(() => { const g = window.__logknobs; g.applyPreset("lg2"); g.setTheme("One Half Light"); g.setTokenView("blocks"); g.select(-1); });
  await win.mouse.move(2, 2); await win.screenshot({ path: S + "screen-preset-light.png" });
  await app.close(); })();
