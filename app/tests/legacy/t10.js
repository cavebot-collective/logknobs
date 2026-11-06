/*
 * T10 -- knob controls. The knob is a second VIEW over an existing setter, so
 * T8 (which drives the canonical <select>) cannot see it. This gate proves the
 * view is a real control, not an ornament:
 *   (a) keyboard: ArrowUp/Down/Home/End move the value and the template
 *   (b) pointer drag moves the value
 *   (c) wheel moves the value
 *   (d) the knob's rendered angle tracks the value (geometry, not just label)
 *   (e) setting via the canonical select re-renders the knob (bidirectional)
 *   (f) every enum control and enum option has a knob
 *   (g) knob geometry matches the brand mark's constants
 */
const { _electron } = require("playwright");
const fs = require("node:fs");
const REG = JSON.parse(fs.readFileSync("/home/claude/gitlog-probe/evidence/registry-v0.2.0.json", "utf8"));
const BRAND = JSON.parse(fs.readFileSync("brand/assets/brand-tokens.json", "utf8"));

(async () => {
  const app = await _electron.launch({ args: ["electron/main.js", "--no-sandbox", "--disable-gpu"] });
  const win = await app.firstWindow(); await win.waitForSelector(".knobctl svg");
  win.setDefaultTimeout(5000);
  const res = []; let fail = 0;
  const ck = (a, b, ok, n = "") => { res.push([a, b, ok, n]); if (!ok) fail++; };
  const tpl = () => win.evaluate(() => window.__gitlog.S.template);
  const kval = sel => win.evaluate(s => document.querySelector(s + " .kv b").textContent, sel);
  // Read the INDICATOR, not "line:last-of-type" -- that matched the last tick
  // inside the <g>, which precedes the indicator in document order.
  const kang = sel => win.evaluate(s => { const l = document.querySelector(s + " .ind"); return Math.round(Math.atan2(l.x2.baseVal.value - 64, 64 - l.y2.baseVal.value) * 180 / Math.PI); }, sel);

  // (f) coverage: every enum control + enum option has a knob
  const enumCtls = Object.entries(REG.controls).filter(([, c]) => c.kind === "enum").map(([k]) => k);
  const enumOpts = Object.entries(REG.options).filter(([, o]) => o.kind === "enum").map(([k]) => k);
  for (const id of enumCtls) ck("coverage", "control:" + id, await win.locator(`.ctl[data-control="${id}"] .knobctl svg`).count() === 1);
  for (const id of enumOpts) ck("coverage", "option:" + id, await win.locator(`#opts .knobctl[data-knob="${id}"] svg`).count() === 1);

  // (g) geometry parity with the brand mark
  const geo = await win.evaluate(() => ({ s: window.__gitlog.KNOB_SWEEP }));
  ck("geometry", "sweep matches brand-tokens",
     geo.s[0] === BRAND.config["knob.sweep.start_deg"] && geo.s[1] === BRAND.config["knob.sweep.end_deg"],
     JSON.stringify(geo.s));

  const K = '#opts .knobctl[data-knob="pretty"]';
  const opts = REG.options.pretty.values;
  // (a) keyboard
  await win.evaluate(() => { window.__gitlog.S.pretty = "tformat"; window.__gitlog.update("t"); });
  await win.locator(K + " svg").focus();
  await win.keyboard.press("ArrowUp");
  ck("keyboard", "ArrowUp advances", await kval(K) === opts[1], await kval(K));
  await win.keyboard.press("ArrowDown");
  ck("keyboard", "ArrowDown retreats", await kval(K) === opts[0], await kval(K));
  await win.keyboard.press("End");
  ck("keyboard", "End -> last", await kval(K) === opts[opts.length - 1], await kval(K));
  const angEnd = await kang(K);
  await win.keyboard.press("Home");
  ck("keyboard", "Home -> first", await kval(K) === opts[0], await kval(K));
  const angHome = await kang(K);
  // (d) geometry tracks value
  ck("geometry", "angle at min == sweep start", Math.abs(angHome - BRAND.config["knob.sweep.start_deg"]) <= 2, String(angHome));
  ck("geometry", "angle at max == sweep end", Math.abs(angEnd - BRAND.config["knob.sweep.end_deg"]) <= 2, String(angEnd));

  // (b) pointer drag
  const box = await win.locator(K + " svg").boundingBox();
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await win.mouse.down(); await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 42, { steps: 4 }); await win.mouse.up();
  ck("pointer", "drag up advances", await kval(K) !== opts[0], await kval(K));
  // (c) wheel
  await win.evaluate(() => { window.__gitlog.S.pretty = "tformat"; window.__gitlog.update("t"); });
  await win.locator(K + " svg").hover();
  await win.mouse.wheel(0, -120);
  ck("wheel", "wheel up advances", await kval(K) !== opts[0], await kval(K));

  // (e) bidirectional: canonical select -> knob re-renders
  await win.evaluate(() => { const e = document.getElementById("opt-pretty"); e.value = "medium"; e.dispatchEvent(new Event("change")); });
  ck("bidirectional", "select -> knob", await kval(K) === "medium", await kval(K));

  // control knob drives the template
  const CK = '.ctl[data-control="commit-hash"] .knobctl';
  await win.evaluate(() => { window.__gitlog.S.pretty = "tformat"; window.__gitlog.setTemplate("%s", "t"); });
  await win.locator(CK + " svg").focus(); await win.keyboard.press("ArrowUp");
  const t1 = await tpl();
  ck("template", "control knob rewrites template", t1.includes("%H") || t1.includes("%h"), t1);
  await win.keyboard.press("Home");
  ck("template", "Home clears to none", !(await tpl()).match(/%[Hh]\b/), await tpl());

  await win.mouse.move(2, 2); await win.waitForTimeout(80);
  await win.screenshot({ path: "tests/brand.png" });
  await app.close();
  console.log(`T10 — knob controls: ${res.length - fail}/${res.length} pass`);
  for (const [a, b, ok, n] of res) if (!ok) console.log(`  FAIL ${a} :: ${b} ${n}`);
  console.log(`\nT10 GATE: ${fail ? "FAIL" : "PASS"}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log("T10 HARNESS ERROR:", e.message.split("\n")[0]); process.exit(2); });
