/*
 * T13 -- templates and config export, against real git.
 *   presets       every preset, applied through its button, renders in the
 *                 history preview exactly what real git prints for the same
 *                 flags on the same repository (all three sample repositories);
 *                 the app's own command, run by git, prints the same bytes
 *   saved         save / apply / rename / delete; export -> import round trip;
 *                 a malformed import is refused
 *   config        the .gitconfig fragment and the git config commands, given to
 *                 real git: `git config` reads back the exact template, and the
 *                 alias prints exactly what the equivalent git log prints --
 *                 for templates chosen to stress escaping (quotes, backslash,
 *                 semicolon, hash, percent, leading space)
 */
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { execFileSync, execSync } = require("node:child_process");
const { launch, call, gate, git, REG, TOPO, STYLES } = require("./lib");
const G = gate("T13 — presets, saved templates, config export");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lk-t13-"));
const cleanEnv = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };

(async () => {
  const { app, win, errors } = await launch();
  // ------------------------------------------------------------- presets
  await call(win, "setPreviewMode", "history");
  for (const p of REG.presets) {
    for (const [ci, style] of STYLES.entries()) {
      await call(win, "setCase", ci);
      await win.click(`#presets [data-preset="${p.id}"] button`);
      const m = await win.evaluate(() => window.__logknobs.renderModel());
      const fmt = p.format === null ? [] : [`--format=tformat:${p.format}`];
      const want = git(TOPO(style), ["--color=always", "--decorate=short", ...p.args, ...fmt, "-40"], [], cleanEnv);
      G.ck("presets: preview == real git", `${p.id}/${style}`, !m.error && m.text === want, m.error || "");
      // the command the app copies, run by git with color forced as on a terminal
      const { config, args } = await call(win, "gitArgs");
      const fromCmd = git(TOPO(style), [...args, "--color=always", "--decorate=short", "-40"], config, cleanEnv);
      G.ck("presets: copied command == preset", `${p.id}/${style}`, fromCmd === want);
    }
  }
  // ------------------------------------------------------------- saved
  await win.evaluate(() => localStorage.clear());
  await call(win, "setTemplate", "%h %s", "t13"); await call(win, "setGraph", "on");
  await win.fill("#save-name", "mine"); await win.click("#save");
  const saved = await win.evaluate(() => window.__logknobs.C);
  await call(win, "setTemplate", "%H", "t13"); await call(win, "setGraph", "off");
  await win.click('#saved [data-saved="mine"] button:has-text("apply")');
  G.ck("saved: save then apply restores", "mine", JSON.stringify(await win.evaluate(() => window.__logknobs.C)) === JSON.stringify(saved));
  await win.fill("#save-name", "renamed"); await win.click('#saved [data-saved="mine"] button:has-text("rename")');
  G.ck("saved: rename", "mine -> renamed", await win.locator('#saved [data-saved="renamed"]').count() === 1 && await win.locator('#saved [data-saved="mine"]').count() === 0);
  const exported = await call(win, "exportTemplates");
  await win.click('#saved [data-saved="renamed"] button:has-text("delete")');
  G.ck("saved: delete", "renamed", await win.locator('#saved [data-saved="renamed"]').count() === 0);
  const n = await call(win, "importTemplates", exported);
  G.ck("saved: export -> import round trip", "renamed", n === 1 && JSON.stringify((await win.evaluate(() => JSON.parse(window.__logknobs.exportTemplates()).templates))[0].options) === JSON.stringify(saved.options));
  const refused = await win.evaluate(() => { try { window.__logknobs.importTemplates('{"schema":"x"}'); return false; } catch { return true; } });
  G.ck("saved: malformed import refused", "schema", refused);
  // file import through the UI
  const f = path.join(tmp, "t.json"); fs.writeFileSync(f, exported);
  await win.evaluate(() => localStorage.clear()); await win.setInputFiles("#import-file", f);
  await win.waitForFunction(() => document.querySelectorAll("#saved [data-saved]").length === 1);
  G.ck("saved: import through the file picker", "t.json", true);

  // ------------------------------------------------------------- config export
  const CASES = [
    ["plain", "%h %s", { graph: "on" }],
    ["quotes", `%h "%s" it's`, {}],
    ["backslash", "%h \\ %s \\\\", { refs: "all" }],
    ["semicolon-hash", "%h; #%s", { date: "short" }],
    ["percent-lead-space", " 100%% %C(auto)%d %s", { decorate: "full" }],
    ["colors", "%C(auto)%h%d %s", { graph: "on", refs: "all", order: "date", config: { "log.graphColors": "blue, 208", "color.decorate.branch": "bold #ff8800", "color.decorate.HEAD": "reverse cyan" } }],
    ["builtin-oneline", "%h", { pretty: "oneline", abbrev_commit: "on", graph: "on" }],
    ["first-parent-reverse", "%h %an", { first_parent: "on", reverse: "on", abbrev: 10 }],
  ];
  for (const [name, tpl, opts] of CASES) {
    await win.evaluate(([t, o]) => { const g = window.__logknobs; g.setTemplate(t, "t13");
      for (const [k, v] of Object.entries(o)) if (k === "config") for (const [ck, cv] of Object.entries(v)) g.setConfig(ck, cv); else g.setOption(k, v); }, [tpl, opts]);
    await win.evaluate(() => document.getElementById("cfgexp").open = true);
    const x = await win.evaluate(() => window.__logknobs.configExport("lkt", "lkt", false));
    const { config, args } = await call(win, "gitArgs");
    const direct = git(TOPO("verbose"), [...args, "--color=always"], config, cleanEnv);
    // fragment
    const frag = path.join(tmp, `${name}.gitconfig`); fs.writeFileSync(frag, x.fragment);
    if (x.prettyValue) {
      const back = execFileSync("git", ["config", "-f", frag, "pretty.lkt"]).toString().replace(/\n$/, "");
      G.ck("config: fragment reads back exactly", name, back === x.prettyValue, JSON.stringify(back));
    }
    const viaAlias = execFileSync("git", ["-C", TOPO("verbose"), "lkt", "--color=always"], { env: { ...process.env, GIT_CONFIG_GLOBAL: frag, GIT_CONFIG_SYSTEM: "/dev/null" } }).toString();
    G.ck("config: fragment alias == git log", name, viaAlias === direct);
    // commands, run by bash against a scratch global config
    const glob = path.join(tmp, `${name}.cmds`); fs.writeFileSync(glob, "");
    execSync(x.commands, { shell: "/bin/bash", env: { ...process.env, GIT_CONFIG_GLOBAL: glob, GIT_CONFIG_SYSTEM: "/dev/null" } });
    const viaCmds = execFileSync("git", ["-C", TOPO("verbose"), "lkt", "--color=always"], { env: { ...process.env, GIT_CONFIG_GLOBAL: glob, GIT_CONFIG_SYSTEM: "/dev/null" } }).toString();
    G.ck("config: commands alias == git log", name, viaCmds === direct);
    // the copied command itself, through bash
    const cmd = await call(win, "command");
    const viaShell = execSync(`${cmd.replace(/^git /, `git -C ${TOPO("verbose")} `)} --color=always`, { shell: "/bin/bash", env: { ...process.env, ...cleanEnv } }).toString();
    G.ck("command: bash-quoted command == git log", name, viaShell === direct, cmd);
    await win.evaluate(() => { const g = window.__logknobs; for (const k of Object.keys(g.C.options.config)) g.setConfig(k, "");
      for (const [k, d] of Object.entries(g.REGISTRY.options)) g.setOption(k, d.default); });
  }
  // copy buttons (spec section 65): the clipboard receives exactly the generated text
  await win.evaluate(() => { const g = window.__logknobs; g.setTemplate(`%h "%s" it's`, "t13"); g.setGraph("on"); document.getElementById("cfgexp").open = true; });
  for (const [btn, key] of [["#cx-copy-cmds", "commands"], ["#cx-copy-frag", "fragment"]]) {
    await app.evaluate(({ clipboard }) => clipboard.writeText("")); await win.evaluate(() => document.getElementById("notice").textContent = "");
    await win.click(btn);
    await win.waitForFunction(() => /^(copied|could not copy)/.test(document.getElementById("notice").textContent));
    G.ck("config: copy reports success", key, (await win.textContent("#notice")).startsWith("copied"), await win.textContent("#notice"));
    const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
    const want = (await win.evaluate(() => window.__logknobs.configExport()))[key];
    G.ck("config: copy button copies exactly", key, clip === want && clip.length > 0);
    const fits = await win.evaluate(k => { const ta = document.getElementById(k === "commands" ? "cx-cmds" : "cx-frag");
      return ta.scrollHeight <= ta.clientHeight + 2 && ta.scrollWidth <= ta.clientWidth + 1; }, key);
    G.ck("config: box shows every character, no scrolling", key, fits);
  }
  await app.evaluate(({ clipboard }) => clipboard.writeText("")); await win.evaluate(() => document.getElementById("notice").textContent = "");
  await win.click("#copy"); await win.waitForFunction(() => /^(copied|could not copy)/.test(document.getElementById("notice").textContent));
  G.ck("command: copy button copies exactly", "copy command", (await app.evaluate(({ clipboard }) => clipboard.readText())) === await call(win, "command"));
  G.ck("runtime", "no page errors", !errors.length, errors.join(" | "));
  await app.close(); fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(G.report() ? 1 : 0);
})().catch(e => { console.log("T13 ERROR:", e.stack.split("\n").slice(0, 3).join(" | ")); process.exit(2); });
