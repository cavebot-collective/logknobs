/*
 * T16 -- no identifying text is clipped (spec section 62).
 *
 * A label that names something -- a token, control, option, preset, section,
 * button -- must fit its box or wrap. Measured, not eyeballed:
 *   self-clip   an element with its own text whose overflow is not visible (or
 *               that ellipsizes) and whose content is wider than its box
 *   region      a side region, the top bar, the toolbar, the docs pane, a
 *               flyout or the context menu that scrolls sideways
 *   escape      text that sticks out of its region's box
 * Exempt by nature, and nothing else: the terminal and the parts row (scrolling
 * views), and native form fields (input, textarea, select: their value scrolls
 * inside them).
 *
 * States: every resizable region at its minimum and maximum (others at their
 * defaults) plus all defaults; both feature-lab-002 layouts; with a part
 * selected (Edit selected populated), the Insert cascade open three levels
 * deep, and the context menu open.
 */
const { launch, call, gate, REG } = require("./lib");
const G = gate("T16 — no clipped labels");
const EXEMPT = "#term, #tokens, input, textarea, select, option, svg, .vh, script, style";
const REGIONS = "#insert, #right, #top, #toolbar, #docs, .flyout, .ctx, #tokwrap > header, #scopeline, #status, #vtabs";

async function measure(win) {
  return win.evaluate(([EXEMPT, REGIONS]) => {
    const bad = [], vw = innerWidth;
    const name = e => (e.id ? "#" + e.id : e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).join(".") : "")) + ` “${e.textContent.trim().slice(0, 40)}”`;
    for (const reg of document.querySelectorAll(REGIONS)) {
      if (!reg.getClientRects().length) continue;
      if (reg.scrollWidth > reg.clientWidth + 1 && getComputedStyle(reg).overflowX !== "visible") bad.push(`region scrolls sideways: ${name(reg)} (${reg.scrollWidth} > ${reg.clientWidth})`);
      const R = reg.getBoundingClientRect();
      if (R.right > vw + 1) bad.push(`region leaves the window: ${name(reg)}`);
    }
    for (const e of document.querySelectorAll("body *")) {
      if (e.closest(EXEMPT) || !e.getClientRects().length) continue;
      if (![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
      const cs = getComputedStyle(e);
      if (cs.visibility === "hidden") continue;
      if ((cs.overflowX !== "visible" || cs.textOverflow === "ellipsis") && e.scrollWidth > e.clientWidth + 1) bad.push(`clipped: ${name(e)} (${e.scrollWidth} > ${e.clientWidth})`);
      const reg = e.closest(REGIONS);
      if (reg) { const r = e.getBoundingClientRect(), Q = reg.getBoundingClientRect();
        if (r.right > Q.right + 1 || r.left < Q.left - 1) bad.push(`escapes its region: ${name(e)} (${Math.round(r.left)}..${Math.round(r.right)} vs ${Math.round(Q.left)}..${Math.round(Q.right)})`); }
    }
    return [...new Set(bad)];
  }, [EXEMPT, REGIONS]);
}

(async () => {
  const { app, win, errors } = await launch();
  const sizes = [["all", "default", null]];
  for (const r of ["left", "right", "docs", "parts"]) for (const k of ["min", "max"]) sizes.push([r, k, REG.config[`layout.${r}.${k}`]]);
  const setDefaults = () => win.evaluate(cfg => { const g = window.__logknobs; for (const r of ["left", "right", "docs", "parts"]) g.setRegionSize(r, cfg[`layout.${r}.default`]); }, REG.config);
  for (const layout of ["classic", "focus"]) {
    for (const [region, k, px] of sizes) {
      await call(win, "setLayout", layout); await setDefaults();
      if (px !== null) await call(win, "setRegionSize", region, px);
      const label = `${layout} · ${region} ${k}`;
      // a populated state: a template with every kind of part, a color part selected
      await win.evaluate(() => { const g = window.__logknobs; g.setPreviewMode("history"); g.setGraph("on");
        g.setTemplate("%C(auto)%h%Creset %C(bold #ff8800)%<(14,trunc)%an%Creset %w(60,2,4)%s%n%(trailers:key=Signed-off-by,valueonly)%d", "t16"); g.select(4); });
      await win.mouse.move(2, 2);
      let bad = await measure(win);
      G.ck("edit selected + output + templates", label, !bad.length, bad.slice(0, 4).join(" | "));
      // the cascade open three levels deep (a control with many forms), then a micro-template control
      // in each of three groups, the control with the most forms (the widest, longest flyout)
      const paths = await win.evaluate(() => window.__logknobs.TREE.filter(g => ["author", "refs", "message"].includes(g.label))
        .map(g => [g.label, g.children.filter(c => c.children.length > 1).sort((a, b) => b.children.length - a.children.length)[0].label]));
      for (const [g, c] of paths) {
        await win.click(`#pal-groups [data-branch="${g}"]`); await win.click(`.flyout[data-level="2"] [data-branch="${c}"]`);
        bad = await measure(win);
        G.ck("insert cascade open", `${label} · ${g} › ${c}`, !bad.length, bad.slice(0, 4).join(" | "));
        await call(win, "closeMenus");
      }
      await win.fill("#pal-search", "date"); bad = await measure(win);
      G.ck("insert search results", label, !bad.length, bad.slice(0, 4).join(" | ")); await win.fill("#pal-search", "");
      if (layout === "classic" || true) {
        await call(win, "setTab", "parts");
        const sel = await win.evaluate(() => window.__logknobs.V.tokenView === "blocks" ? "#tokens .tk" : "#tokens .bl");
        try {
          await win.locator(sel).nth(1).click({ button: "right", timeout: 3000 });
          bad = await measure(win);
          G.ck("context menu open", label, !bad.length, bad.slice(0, 4).join(" | "));
        } catch (e) { G.ck("context menu open", label, false, "a part could not be right-clicked: " + e.message.split("\n")[0]); }
        await win.keyboard.press("Escape"); await call(win, "setTab", "preview");
      }
    }
  }
  await call(win, "setLayout", "classic"); await setDefaults();
  G.ck("runtime", "no page errors", !errors.length, errors.join(" | "));
  await app.close(); process.exit(G.report() ? 1 : 0);
})().catch(e => { console.log("T16 ERROR:", e.stack.split("\n").slice(0, 3).join(" | ")); process.exit(2); });
