/*
 * Oracle B -- the configurator's preview panel versus a reference rendering
 * of REAL git's bytes, pixel-compared. Oracle A already proves the simulator's
 * bytes equal git's; this proves the UI paints those bytes faithfully --
 * colour attributes, padded columns, wide glyphs, wrapped indents.
 *
 * The reference is painted through the same ansiToHtml and the same #term
 * CSS inside the same window, so the only variable is the bytes' origin.
 * A negative control (one SGR attribute stripped) must produce a diff.
 */
const { _electron } = require("playwright");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs"); const { PNG } = require("pngjs");
const pixelmatch = require("pixelmatch").default || require("pixelmatch");
const REPO = "/home/claude/fixture"; const OUT = "tests/oracle-b"; fs.mkdirSync(OUT, { recursive: true });
const CASES = [
  { name: "colour-pad-conventional", caseIdx: 1, tpl: "%C(auto)%h%Creset %C(always,green)%<(14,trunc)%an%Creset %C(always,blue)%s%Creset%d" },
  { name: "attrs-rightpad-terse", caseIdx: 0, tpl: "%C(bold ul italic)%h%Creset %>(30)%s|%C(always,226)%as%Creset" },
  { name: "wrap-cjk-verbose", caseIdx: 2, tpl: "%C(always,#ff8800)%h%Creset%n%w(40,2,4)%b" },
  { name: "trailers-centre-conventional", caseIdx: 1, tpl: "%><(40)%s|%n%C(always,magenta)%(trailers:key=Signed-off-by,valueonly)%Creset" },
];
(async () => {
  const app = await _electron.launch({ args: ["electron/main.js", "--no-sandbox", "--disable-gpu"] });
  const win = await app.firstWindow(); await win.waitForSelector("#term");
  await win.setViewportSize({ width: 1280, height: 860 });
  const recs = await win.evaluate(() => window.__gitlog.RECORDS.map(r => r.H));
  let fail = 0; const rows = [];
  // Oracle B compares the RESTING state. A large span under a pointer left
  // behind by an earlier step renders hover styling and reads as 2728px of
  // divergence; park the pointer before every capture.
  const shot = async name => { await win.mouse.move(2, 2); await win.waitForTimeout(40); const p = `${OUT}/${name}.png`; await win.locator("#term").screenshot({ path: p }); return p; };
  const cmp = (a, b, d) => { const A = PNG.sync.read(fs.readFileSync(a)), B = PNG.sync.read(fs.readFileSync(b));
    if (A.width !== B.width || A.height !== B.height) return -1;
    const D = new PNG({ width: A.width, height: A.height }); const n = pixelmatch(A.data, B.data, D.data, A.width, A.height, { threshold: 0.05 });
    fs.writeFileSync(d, PNG.sync.write(D)); return n; };
  for (const c of CASES) {
    // 1. the app's own preview
    await win.evaluate(({ tpl, ci }) => { const g = window.__gitlog; g.S.caseIdx = ci; g.S.color = "always"; g.S.sel = -1; document.getElementById("opt-color").value = "always"; g.setTemplate(tpl, "oracle-b"); }, { tpl: c.tpl, ci: c.caseIdx });
    await win.waitForTimeout(100); const appShot = await shot(`${c.name}.app`);
    // 2. reference: real git bytes, painted through the same renderer + CSS
    const bytes = execFileSync("git", ["-C", REPO, "log", "-1", "--color=always", `--format=${c.tpl}`, recs[c.caseIdx]]).toString("utf8").replace(/\n$/, "");
    await win.evaluate(b => { document.getElementById("term").innerHTML = window.__gitlog.ansiToHtml(b); }, bytes);
    await win.waitForTimeout(100); const refShot = await shot(`${c.name}.ref`);
    const diff = cmp(appShot, refShot, `${OUT}/${c.name}.diff.png`);
    // 3. negative control: strip one SGR sequence from the reference
    const mutated = bytes.replace(/\x1b\[[0-9;]*m/, "");
    if (mutated === bytes) throw new Error("precondition: no SGR to strip");
    await win.evaluate(b => { document.getElementById("term").innerHTML = window.__gitlog.ansiToHtml(b); }, mutated);
    await win.waitForTimeout(100); const negShot = await shot(`${c.name}.neg`);
    const negDiff = cmp(refShot, negShot, `${OUT}/${c.name}.negdiff.png`);
    const ok = diff === 0 && negDiff > 0; if (!ok) fail++;
    rows.push([c.name, diff, negDiff, ok]);
  }
  await app.close();
  console.log("ORACLE B — configurator preview vs real git bytes (pixel diff)");
  console.log("  case                             app-vs-ref   neg-control");
  for (const [n, d, nd, ok] of rows) console.log(`  [${ok ? "PASS" : "FAIL"}] ${n.padEnd(30)} ${String(d).padStart(6)}px   ${String(nd).padStart(6)}px`);
  console.log(`\nORACLE B GATE: ${fail ? "FAIL" : "PASS"}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log("ORACLE B ERROR:", e.message.split("\n")[0]); process.exit(2); });
