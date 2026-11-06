/*
 * Real-git mode (desktop host only). The page builds the argument list; the
 * host runs `git log` with whitelisted flags in GITLOG_REPO.
 *   visible     the toggle exists in the desktop build
 *   agrees      in single and history mode, real git's output equals the
 *               simulator's preview (text) for the same settings
 *   refuses     a flag outside the whitelist, and a config key outside it,
 *               are refused by the host, not run
 */
const { launch, call, gate, TOPO } = require("./lib");
const G = gate("REAL-GIT — desktop host");
(async () => {
  const { app, win, errors } = await launch({ GITLOG_REPO: TOPO("verbose") });
  G.ck("visible", "toggle", await win.locator("#gitmode").isVisible());
  const text = () => win.evaluate(() => document.getElementById("term").textContent);
  for (const [mode, tpl, opts] of [["history", "%h %<(12,trunc)%an %s%d", { graph: "on", refs: "all" }], ["history", "%C(auto)%h%d%n%w(50,2,4)%b", { order: "date", refs: "all" }]]) {
    await win.evaluate(([m, t, o]) => { const g = window.__logknobs; g.setPreviewMode(m); g.setCase(2); g.setTemplate(t, "rg");
      for (const [k, v] of Object.entries(o)) g.setOption(k, v); g.select(-1); }, [mode, tpl, opts]);
    const sim = await text();
    await win.check("#realgit"); await win.waitForFunction(() => document.getElementById("status").textContent.startsWith("real git"));
    const real = await text(); const status = await win.textContent("#status");
    G.ck("agrees", `${mode} ${tpl}`, real === sim && status.includes("topo-verbose"), status);
    await win.uncheck("#realgit");
    await win.evaluate(() => { const g = window.__logknobs; for (const [k, d] of Object.entries(g.REGISTRY.options)) g.setOption(k, d.default); });
  }
  const r1 = await win.evaluate(() => window.gitlog.run({ config: [], args: ["--output=/tmp/x", "--format=%h"] }));
  G.ck("refuses", "--output", !r1.ok && /refused flag/.test(r1.error));
  const r2 = await win.evaluate(() => window.gitlog.run({ config: ["-c", "core.pager=sh"], args: ["--format=%h"] }));
  G.ck("refuses", "core.pager", !r2.ok && /refused config/.test(r2.error));
  const r3 = await win.evaluate(() => window.gitlog.run({ config: ["-c", "log.graphColors=blue"], args: ["--graph", "--format=%h", "-2"] }));
  G.ck("allows", "whitelisted", r3.ok && r3.stdout.startsWith("* "), JSON.stringify(r3).slice(0, 120));
  G.ck("runtime", "no page errors", !errors.length, errors.join(" | "));
  await win.mouse.move(2, 2); await win.screenshot({ path: require("node:path").join(__dirname, "results", "realgit.png") });
  await app.close(); process.exit(G.report() ? 1 : 0);
})().catch(e => { console.log("REAL-GIT ERROR:", e.stack.split("\n").slice(0, 3).join(" | ")); process.exit(2); });
