/*
 * Oracle B -- the preview panel versus REAL git's bytes, pixel-compared.
 * Oracle A proves the simulator's bytes equal git's; this proves the UI paints
 * them faithfully: color attributes and backgrounds, padded columns, wide
 * glyphs, wrapped indents, the graph -- under several terminal themes.
 *
 * The reference is git's own output painted through the same painter and CSS
 * in the same window, so the only variable is where the bytes came from. A
 * negative control (one SGR sequence stripped) must produce a difference, or
 * the comparison proves nothing.
 */
const fs = require("node:fs"); const { PNG } = require("pngjs");
const pixelmatch = require("pixelmatch").default || require("pixelmatch");
const { launch, call, gate, git, TOPO, FIXTURE, STYLES } = require("./lib");
const OUT = require("node:path").join(__dirname, "results", "oracle-b"); fs.mkdirSync(OUT, { recursive: true });
const G = gate("ORACLE-B — preview pixels vs real git bytes");
const SINGLE = [
  { name: "color-pad-conventional", caseIdx: 1, tpl: "%C(auto)%h%Creset %C(always,green)%<(14,trunc)%an%Creset %C(always,blue)%s%Creset%d" },
  { name: "attrs-rightpad-terse", caseIdx: 0, tpl: "%C(bold ul italic)%h%Creset %>(30)%s|%C(always,226)%as%Creset" },
  { name: "wrap-cjk-verbose", caseIdx: 2, tpl: "%C(always,#ff8800)%h%Creset%n%w(40,2,4)%b" },
  { name: "trailers-center-conventional", caseIdx: 1, tpl: "%><(40)%s|%n%C(always,magenta)%(trailers:key=Signed-off-by,valueonly)%Creset" },
  { name: "bg-negation-verbose", caseIdx: 2, tpl: "%C(red blue)%h%Creset %C(reverse yellow)%s%Creset %C(bold nobold #00ff88 #202040)%d%Creset" },
];
const HISTORY = [
  { name: "graph-auto-all", caseIdx: 1, tpl: "%C(auto)%h%d %s", opts: { graph: "on", refs: "all" } },
  { name: "graph-twoline-date", caseIdx: 2, tpl: "%C(auto)%h %C(green)%as%Creset%n%s", opts: { graph: "on", refs: "all", order: "date" } },
  { name: "graph-colors-config", caseIdx: 0, tpl: "%h %s%C(auto)%d", opts: { graph: "on", refs: "all" }, config: { "log.graphColors": "blue, 208, #00ff00", "color.decorate.branch": "reverse cyan" } },
];
const THEMES = ["Campbell", "One Half Light", "Solarized Dark", "Campbell Powershell", "logknobs"];

(async () => {
  const { app, win, errors } = await launch();
  const recs = await win.evaluate(() => window.__logknobs.RECORDS.map(r => r.H));
  const shot = async name => { await win.mouse.move(2, 2); await win.waitForTimeout(60); const p = `${OUT}/${name}.png`; await win.locator("#term").screenshot({ path: p }); return p; };
  const cmp = (a, b, d) => { const A = PNG.sync.read(fs.readFileSync(a)), B = PNG.sync.read(fs.readFileSync(b));
    if (A.width !== B.width || A.height !== B.height) return -1;
    const D = new PNG({ width: A.width, height: A.height }); const n = pixelmatch(A.data, B.data, D.data, A.width, A.height, { threshold: 0.05 });
    fs.writeFileSync(d, PNG.sync.write(D)); return n; };
  // git's bytes, painted with the span boundaries the app used for its own
  // preview (renderModel().segs), so run structure is identical; if git's
  // bytes differ from the simulator's, text, colors and alignment all differ
  const paint = (bytes, theme) => win.evaluate(([b, th]) => { const g = window.__logknobs;
    document.getElementById("term").innerHTML = g.paintSegs(b, g.renderModel().segs, g.REGISTRY.themes[th], false); }, [bytes, theme]);
  async function compare(group, name, bytes, theme) {
    const appShot = await shot(`${name}.app`);
    await paint(bytes, theme); const refShot = await shot(`${name}.ref`);
    const diff = cmp(appShot, refShot, `${OUT}/${name}.diff.png`);
    const mutated = bytes.replace(/\x1b\[[0-9;]*[1-9][0-9;]*m/, "");
    if (mutated === bytes) throw new Error(`precondition: no SGR to strip in ${name}`);
    await paint(mutated, theme); const negShot = await shot(`${name}.neg`);
    const neg = cmp(refShot, negShot, `${OUT}/${name}.negdiff.png`);
    G.ck(group, name, diff === 0 && neg > 0, `app-vs-ref ${diff}px, negative control ${neg}px`);
  }
  for (const theme of THEMES) {
    await call(win, "setTheme", theme);
    await call(win, "setPreviewMode", "single");
    for (const c of SINGLE) {
      if (theme !== "Campbell" && !["color-pad-conventional", "bg-negation-verbose"].includes(c.name)) continue;
      await win.evaluate(({ tpl, ci }) => { const g = window.__logknobs; g.setCase(ci); g.setTemplate(tpl, "oracle-b"); g.select(-1); }, { tpl: c.tpl, ci: c.caseIdx });
      const bytes = git(FIXTURE, ["-1", "--color=always", `--format=${c.tpl}`, recs[c.caseIdx]]).replace(/\n$/, "");
      await compare(`single · ${theme}`, `${c.name}.${theme.replace(/ /g, "_")}`, bytes, theme);
    }
    await call(win, "setPreviewMode", "history");
    for (const h of HISTORY) {
      if (theme !== "Campbell" && h.name !== "graph-auto-all") continue;
      await win.evaluate(({ h }) => { const g = window.__logknobs; g.setCase(h.caseIdx); g.setTemplate(h.tpl, "oracle-b");
        for (const [k, v] of Object.entries(h.opts)) g.setOption(k, v); for (const [k, v] of Object.entries(h.config || {})) g.setConfig(k, v); g.select(-1); }, { h });
      const { config, args } = await call(win, "gitArgs");
      const bytes = git(TOPO(STYLES[h.caseIdx]), [...args, "--color=always", "-40"], config, { GIT_CONFIG_GLOBAL: "/dev/null" });
      await compare(`history · ${theme}`, `${h.name}.${theme.replace(/ /g, "_")}`, bytes, theme);
      await win.evaluate(() => { const g = window.__logknobs; for (const k of Object.keys(g.C.options.config)) g.setConfig(k, ""); for (const [k, d] of Object.entries(g.REGISTRY.options)) g.setOption(k, d.default); });
    }
  }
  G.ck("runtime", "no page errors", !errors.length, errors.join(" | "));
  await app.close(); process.exit(G.report() ? 1 : 0);
})().catch(e => { console.log("ORACLE B ERROR:", e.stack.split("\n").slice(0, 3).join(" | ")); process.exit(2); });
