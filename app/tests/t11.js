/*
 * T11 -- undo/redo. History is a list of canonical states {template, options};
 * undo and redo are setHistoryIndex(i-1) and (i+1). Asserted:
 *   exact restore  a seeded sequence of edits through every kind of setter;
 *                  undo walks back through every recorded state exactly, redo
 *                  walks forward exactly
 *   branch         an edit after undo truncates the redo branch
 *   coalesce       keystrokes in the template field within history.coalesce_ms
 *                  are one step; a pause longer than it starts a new step
 *   limit          the stack never exceeds history.limit
 *   keys           Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y outside text fields
 *   view state     undo does not move theme or preview mode
 */
const { launch, call, gate, REG } = require("./lib");
const G = gate("T11 — undo/redo");
(async () => {
  const { app, win, errors } = await launch();
  const C = () => win.evaluate(() => JSON.stringify(window.__logknobs.C));
  const H = () => win.evaluate(() => ({ n: window.__logknobs.H.stack.length, i: window.__logknobs.H.idx }));
  let seed = 7; const rnd = n => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  const ops = [
    () => call(win, "insertToken", ["%an", "%s", "%ad", "%n", "%x41"][rnd(5)]),
    () => call(win, "setOption", "date", REG.options.date.values[rnd(7)]),
    () => call(win, "setGraph", ["on", "off"][rnd(2)]),
    () => call(win, "setOneline", ["on", "off"][rnd(2)]),
    () => call(win, "insertLiteral", " | "),
    async () => { const n = (await win.evaluate(() => window.__logknobs.nodes().length)); if (n > 1) await call(win, "moveNode", rnd(n), rnd(n + 1)); },
    async () => { const n = (await win.evaluate(() => window.__logknobs.nodes().length)); if (n > 2) await call(win, "removeNode", rnd(n)); },
    async () => { const ns = await win.evaluate(() => window.__logknobs.nodes().map(n => n.kind)); const i = ns.findIndex(k => k === "value"); if (i >= 0) await call(win, "setColor", i, "red", "this-part"); },
    async () => { const ns = await win.evaluate(() => window.__logknobs.nodes().map(n => n.kind + ":" + (n.tok || ""))); const i = ns.findIndex(k => /^value:%[a-z]$/.test(k)); if (i >= 0) await call(win, "setPadding", i, { mode: "<", width: 9 + rnd(5), truncate: "trunc" }); },
    () => call(win, "setConfig", "log.graphColors", ["blue", "red, green", ""][rnd(3)]),
  ];
  await call(win, "setTemplate", "%h %s", "t11");
  const states = [await C()];
  for (let k = 0; k < 60; k++) { await ops[rnd(ops.length)](); const s = await C(); if (s !== states.at(-1)) states.push(s); }
  G.ck("exact restore", "edits recorded", (await H()).i >= states.length - 1, JSON.stringify(await H()));
  let ok = true;
  for (let k = states.length - 2; k >= 0; k--) { await call(win, "undo"); if ((await C()) !== states[k]) { ok = false; G.ck("exact restore", `undo to state ${k}`, false); break; } }
  G.ck("exact restore", `undo through ${states.length - 1} states`, ok);
  ok = true;
  for (let k = 1; k < states.length; k++) { await call(win, "redo"); if ((await C()) !== states[k]) { ok = false; break; } }
  G.ck("exact restore", `redo through ${states.length - 1} states`, ok);
  // branch truncation
  await call(win, "undo"); await call(win, "undo"); await call(win, "setTemplate", "%H branch", "t11");
  const h = await H();
  G.ck("branch", "edit after undo truncates redo", h.i === h.n - 1 && await win.isDisabled("#redo"));
  // view state is not history
  await call(win, "setTheme", "One Half Dark"); await call(win, "setPreviewMode", "history"); await call(win, "undo");
  G.ck("view state", "undo keeps theme and preview mode", await win.evaluate(() => window.__logknobs.V.theme === "One Half Dark" && window.__logknobs.V.preview === "history"));
  // coalescing keystrokes
  await call(win, "setTemplate", "%h", "t11"); const before = await H();
  await win.click("#tpl"); await win.keyboard.press("End"); await win.keyboard.type(" %s %an", { delay: 20 });
  const mid = await H();
  G.ck("coalesce", "fast typing is one step", mid.n === before.n + 1, `${before.n} -> ${mid.n}`);
  await win.waitForTimeout(REG.config["history.coalesce_ms"] + 150); await win.keyboard.type("x");
  G.ck("coalesce", "a pause starts a new step", (await H()).n === mid.n + 1);
  await win.click("#term");     // leave the text field
  await win.keyboard.press("Control+z");
  G.ck("keys", "Ctrl+Z undoes", (await win.evaluate(() => window.__logknobs.C.template)) === "%h %s %an");
  await win.keyboard.press("Control+Shift+z");
  G.ck("keys", "Ctrl+Shift+Z redoes", (await win.evaluate(() => window.__logknobs.C.template)) === "%h %s %anx");
  await win.keyboard.press("Control+z"); await win.keyboard.press("Control+y");
  G.ck("keys", "Ctrl+Y redoes", (await win.evaluate(() => window.__logknobs.C.template)) === "%h %s %anx");
  // limit
  for (let k = 0; k < REG.config["history.limit"] + 15; k++) await win.evaluate(k => window.__logknobs.setTemplate("%h" + "x".repeat(k % 97 + 1) + k, "t11"), k);
  G.ck("limit", `stack <= history.limit (${REG.config["history.limit"]})`, (await H()).n === REG.config["history.limit"]);
  G.ck("runtime", "no page errors", !errors.length, errors.join(" | "));
  await app.close(); process.exit(G.report() ? 1 : 0);
})().catch(e => { console.log("T11 ERROR:", e.stack.split("\n").slice(0, 3).join(" | ")); process.exit(2); });
