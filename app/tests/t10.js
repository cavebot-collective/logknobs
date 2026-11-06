/*
 * T10 -- knob controls. A knob is a second VIEW over an option setter; the
 * canonical <select> stays in the DOM. This proves the view is a real control:
 * keyboard, drag and wheel move the value; the angle tracks the value; setting
 * through the select re-renders the knob; every knobbed option has one; the
 * geometry matches the brand mark.
 */
const fs = require("node:fs");
const { launch, call, gate, REG } = require("./lib");
const BRAND = JSON.parse(fs.readFileSync(require("node:path").join(__dirname, "..", "brand/assets/brand-tokens.json"), "utf8"));
const G = gate("T10 — knob controls");
const KNOBBED = ["pretty", "decorate", "date", "color", "order"];
(async () => {
  const { app, win, errors } = await launch();
  const kval = s => win.evaluate(s => document.querySelector(s + " .kv b").textContent, s);
  const kang = s => win.evaluate(s => { const l = document.querySelector(s + " .ind"); return Math.round(Math.atan2(l.x2.baseVal.value - 64, 64 - l.y2.baseVal.value) * 180 / Math.PI); }, s);
  const opt = id => win.evaluate(id => window.__logknobs.C.options[id], id);
  for (const id of KNOBBED) G.ck("coverage", id, await win.locator(`#opts .knobctl[data-knob="${id}"] svg`).count() === 1);
  const geo = await win.evaluate(() => window.__logknobs.KNOB_SWEEP);
  G.ck("geometry", "sweep matches brand-tokens", geo[0] === BRAND.config["knob.sweep.start_deg"] && geo[1] === BRAND.config["knob.sweep.end_deg"]);
  for (const id of KNOBBED) {
    const K = `#opts .knobctl[data-knob="${id}"]`, vals = REG.options[id].values;
    await call(win, "setOption", id, vals[0]);
    await win.locator(K + " svg").focus();
    await win.keyboard.press("ArrowUp");
    G.ck("keyboard", `${id} ArrowUp`, await kval(K) === vals[1] && await opt(id) === vals[1]);
    await win.keyboard.press("ArrowDown"); G.ck("keyboard", `${id} ArrowDown`, await opt(id) === vals[0]);
    await win.keyboard.press("End"); G.ck("keyboard", `${id} End`, await opt(id) === vals.at(-1));
    const angEnd = await kang(K);
    await win.keyboard.press("Home"); G.ck("keyboard", `${id} Home`, await opt(id) === vals[0]);
    const angHome = await kang(K);
    G.ck("geometry", `${id} angle tracks value`, Math.abs(angHome - BRAND.config["knob.sweep.start_deg"]) <= 2 && Math.abs(angEnd - BRAND.config["knob.sweep.end_deg"]) <= 2, `${angHome} ${angEnd}`);
    const box = await win.locator(K + " svg").boundingBox();
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await win.mouse.down();
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 20, { steps: 4 }); await win.mouse.up();
    G.ck("pointer", `${id} drag up advances`, await opt(id) !== vals[0], await opt(id));
    await call(win, "setOption", id, vals[0]); await win.locator(K + " svg").hover(); await win.mouse.wheel(0, -120);
    G.ck("wheel", `${id} wheel up advances`, await opt(id) === vals[1]);
    await win.selectOption(`#opt-${id}`, vals.at(-1));
    G.ck("bidirectional", `${id} select -> knob`, await kval(K) === vals.at(-1));
    await call(win, "setOption", id, REG.options[id].default);
  }
  G.ck("runtime", "no page errors", !errors.length, errors.join(" | "));
  await win.mouse.move(2, 2); await win.screenshot({ path: require("node:path").join(__dirname, "results", "app.png") });
  await app.close(); process.exit(G.report() ? 1 : 0);
})().catch(e => { console.log("T10 ERROR:", e.stack.split("\n").slice(0, 3).join(" | ")); process.exit(2); });
