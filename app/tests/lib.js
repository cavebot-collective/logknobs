// Shared harness for the app gates. Each gate launches the built app in
// Electron (the desktop host) and drives it through the setter contract
// (window.__logknobs) and through the DOM, the way a user would.
const { _electron } = require("playwright");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
// The repository root; sample repositories are built into WORK by
// scripts/setup-work.sh (deterministic: OIDs are checked there).
const ROOT = path.resolve(__dirname, "..", "..");
const WORK = process.env.LK_WORK || path.join(ROOT, ".work");
const REG = JSON.parse(fs.readFileSync(path.join(ROOT, "probe/evidence/registry-v0.3.0.json"), "utf8"));
const TOPO = s => path.join(WORK, `topo-${s}`);
const FIXTURE = path.join(WORK, "fixture");
const STYLES = ["terse", "conventional", "verbose"];

async function launch(env = {}) {
  const app = await _electron.launch({ args: [path.join(__dirname, "..", "electron", "main.js"), "--no-sandbox", "--disable-gpu"], env: { ...process.env, ...env } });
  const win = await app.firstWindow();
  const errors = [];
  win.on("pageerror", e => errors.push(e.message));
  await win.waitForFunction(() => !!window.__logknobs);
  await win.setViewportSize({ width: 1440, height: 900 });
  win.setDefaultTimeout(8000);
  return { app, win, errors };
}
// call a setter by name with arguments, inside the page
const call = (win, fn, ...args) => win.evaluate(([fn, args]) => window.__logknobs[fn](...args), [fn, args]);
const state = win => win.evaluate(() => ({ C: window.__logknobs.C, sel: window.__logknobs.V.sel,
  term: document.getElementById("term").textContent, html: document.getElementById("term").innerHTML + "|" + document.getElementById("term").className }));
const git = (repo, args, cfg = [], env = {}) => execFileSync("git", ["-C", repo, ...cfg, "log", ...args],
  { maxBuffer: 1 << 26, env: { ...process.env, ...env } }).toString("utf8");

function gate(name) {
  const rows = []; let fail = 0;
  return {
    ck(group, item, ok, note = "") { rows.push([group, item, !!ok, note]); if (!ok) fail++; },
    report(extra = "") {
      const by = {};
      for (const [g, , ok] of rows) { const b = (by[g] ||= [0, 0]); b[ok ? 0 : 1]++; }
      console.log(`${name}`);
      for (const [g, [p, f]] of Object.entries(by)) console.log(`  ${g.padEnd(34)} ${String(p).padStart(4)}/${p + f}`);
      const fails = rows.filter(r => !r[2]);
      for (const [g, i, , n] of fails.slice(0, 25)) console.log(`  FAIL ${g} :: ${i} ${n}`);
      if (extra) console.log(extra);
      console.log(`\n${name.split(" ")[0]} GATE: ${fail ? "FAIL" : "PASS"} (${rows.length - fail}/${rows.length})`);
      const out = path.join(__dirname, "results"); fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, `${name.split(" ")[0].toLowerCase()}.json`), JSON.stringify(rows, null, 1));
      return fail;
    },
  };
}
module.exports = { launch, call, state, git, gate, REG, TOPO, FIXTURE, STYLES, ROOT, WORK };
