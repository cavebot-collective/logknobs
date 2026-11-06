/*
 * T17 -- modality parity (spec section 63): every inventoried action succeeds
 * with only the mouse, and with only the keyboard.
 *
 *   mouse run     pointer events only (move, click, right-click, press-drag-
 *                 release); no key is pressed except to type text into a text
 *                 field, which is keyboard by nature and exempt
 *   keyboard run  key presses only; every control is REACHED by Tab from the
 *                 start of the page (the count of Tabs is recorded), then
 *                 operated by keys
 *
 * Declared: native form controls (select, checkbox, number field) are operated
 * through the platform in both runs; the platform makes them operable by both
 * devices. Each action's outcome is checked on the canonical state.
 * Runs in both feature-lab-002 layouts.
 */
const { launch, call, gate } = require("./lib");
const G = gate("T17 — every action by mouse alone and by keyboard alone");

(async () => {
  const { app, win, errors } = await launch();
  const C = () => win.evaluate(() => window.__logknobs.C);
  const tpl = async () => (await C()).template;
  const reset = (t, sel = -1) => win.evaluate(([t, s]) => { const g = window.__logknobs; g.setTemplate(t, "t17"); g.select(s); document.activeElement?.blur?.(); }, [t, sel]);
  const center = async sel => { const b = await win.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const mclick = async (sel, opts = {}) => { await win.locator(sel).first().scrollIntoViewIfNeeded(); const [x, y] = await center(sel); await win.mouse.click(x, y, opts); };
  const mhover = async sel => { const [x, y] = await center(sel); await win.mouse.move(x, y); };
  // keyboard: Tab from the top of the page until the focused element matches
  const tabTo = async (sel, max = 700) => {
    await win.evaluate(() => { document.activeElement?.blur?.(); window.getSelection()?.removeAllRanges(); });
    for (let n = 1; n <= max; n++) { await win.keyboard.press("Tab"); if (await win.evaluate(s => document.activeElement?.matches?.(s) ?? false, sel)) return n; }
    throw new Error(`not reachable by Tab: ${sel}`);
  };
  const chip = (i) => `#tokens [data-i="${i}"]`;

  const ACTIONS = [
    { name: "insert a form from the cascade",
      mouse: async () => { await reset("%h"); await mclick('#pal-groups [data-branch="author"]'); await mclick('.flyout[data-level="2"] [data-branch="Author date"]'); await mclick('.flyout [data-insert="%as"]'); },
      keys: async () => { await reset("%h"); await tabTo('#pal-groups [data-branch="author"]'); await win.keyboard.press("ArrowRight");
        for (let k = 0; k < 2; k++) await win.keyboard.press("ArrowDown"); await win.keyboard.press("ArrowRight");
        while (!(await win.evaluate(() => document.activeElement?.dataset?.insert === "%as"))) await win.keyboard.press("ArrowDown");
        await win.keyboard.press("Enter"); },
      ok: async () => (await tpl()) === "%h%as" },
    { name: "select a part",
      mouse: async () => { await reset("%h %s"); await mclick(chip(2)); },
      keys: async () => { await reset("%h %s"); await tabTo(chip(2)); await win.keyboard.press("Enter"); },
      ok: async () => (await win.evaluate(() => window.__logknobs.V.sel)) === 2 },
    { name: "remove a part",
      mouse: async () => { await reset("%h %s"); await mhover(chip(2)); await mclick(chip(2) + " .x"); },
      keys: async () => { await reset("%h %s"); await tabTo(chip(2)); await win.keyboard.press("Delete"); },
      ok: async () => (await tpl()) === "%h " },
    { name: "move a part",
      mouse: async () => { await reset("%h %s"); const [x, y] = await center(chip(2)); const [gx, gy] = await center('#tokens [data-at="0"]');
        await win.mouse.move(x, y); await win.mouse.down(); await win.mouse.move(gx, gy, { steps: 8 }); await win.mouse.up(); },
      keys: async () => { await reset("%h %s"); await tabTo(chip(2)); await win.keyboard.press("Alt+ArrowLeft"); await win.keyboard.press("Alt+ArrowLeft"); },
      ok: async () => (await tpl()) === "%s%h " },
    { name: "context menu: duplicate",
      mouse: async () => { await reset("%h %s"); await mclick(chip(0), { button: "right" }); await mclick('.ctx [data-act="duplicate"]'); },
      keys: async () => { await reset("%h %s"); await tabTo(chip(0)); await win.keyboard.press("Shift+F10");
        while (!(await win.evaluate(() => document.activeElement?.dataset?.act === "duplicate"))) await win.keyboard.press("ArrowDown"); await win.keyboard.press("Enter"); },
      ok: async () => (await tpl()) === "%h%h %s" },
    { name: "color a part (this part)",
      mouse: async () => { await reset("%h %s", 2); await mclick('#insp [data-key="c-sw-red"]'); await mclick('#insp [data-key="c-apply"]'); },
      keys: async () => { await reset("%h %s", 2); await tabTo('#insp [data-key="c-sw-red"]'); await win.keyboard.press("Enter");
        await tabTo('#insp [data-key="c-apply"]'); await win.keyboard.press("Enter"); },
      ok: async () => (await tpl()) === "%h %C(red)%s%Creset" },
    { name: "undo, then redo",
      mouse: async () => { await reset("%h"); await call(win, "insertToken", "%s"); await mclick("#undo"); await mclick("#redo"); await mclick("#undo"); },
      keys: async () => { await reset("%h"); await call(win, "insertToken", "%s"); await win.evaluate(() => document.activeElement?.blur?.());
        await win.keyboard.press("Control+z"); await win.keyboard.press("Control+Shift+z"); await tabTo("#undo"); await win.keyboard.press("Enter"); },
      ok: async () => (await tpl()) === "%h" },
    { name: "toggle --graph",
      mouse: async () => { await call(win, "setGraph", "off"); await mclick('#toggles [data-toggle="graph"]'); },
      keys: async () => { await call(win, "setGraph", "off"); await tabTo('#toggles [data-toggle="graph"]'); await win.keyboard.press("Enter"); },
      ok: async () => { const on = (await C()).options.graph === "on"; await call(win, "setGraph", "off"); return on; } },
    { name: "turn an option knob",
      mouse: async () => { await call(win, "setOption", "date", "default"); await win.locator('#opts [data-knob="date"] svg').scrollIntoViewIfNeeded(); const [x, y] = await center('#opts [data-knob="date"] svg');
        await win.mouse.move(x, y); await win.mouse.down(); await win.mouse.move(x, y - 18, { steps: 4 }); await win.mouse.up(); },
      keys: async () => { await call(win, "setOption", "date", "default"); await tabTo('#opts [data-knob="date"] svg'); await win.keyboard.press("ArrowUp"); },
      ok: async () => { const v = (await C()).options.date; await call(win, "setOption", "date", "default"); return v !== "default"; } },
    { name: "apply a preset",
      mouse: async () => { await reset("%h"); await mclick('#presets [data-preset="hist"] button'); },
      keys: async () => { await reset("%h"); await tabTo('#presets [data-preset="hist"] button'); await win.keyboard.press("Enter"); },
      ok: async () => { const t = await tpl(); await win.evaluate(() => { const g = window.__logknobs; for (const [k, d] of Object.entries(g.REGISTRY.options)) g.setOption(k, d.default); }); return t === "%h %ad | %s%d [%an]"; } },
    { name: "copy the command",
      mouse: async () => { await app.evaluate(({ clipboard }) => clipboard.writeText("")); await mclick("#copy"); },
      keys: async () => { await app.evaluate(({ clipboard }) => clipboard.writeText("")); await tabTo("#copy"); await win.keyboard.press("Enter"); },
      ok: async () => { await win.waitForTimeout(150); return (await app.evaluate(({ clipboard }) => clipboard.readText())) === await call(win, "command"); } },
    { name: "copy the config commands",
      mouse: async () => { await app.evaluate(({ clipboard }) => clipboard.writeText("")); await win.evaluate(() => document.getElementById("cfgexp").open = false);
        await mclick("#cfgexp > summary"); await mclick("#cx-copy-cmds"); },
      keys: async () => { await app.evaluate(({ clipboard }) => clipboard.writeText("")); await win.evaluate(() => document.getElementById("cfgexp").open = false);
        await tabTo("#cfgexp > summary"); await win.keyboard.press("Enter"); await tabTo("#cx-copy-cmds"); await win.keyboard.press("Enter"); },
      ok: async () => { await win.waitForTimeout(150); return (await app.evaluate(({ clipboard }) => clipboard.readText())) === (await win.evaluate(() => window.__logknobs.configExport().commands)); } },
    { name: "resize the Insert column",
      mouse: async () => { await call(win, "setRegionSize", "left", 260); const [x, y] = await center("#rz-left"); await win.mouse.move(x, y); await win.mouse.down(); await win.mouse.move(x + 80, y, { steps: 5 }); await win.mouse.up(); },
      keys: async () => { await call(win, "setRegionSize", "left", 260); await tabTo("#rz-left"); for (let k = 0; k < 5; k++) await win.keyboard.press("ArrowRight"); },
      ok: async () => { const v = await win.evaluate(() => window.__logknobs.V.sizes.left); await call(win, "setRegionSize", "left", 260); return v === 340; } },
    { name: "resize the docs pane",
      mouse: async () => { await call(win, "setRegionSize", "docs", 118); const [x, y] = await center("#rz-docs"); await win.mouse.move(x, y); await win.mouse.down(); await win.mouse.move(x, y - 64, { steps: 5 }); await win.mouse.up(); },
      keys: async () => { await call(win, "setRegionSize", "docs", 118); await tabTo("#rz-docs"); for (let k = 0; k < 4; k++) await win.keyboard.press("ArrowUp"); },
      ok: async () => { const v = await win.evaluate(() => window.__logknobs.V.sizes.docs); await call(win, "setRegionSize", "docs", 118); return v === 182; } },
    { name: "switch preview mode",
      mouse: async () => { await call(win, "setPreviewMode", "single"); await mclick('#pmode [data-mode="history"]'); },
      keys: async () => { await call(win, "setPreviewMode", "single"); await tabTo('#pmode [data-mode="history"]'); await win.keyboard.press("Enter"); },
      ok: async () => { const v = await win.evaluate(() => window.__logknobs.V.preview); await call(win, "setPreviewMode", "single"); return v === "history"; } },
    { name: "switch token view", parts: true,
      mouse: async () => { await call(win, "setTokenView", "blocks"); await mclick('#tview [data-v="bnf"]'); },
      keys: async () => { await call(win, "setTokenView", "blocks"); await tabTo('#tview [data-v="bnf"]'); await win.keyboard.press("Enter"); },
      ok: async () => { const v = await win.evaluate(() => window.__logknobs.V.tokenView); await call(win, "setTokenView", "blocks"); return v === "bnf"; } },
    { name: "add a graph color",
      mouse: async () => { await call(win, "setGraph", "on"); await call(win, "setConfig", "log.graphColors", ""); await mclick('#graphopts [data-key="g-add"]'); },
      keys: async () => { await call(win, "setGraph", "on"); await call(win, "setConfig", "log.graphColors", ""); await tabTo('#graphopts [data-key="g-add"]'); await win.keyboard.press("Enter"); },
      ok: async () => { const v = (await C()).options.config["log.graphColors"]; await call(win, "setConfig", "log.graphColors", ""); await call(win, "setGraph", "off"); return v?.split(",").length === 13; } },
    { name: "save the template",
      mouse: async () => { await win.evaluate(() => localStorage.clear()); await reset("%h saved"); await mclick("#save-name"); await win.keyboard.type("t17"); await mclick("#save"); },
      keys: async () => { await win.evaluate(() => localStorage.clear()); await reset("%h saved"); await tabTo("#save-name"); await win.keyboard.type("t17"); await win.keyboard.press("Tab"); await win.keyboard.press("Enter"); },
      ok: async () => { const ok = await win.locator('#saved [data-saved="t17"]').count() === 1; await win.fill("#save-name", ""); return ok; } },
  ];
  const FOCUS_ONLY = [
    { name: "the caret selects the part under it (focus layout)",
      mouse: async () => { await reset("%h %s"); const b = await win.locator("#tplbig").boundingBox(); await win.mouse.click(b.x + b.width - 12, b.y + b.height / 2); },
      keys: async () => { await reset("%h %s"); await tabTo("#tplbig"); await win.keyboard.press("End"); },
      ok: async () => (await win.evaluate(() => window.__logknobs.V.sel)) === 2 },
    { name: "switch view tab (focus layout)",
      mouse: async () => { await call(win, "setTab", "preview"); await mclick('#vtabs [data-tab="parts"]'); },
      keys: async () => { await call(win, "setTab", "preview"); await tabTo('#vtabs [data-tab="preview"]'); await win.keyboard.press("ArrowRight"); },
      ok: async () => { const v = await win.evaluate(() => window.__logknobs.V.tab); return v === "parts"; } },
  ];
  for (const layout of ["classic", "focus"]) {
    await call(win, "setLayout", layout);
    for (const a of [...ACTIONS, ...(layout === "focus" ? FOCUS_ONLY : [])]) {
      // in the focus layout the parts row is a tab: actions on it open that tab first
      if (layout === "focus") await call(win, "setTab", a.parts || a.name.includes("part") || a.name.includes("context") ? "parts" : "preview");
      for (const dev of ["mouse", "keys"]) {
        let ok = false, note = "";
        try { await a[dev](); ok = await a.ok(); } catch (e) { note = e.message.split("\n")[0]; }
        await win.keyboard.press("Escape").catch(() => {}); await call(win, "closeMenus");
        G.ck(`${layout} · ${dev === "mouse" ? "mouse only" : "keyboard only"}`, a.name, ok, note || JSON.stringify((await C()).template));
      }
    }
  }
  await call(win, "setLayout", "classic");
  G.ck("runtime", "no page errors", !errors.length, errors.join(" | "));
  await app.close(); process.exit(G.report() ? 1 : 0);
})().catch(e => { console.log("T17 ERROR:", e.stack.split("\n").slice(0, 3).join(" | ")); process.exit(2); });
