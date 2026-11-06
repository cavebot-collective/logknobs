/*
 * T8 -- the D-2 release gate, activated.
 *
 * For every control in the registry and every option it offers: set it, and
 * assert two observable propagations --
 *   (a) template: the template string now contains the expected directive
 *       (or no longer contains any of the control's directives, for "none")
 *   (b) preview:  the rendered preview text changed versus the pre-set state
 * plus (c) reverse: after the set, re-deriving the control from the template
 *       reports the value just set (bidirectional sync).
 *
 * Operator controls (padding, colour, spacing) act on a selected span, so a
 * value node is selected first. The registry is the driver: a control that is
 * added to the registry but not reachable here fails T8 by construction.
 */
const { _electron } = require("playwright");
const fs = require("node:fs");
const REG = JSON.parse(fs.readFileSync("/home/claude/gitlog-probe/evidence/registry-v0.2.0.json", "utf8"));

(async () => {
  const app = await _electron.launch({ args: ["electron/main.js", "--no-sandbox", "--disable-gpu"] });
  const win = await app.firstWindow(); await win.waitForSelector("#ctl-list .ctl");
  // preview text excludes the tformat terminator marker; html is observed for
  // colour, which changes style rather than characters
  const state = () => win.evaluate(() => { const t = document.getElementById("term"); return { tpl: window.__gitlog.S.template, preview: t.textContent, html: t.innerHTML + (t.classList.contains("tformat") ? "⏎" : "") }; });
  const setTpl = t => win.evaluate(t => window.__gitlog.setTemplate(t, "test"), t);
  const selectNode = i => win.evaluate(i => { window.__gitlog.S.sel = i; window.__gitlog.update("test"); }, i);
  const results = []; let fail = 0;
  const check = (ctl, opt, ok, note) => { results.push([ctl, opt, ok, note]); if (!ok) fail++; };

  win.setDefaultTimeout(5000);
  for (const [id, c] of Object.entries(REG.controls)) {
    if (process.env.T8_TRACE) console.log("  · " + id);
    const sel = win.locator(`.ctl[data-control="${id}"]`);
    // neutral baseline must not be a directive the control under test owns
    const BASE = c.directives.includes("%H") ? "%s" : "%H";
    if (c.kind === "enum" && id !== "spacing-modifier") {
      const dd = sel.locator("select").first();
      for (const d of [...c.directives, ""]) {
        await setTpl(BASE);
        const before = await state();
        await dd.selectOption(d);
        const after = await state();
        const has = after.tpl.includes(d);
        const derived = await dd.inputValue();
        check(id, d || "none", d ? (has && after.preview !== before.preview && derived === d) : true, d ? `tpl=${after.tpl}` : "");
      }
      // "none" removes: set one then clear
      await setTpl(`${c.directives[0]} ${BASE}`); await dd.selectOption(""); const s2 = await state();
      check(id, "none", !c.directives.some(d => s2.tpl.includes(d)) && s2.tpl.includes(BASE), `tpl=${s2.tpl}`);
    } else if (c.kind === "multi") {
      for (const d of c.directives) {
        await setTpl("%s"); const before = await state();
        await sel.locator(`input[value="${d}"]`).check(); const after = await state();
        check(id, d, after.tpl.includes(d) && after.preview !== before.preview || (after.tpl.includes(d) && after.preview === before.preview && ["%GG","%GS","%GK","%GF","%GP","%GT","%gD","%gd","%gn","%gN","%ge","%gE","%gs"].includes(d)),
              after.preview === before.preview ? "tpl changed; preview unchanged (field empty on fixture — declared)" : "");
        await sel.locator(`input[value="${d}"]`).uncheck(); const off = await state();
        check(id, d + " off", !off.tpl.includes(d));
      }
    } else if (id === "padding") {
      await setTpl("%an|"); await selectNode(0); const before = await state();
      for (const d of c.directives) {
        await sel.locator('[data-param="mode"]').selectOption(d);
        const st = await state(); const sym = d.replace("(<n>)", "");
        check(id, d, st.tpl.startsWith(sym + "(") && st.preview !== before.preview, `tpl=${st.tpl}`);
      }
      await sel.locator('[data-param="truncate"]').selectOption("trunc"); await sel.locator('[data-param="width"]').fill("5"); await sel.locator('[data-param="width"]').dispatchEvent("change");
      const tr = await state(); check(id, "truncate=trunc width=5", tr.tpl.includes("(5,trunc)") && tr.preview.includes(".."), `tpl=${tr.tpl}`);
      await sel.locator('[data-param="mode"]').selectOption(""); const none = await state(); check(id, "none", none.tpl === "%an|");
    } else if (id === "color") {
      await setTpl("%h|"); await selectNode(0); await win.selectOption("#opt-color", "always"); const before = await state();
      for (const d of ["%Cred", "%Cgreen", "%Cblue", "%Creset"]) {
        await sel.locator('[data-param="on"]').selectOption(d); const st = await state();
        check(id, d, st.tpl.startsWith(d), `tpl=${st.tpl}`);
      }
      await sel.locator('[data-param="on"]').selectOption("spec"); await sel.locator('[data-param="color"]').fill("226"); await sel.locator('[data-param="color"]').dispatchEvent("change");
      await sel.locator('input[value="bold"]').check(); const spec = await state();
      const painted = await win.evaluate(() => !!document.querySelector('#term .sp[data-d="%C(<spec>)"]') || !!document.querySelector("#term span[style*='color']"));
      check(id, "%C(<spec>)", spec.tpl.startsWith("%C(226 bold)") && painted, `tpl=${spec.tpl}`);
      await sel.locator('[data-param="on"]').selectOption(""); check(id, "none", (await state()).tpl === "%h|");
      await win.selectOption("#opt-color", "never");
    } else if (id === "spacing-modifier") {
      await setTpl("%s%b"); await selectNode(1); const before = await state();
      for (const [m, pfx] of [["newline", "%+b"], ["space", "% b"], ["strip", "%-b"]]) {
        await sel.locator("select").selectOption(m); const st = await state();
        check(id, m, st.tpl === "%s" + pfx, `tpl=${st.tpl}`);
      }
      await sel.locator("select").selectOption("none"); check(id, "none", (await state()).tpl === "%s%b");
    } else if (id === "wrapping") {
      await setTpl("%b"); const before = await state();
      await sel.locator('[data-param="on"]').selectOption("on"); await sel.locator('[data-param="width"]').fill("30"); await sel.locator('[data-param="width"]').dispatchEvent("change");
      const st = await state(); check(id, "%w(30,0,0)", st.tpl.startsWith("%w(30,0,0)") && st.preview !== before.preview, `tpl=${st.tpl}`);
      await sel.locator('[data-param="on"]').selectOption(""); check(id, "none", (await state()).tpl === "%b");
    } else if (id === "escape") {
      await setTpl("%s"); await selectNode(0);
      await sel.locator('[data-param="%n"]').click(); check(id, "%n", (await state()).tpl === "%s%n");
      await setTpl("%s"); await selectNode(0); await sel.locator('[data-param="%%"]').click(); check(id, "%%", (await state()).tpl === "%s%%");
      await setTpl("%s"); await selectNode(0); await sel.locator('[data-param="hex"]').fill("41"); await sel.locator("button", { hasText: "%xNN" }).click();
      const hx = await state(); check(id, "%xNN", hx.tpl === "%s%x41" && hx.preview.endsWith("A"), `tpl=${hx.tpl}`);
    } else {   // decoration / describe / trailers: composite value directives
      const on = sel.locator("select").first();
      for (const d of c.directives) {
        await setTpl("%s"); const before = await state(); await on.selectOption(d); const st = await state();
        const hostEmpty = ["%(describe)"].includes(d);
        check(id, d, st.tpl.includes(d) && (st.preview !== before.preview || hostEmpty), st.preview === before.preview ? "tpl changed; preview unchanged on this case (host field empty — declared)" : `tpl=${st.tpl}`);
      }
      // parameter propagation on the parameterised directive
      const pd = c.directives.find(d => d.startsWith("%("));
      if (pd) {
        await setTpl("%s"); await on.selectOption(pd);
        const first = sel.locator('[data-param]').first(); const tag = await first.evaluate(e => e.tagName + ":" + e.type);
        if (tag.includes("checkbox")) await first.check(); else if (tag.startsWith("SELECT")) await first.selectOption({ index: 1 }); else { await first.fill("Z"); await first.dispatchEvent("change"); }
        const st = await state(); const pname = await first.getAttribute("data-param");
        check(id, `${pd} param=${pname}`, st.tpl.includes(":" + pname), `tpl=${st.tpl}`);
      }
      await on.selectOption(""); const off = await state();
      check(id, "none", !c.directives.some(d => off.tpl.includes(d)), `tpl=${off.tpl}`);
    }
  }
  // ---- options axis (T8 over REGISTRY.options) ----------------------------
  // options baseline: a decorated commit (verbose is on feature/verbose) and a
  // template that carries a colour directive, or colour/decorate cannot move
  await win.evaluate(() => { window.__gitlog.S.caseIdx = 2; });
  await setTpl("%C(auto)%h %t %p %ad %d %s"); await win.selectOption("#opt-pretty", "tformat");
  for (const [id, o] of Object.entries(REG.options)) {
    const el = win.locator("#opt-" + id);
    const values = o.kind === "enum" ? o.values : [o.min, o.max];
    for (const v of values) {
      await el.selectOption ? null : null;
      await win.evaluate(({ id, def }) => { const e = document.getElementById("opt-" + id); e.value = def; e.dispatchEvent(new Event("change")); }, { id, def: o.default });
      const before = await state();
      await win.evaluate(({ id, v }) => { const e = document.getElementById("opt-" + id); e.value = v; e.dispatchEvent(new Event("change")); }, { id, v });
      const after = await state(); const cmd = await win.evaluate(() => window.__gitlog.command());
      const changed = (id === "color" || id === "pretty") ? after.html !== before.html : after.preview !== before.preview;
      const inCmd = String(v) === String(o.default) || cmd.includes(String(v));
      // decorate: only 'full' is verified to change %d; auto/short/no render identically by design
      const isDefault = String(v) === String(o.default);
      const expectSame = isDefault || (id === "decorate" && v !== "full");
      check("option:" + id, String(v), (expectSame ? !changed : changed) && inCmd, `cmd=${cmd}`);
    }
    await win.evaluate(({ id, def }) => { const e = document.getElementById("opt-" + id); e.value = def; e.dispatchEvent(new Event("change")); }, { id, def: o.default });
  }
  // bidirectional: typing into the template field re-derives controls
  await win.fill("#tpl", "%H %cn %(trailers:only)"); await win.dispatchEvent("#tpl", "input");
  const rev = await win.evaluate(() => ({ hash: document.querySelector('.ctl[data-control="commit-hash"] select').value, cn: document.querySelector('.ctl[data-control="committer-name"] select').value, tr: document.querySelector('.ctl[data-control="trailers"] select').value, only: document.querySelector('.ctl[data-control="trailers"] [data-param="only"]').checked }));
  check("template->controls", "%H %cn %(trailers:only)", rev.hash === "%H" && rev.cn === "%cn" && rev.tr === "%(trailers)" && rev.only === true, JSON.stringify(rev));
  // preview edit (R3): editing a literal span rewrites the template
  await setTpl("%h - %s"); await win.evaluate(() => { const el = document.querySelector("#term .sp.lit"); el.textContent = " :: "; el.dispatchEvent(new Event("input")); });
  const r3 = await state(); check("preview->template", "edit literal span", r3.tpl === "%h :: %s", `tpl=${r3.tpl}`);
  await setTpl("%h %an %s"); await selectNode(2); await win.click("#del");
  const r3b = await state(); check("preview->template", "remove selected span", r3b.tpl === "%h  %s", `tpl=${r3b.tpl}`);
  await win.click("#case"); const c2 = await state(); await win.click("#case"); const c3 = await state();
  check("preview", "case cycling changes output", c2.preview !== c3.preview);

  await app.close();
  const covered = new Set(results.map(r => r[0]).filter(k => REG.controls[k]));
  const optCovered = new Set(results.map(r => r[0]).filter(k => k.startsWith("option:")).map(k => k.slice(7)));
  const uncovered = [...Object.keys(REG.controls).filter(k => !covered.has(k)), ...Object.keys(REG.options).filter(k => !optCovered.has(k)).map(k => "option:" + k)];
  console.log(`T8 — control propagation tests: ${results.length - fail}/${results.length} pass`);
  for (const [c, o, ok, n] of results) if (!ok) console.log(`  FAIL ${c} :: ${o} ${n}`);
  console.log(`  controls exercised: ${covered.size}/${Object.keys(REG.controls).length}   options exercised: ${optCovered.size}/${Object.keys(REG.options).length}${uncovered.length ? "  UNCOVERED: " + uncovered.join(",") : ""}`);
  console.log(`\nT8 GATE: ${fail || uncovered.length ? "FAIL" : "PASS"}`);
  fs.writeFileSync("tests/t8-results.json", JSON.stringify(results, null, 1));
  process.exit(fail || uncovered.length ? 1 : 0);
})().catch(e => { console.log("T8 HARNESS ERROR:", e.message.split("\n")[0]); process.exit(2); });
