/*
 * T8 v2 -- the configurator's control gate. The registry is the driver: a
 * directive, option, micro-template or theme added to the registry and not
 * reachable here fails by construction.
 *
 *   palette     every directive is insertable from Insert (or declared not
 *               insertable, with a reason); clicking a chip inserts exactly
 *               that token after the selection and the preview shows it
 *   applicable  the inspector shows exactly the sections that apply to the
 *               selected part's kind (spec section 39), each with a scope chip
 *   variant     every alternative form of every placeholder is reachable
 *   params      composite parameters write the token; micro-templates apply
 *   color       this-part wraps, from-here opens, literals color (item 12),
 *               remove restores, invalid specs are refused before applying
 *   padding     every mode, width and truncation; remove restores
 *   spacing     every modifier on a single-letter placeholder
 *   options     every value of every output option sets state, command, preview
 *   toggles     --graph --oneline --all --first-parent --reverse; graph/reverse exclusive
 *   config      every git config color key changes the history preview
 *   invalid     an invalid color aborts the preview as git aborts
 *   themes      every theme repaints the terminal with its own background
 *   scope       every option row and inspector section carries a scope chip
 */
const { launch, call, state, gate, REG } = require("./lib");
const G = gate("T8 v2 — controls, applicability, scope");

(async () => {
  const { app, win, errors } = await launch();
  const reset = (tpl, sel = -1) => win.evaluate(([t, s]) => { const g = window.__logknobs; g.setTemplate(t, "test"); g.select(s); }, [tpl, sel]);
  const sections = () => win.evaluate(() => [...document.querySelectorAll("#insp .isec .ih")].map(h => ({ name: h.querySelector("b").textContent, chip: !!h.querySelector(".scope") })));

  // ---------------------------------------------------------------- palette
  const chips = await win.evaluate(() => [...document.querySelectorAll("#palette .chip-ins")].map(b => b.dataset.insert));
  const notIns = await win.evaluate(() => window.__logknobs.NOT_INSERTABLE);
  const dirOf = await win.evaluate(toks => toks.map(t => window.__logknobs.directiveOf(t)), chips);
  for (const d of REG.directives) {
    if (notIns[d.control]) { G.ck("palette: totality", d.directive, true, "declared not insertable"); continue; }
    const mt = REG.micro_templates[d.control];
    // a control with micro-templates offers them instead of its bare forms; each form must still be reachable
    const reach = mt ? mt.some(m => m.token === d.directive || (d.directive.includes("(") && m.token.startsWith(d.directive.slice(0, -1))))
                     : dirOf.includes(d.directive);
    G.ck("palette: totality", d.directive, reach);
  }
  for (const [ctl, list] of Object.entries(REG.micro_templates)) for (const m of list) G.ck("palette: micro-templates", `${ctl}/${m.id}`, chips.includes(m.token));
  // click every chip: inserts after the selection, preview shows it
  for (const tok of chips) {
    await reset("%H", 0);
    await win.locator(`#palette .chip-ins[data-insert="${tok.replace(/"/g, '\\"')}"]`).first().click();
    const s = await state(win);
    const sel = s.sel;
    const ok = s.C.template === "%H" + tok;
    // emptiness on the sample is not a propagation failure; it is measured and declared
    const empty = await win.evaluate(t => { const g = window.__logknobs; const keep = g.C.template; let e = true;
      for (let c = 0; c < 3; c++) { g.setCase(c); g.setTemplate(t, "probe"); if (g.renderModel().text !== "") e = false; }
      g.setCase(1); g.setTemplate(keep, "probe"); return e; }, tok);
    G.ck("palette: click inserts after selection", tok, ok && sel === 1, `got ${s.C.template} sel=${sel}${empty ? " (empty on every sample, declared)" : ""}`);
  }
  await reset("%h %s", -1);
  await win.locator('#palette .chip-ins[data-insert="%an"]').click();
  G.ck("palette: no selection appends", "%an", (await state(win)).C.template === "%h %s%an");
  await reset("%h", -1); await win.fill("#lit-text", "50% ["); await win.click("#lit-add");
  G.ck("palette: literal escapes %", "50% [", (await state(win)).C.template === "%h50%% [" && (await state(win)).term.includes("50% ["));

  // ---------------------------------------------------------- applicability
  // expected sections per kind, written from the spec's table, not from the app
  const EXPECT = {
    "%h":           ["part", "form", "color", "padding", "spacing"],
    "%an":          ["part", "form", "color", "padding"],
    "%s":           ["part", "form", "color", "padding", "spacing"],
    "%(trailers)":  ["part", "form", "parameters", "color", "padding"],
    "%ad":          ["part", "form", "date", "color", "padding"],
    "%x41":         ["part", "byte", "color", "padding"],
    "%n":           ["part", "color", "padding", "spacing"],
    "%+b":          ["part", "color", "padding", "spacing"],
    "LIT":          ["part", "text", "color"],
    "%C(red)":      ["part", "color directive"],
    "%Creset":      ["part", "reset"],
    "%<(10,trunc)": ["part", "padding"],
    "%w(30,2,4)":   ["part", "wrap"],
  };
  for (const [tok, want] of Object.entries(EXPECT)) {
    const tpl = tok === "LIT" ? "%hLIT%s" : tok.startsWith("%<") || tok.startsWith("%w") ? `${tok}%s` : `%H${tok}`;
    const idx = tok === "LIT" ? 1 : tok.startsWith("%<") || tok.startsWith("%w") ? 0 : 1;
    await reset(tpl, idx);
    const got = await sections();
    const names = got.map(x => x.name);
    G.ck("inspector: only applicable sections", tok, JSON.stringify(names) === JSON.stringify(want), `got ${JSON.stringify(names)}`);
    G.ck("scope: every inspector section has a chip", tok, got.every(x => x.chip));
    const na = await win.evaluate(() => document.querySelector("#insp .na")?.textContent || "");
    G.ck("inspector: absent sections are explained", tok, want.length >= 6 || na.startsWith("not applicable here:"));
    if (tok === "%w(30,2,4)") {
      await win.fill('#insp [data-key="wrap-width"]', "44"); await win.dispatchEvent('#insp [data-key="wrap-width"]', "change");
      G.ck("inspector: wrap directive edits itself", tok, (await state(win)).C.template === "%w(44,2,4)%s", (await state(win)).C.template);
    }
    if (tok === "%<(10,trunc)") {   // the padding directive edits itself
      await win.fill('#insp [data-key="pad-width"]', "16"); await win.dispatchEvent('#insp [data-key="pad-width"]', "change");
      await win.selectOption('#insp [data-key="pad-mode"]', "><");
      G.ck("inspector: padding directive edits itself", tok, (await state(win)).C.template === "%><(16,trunc)%s", (await state(win)).C.template);
    }
  }
  await reset("%h %s", -1);
  G.ck("inspector: nothing selected offers nothing", "none", (await sections()).length === 0
       && (await win.textContent("#insp")).includes("Select a part"));

  // ---------------------------------------------------------------- variant
  for (const [id, c] of Object.entries(REG.controls)) {
    if (c.kind !== "enum" || id === "spacing-modifier" || c.directives.length < 2) continue;
    for (const d of c.directives.slice(1)) {
      await reset(`%H ${c.directives[0]}`, 2);
      const before = await state(win);
      await win.selectOption('#insp [data-key="variant"]', d);
      const s = await state(win);
      // %aN/%an, %aE/%ae, %aL/%al (and committer) differ only through .mailmap, which the sample has none of
      const mailmapPair = /^%[ac][NEL]$/i.test(d) && d.toLowerCase() === c.directives[0].toLowerCase();
      G.ck("variant: every form reachable", `${id} -> ${d}`, s.C.template === `%H ${d}` && s.sel === 2 && (s.term !== before.term || mailmapPair),
           s.term === before.term ? "same output: mailmap has no entry on the sample (declared)" : "");
    }
  }

  // ----------------------------------------------------------------- params
  const PARAMS = [
    ["%(trailers)", "p-key", "Signed-off-by", "%(trailers:key=Signed-off-by)"],
    ["%(trailers)", "p-valueonly", true, "%(trailers:valueonly)"],
    ["%(decorate)", "p-prefix", "<", "%(decorate:prefix=<)"],
    ["%(describe)", "p-abbrev", "8", "%(describe:abbrev=8)"],
  ];
  for (const [tok, key, val, want] of PARAMS) {
    await reset(`%H${tok}`, 1);
    const sel = `#insp [data-key="${key}"]`;
    if (val === true) await win.check(sel); else { await win.fill(sel, String(val)); await win.dispatchEvent(sel, "change"); }
    G.ck("params: compose the token", `${tok} ${key}`, (await state(win)).C.template === `%H${want}`, (await state(win)).C.template);
  }
  for (const [ctl, list] of Object.entries(REG.micro_templates)) {
    const base = { decoration: "%d", describe: "%(describe)", trailers: "%(trailers)" }[ctl];
    for (const m of list) {
      await reset(`%H${base}`, 1);
      if (m.token === base) { G.ck("params: micro-template", `${ctl}/${m.id}`, true, "is the base form"); continue; }
      await win.selectOption('#insp [data-key="micro"]', m.token);
      G.ck("params: micro-template", `${ctl}/${m.id}`, (await state(win)).C.template === `%H${m.token}`);
    }
  }

  // ------------------------------------------------------------------ color
  const applyColor = async (fg, scope) => {
    await win.click(`#insp [data-key="cscope-${scope}"]`);
    await win.fill('#insp [data-key="c-fg"]', fg); await win.dispatchEvent('#insp [data-key="c-fg"]', "input");
    await win.click('#insp [data-key="c-apply"]');
  };
  await reset("%h %s|", 2); await applyColor("red", "this-part");
  let s = await state(win);
  G.ck("color: this part wraps", "%s", s.C.template === "%h %C(red)%s%Creset|" && s.sel === 3, s.C.template);
  G.ck("color: preview shows it", "%s red", /color:\s*#?[0-9a-fA-Frgb(),]+/.test(await win.evaluate(() => document.querySelector('#term .sp.sel').innerHTML)));
  G.ck("color: does not bleed past the part", "|", !(await win.evaluate(() => { const t = document.getElementById("term"); const last = [...t.querySelectorAll("span[style]")].pop(); return last && last.textContent.includes("|"); })));
  await win.click('#insp [data-key="c-remove"]');
  G.ck("color: remove restores", "%s", (await state(win)).C.template === "%h %s|");
  await reset("%h %s|", 2); await applyColor("blue", "from-here");
  G.ck("color: from here opens only", "%s", (await state(win)).C.template === "%h %C(blue)%s|", (await state(win)).C.template);
  // item 12: a literal can be selected and colored, and the color shows
  await reset("%h -- %s", -1);
  await win.click('#term .sp.lit'); s = await state(win);
  G.ck("color: literal selectable in preview", "click", s.sel === 1);
  await applyColor("green", "this-part"); s = await state(win);
  G.ck("color: literal colored", "--", s.C.template === "%h%C(green) -- %Creset%s");
  G.ck("color: literal color visible", "--", await win.evaluate(() => [...document.querySelectorAll("#term .sp.lit span[style]")].some(e => /color/.test(e.getAttribute("style")))));
  await win.dblclick('#term .sp.lit');
  G.ck("color: double-click edits literal text", "focus", await win.evaluate(() => document.activeElement?.dataset?.key === "literal-text"));
  // background, attributes, 256 and 24-bit
  for (const [fg, bg, attr, want] of [["red", "blue", null, "%C(red blue)"], ["208", "", "bold", "%C(208 bold)"], ["#ff8800", "#001122", "ul", "%C(#ff8800 #001122 ul)"]]) {
    await reset("%h", 0);
    await win.fill('#insp [data-key="c-fg"]', fg); await win.fill('#insp [data-key="c-bg"]', bg);
    if (attr) await win.check(`#insp [data-key="c-${attr}"]`);
    await win.dispatchEvent('#insp [data-key="c-fg"]', "input"); await win.click('#insp [data-key="c-apply"]');
    G.ck("color: grammar (bg, attrs, 256, 24-bit)", want, (await state(win)).C.template === `${want}%h%Creset`, (await state(win)).C.template);
  }
  await reset("%h", 0);
  await win.fill('#insp [data-key="c-fg"]', "#f80"); await win.dispatchEvent('#insp [data-key="c-fg"]', "input");
  G.ck("color: invalid spec refused before applying", "#f80", await win.isDisabled('#insp [data-key="c-apply"]'));
  await win.selectOption('#insp [data-key="c-mode"]', "always"); await win.fill('#insp [data-key="c-fg"]', "red"); await win.dispatchEvent('#insp [data-key="c-fg"]', "input");
  await win.click('#insp [data-key="c-apply"]');
  G.ck("color: always pairs with an always reset", "%C(always,red)", (await state(win)).C.template === "%C(always,red)%h%C(always,reset)");

  // ---------------------------------------------------------------- padding
  for (const [mode] of [["<"], [">"], [">>"], ["><"], ["<|"], [">|"], ["><|"]]) for (const tr of ["none", "trunc", "ltrunc", "mtrunc"]) {
    await reset("%h %s", 2);
    await win.fill('#insp [data-key="pad-width"]', "12");
    await win.selectOption('#insp [data-key="pad-trunc"]', tr);
    await win.selectOption('#insp [data-key="pad-mode"]', mode);
    const want = `%h %${mode}(12${tr === "none" ? "" : "," + tr})%s`;
    s = await state(win);
    G.ck("padding: every mode × truncation", `${mode} ${tr}`, s.C.template === want && s.sel === 3, s.C.template);
  }
  await win.selectOption('#insp [data-key="pad-mode"]', "");
  G.ck("padding: remove restores", "none", (await state(win)).C.template === "%h %s");

  // ---------------------------------------------------------------- spacing
  for (const [m, want] of [["newline", "%h%+b"], ["space", "%h% b"], ["strip", "%h%-b"], ["none", "%h%b"]]) {
    await reset("%h%b", 1); if (m === "none") await call(win, "setSpacingModifier", 1, "newline");
    await win.selectOption('#insp [data-key="spacing"]', m);
    G.ck("spacing: every modifier", m, (await state(win)).C.template === want);
  }

  // ---------------------------------------------------------------- options
  await reset("%C(auto)%h %ad %s%d %h", -1);
  for (const id of ["pretty", "decorate", "date", "color", "order", "abbrev_commit"]) {
    for (const v of REG.options[id].values) {
      await call(win, "setPreviewMode", id === "order" ? "history" : "single");
      await call(win, "setCase", id === "decorate" ? 2 : 1);   // only the verbose sample commit carries a ref
      await win.selectOption(`#opt-${id}`, REG.options[id].values.find(x => x !== v) || v);
      const before = await state(win);
      await win.selectOption(`#opt-${id}`, v);
      const after = await state(win);
      const cmd = await call(win, "command");
      const inCmd = v === REG.options[id].default ? true : cmd.includes(v) || (id === "abbrev_commit" && cmd.includes("--abbrev-commit"))
        || (id === "order" && cmd.includes(`--${v}-order`)) || (id === "pretty" && v === "tformat");
      G.ck("options: every value sets state + command", `${id}=${v}`, after.C.options[id] === v && inCmd, cmd);
      if (v !== before.C.options[id]) G.ck("options: preview reflects", `${id}=${v}`, after.html !== before.html
        || (id === "abbrev_commit" && !["oneline", "medium"].includes(after.C.options.pretty))
        // %d differs only under full; auto renders as short on a terminal (which the preview is)
        || (id === "decorate" && v !== "full" && before.C.options.decorate !== "full") || (id === "decorate" && ["auto", "short"].includes(v) && ["auto", "short"].includes(before.C.options.decorate))
        || (id === "color" && v !== "never" && before.C.options.color !== "never") || (id === "order" && v === "date" && before.C.options.order === "default"),
        "unchanged: declared equivalent on this sample");
    }
    await call(win, "setOption", id, REG.options[id].default);   // each option is measured from the defaults
  }
  await win.fill("#opt-abbrev", "12"); await win.dispatchEvent("#opt-abbrev", "change");
  G.ck("options: --abbrev", "12", (await state(win)).C.options.abbrev === 12 && (await call(win, "command")).includes("--abbrev=12"));
  await call(win, "setOption", "abbrev", 7);

  // ---------------------------------------------------------------- toggles
  await call(win, "setPreviewMode", "history");
  for (const id of ["graph", "oneline", "refs", "first_parent", "reverse"]) {
    const b = `#toggles [data-toggle="${id}"]`;
    const before = await state(win); await win.click(b); const on = await state(win);
    const flag = { graph: "--graph", oneline: "--oneline", refs: "--all", first_parent: "--first-parent", reverse: "--reverse" }[id];
    G.ck("toggles: on sets the option and the flag", id, (await win.getAttribute(b, "aria-checked")) === "true" && (await call(win, "command")).includes(flag));
    G.ck("toggles: preview changes", id, on.html !== before.html);
    await win.click(b);
    G.ck("toggles: off restores", id, JSON.stringify((await state(win)).C.options) === JSON.stringify(before.C.options));
  }
  await call(win, "setGraph", "on"); await call(win, "setReverse", "on");
  s = await state(win);
  G.ck("toggles: --reverse turns --graph off", "exclusive", s.C.options.graph === "off" && s.C.options.reverse === "on"
       && (await win.textContent("#notice")).includes("--graph"));
  await call(win, "setGraph", "on"); s = await state(win);
  G.ck("toggles: --graph turns --reverse off", "exclusive", s.C.options.graph === "on" && s.C.options.reverse === "off");

  // ----------------------------------------------------------------- config
  await reset("%C(auto)%h%d %s", -1); await call(win, "setRefs", "all");
  for (const [k, v] of [["log.graphColors", "blue, 208"], ["color.decorate.branch", "blue"], ["color.decorate.remoteBranch", "magenta"],
                        ["color.decorate.tag", "reverse yellow"], ["color.decorate.HEAD", "bold #ff8800"], ["color.diff.commit", "cyan"]]) {
    const before = await state(win);
    const id = "#cfg-" + k.replace(/\./g, "-");
    await win.evaluate(() => document.getElementById("cfgsec").open = true);
    await win.fill(id, v); await win.dispatchEvent(id, "change");
    const after = await state(win);
    G.ck("config: every color key reaches the preview", k, after.C.options.config[k] === v && after.html !== before.html);
    G.ck("config: every color key reaches the command", k, (await call(win, "command")).includes(`${k}=`));
  }
  await win.fill("#cfg-color-decorate-stash", "bold magenta"); await win.dispatchEvent("#cfg-color-decorate-stash", "change");
  G.ck("config: stash slot is settable (no stash on the sample)", "color.decorate.stash", (await state(win)).C.options.config["color.decorate.stash"] === "bold magenta");
  await win.fill("#cfg-color-diff-commit", "#f80"); await win.dispatchEvent("#cfg-color-diff-commit", "change");
  G.ck("config: invalid color refused", "#f80", (await state(win)).C.options.config["color.diff.commit"] === "cyan");
  await call(win, "setGraph", "off"); await call(win, "setRefs", "head");
  for (const k of Object.keys((await state(win)).C.options.config)) await call(win, "setConfig", k, "");

  // ---------------------------------------------------------------- invalid
  await call(win, "setPreviewMode", "single");
  await reset("%C(red blue green)%h", -1);
  G.ck("invalid: git's abort is shown", "%C(red blue green)", (await state(win)).term.startsWith("fatal:"));
  G.ck("invalid: the part is flagged", "%C(red blue green)", await win.evaluate(() => !!document.querySelector("#tokens .bad")));
  G.ck("invalid: the template field is flagged", "%C(red blue green)", await win.evaluate(() => document.getElementById("tpl").classList.contains("bad")));
  await call(win, "setOption", "color", "never");
  G.ck("invalid: unchecked when not emitted (as git)", "--color=never", !(await state(win)).term.startsWith("fatal:"));
  await call(win, "setOption", "color", "auto");

  // ----------------------------------------------------------------- themes
  await reset("%C(auto)%h %C(red)%s%Creset", -1);
  for (const [name, th] of Object.entries(REG.themes)) {
    await win.selectOption("#theme", name);
    const bg = await win.evaluate(() => getComputedStyle(document.getElementById("term")).backgroundColor);
    const hex = th.background.toLowerCase(); const rgb = `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
    const red = await win.evaluate(() => [...document.querySelectorAll("#term span[style]")].map(e => e.style.color).find(c => c && c !== ""));
    G.ck("themes: background and palette", name, bg === rgb && !!red, `${bg} vs ${rgb}`);
  }
  await win.selectOption("#theme", REG.theme_default);

  // ------------------------------------------------------------------ scope
  const rows = await win.evaluate(() => [...document.querySelectorAll("#opts .orow")].map(r => [r.dataset.opt, !!r.querySelector(".scope")]));
  for (const [id, chip] of rows) G.ck("scope: every output row has a chip", id, chip && !!REG.options[id].scope);
  for (const o of Object.keys(REG.options)) G.ck("scope: every option is reachable", o, rows.some(r => r[0] === o) || await win.locator(`#toggles [data-toggle="${o === "pretty" ? "oneline" : o}"]`).count() === 1);

  G.ck("runtime: no page errors", "pageerror", errors.length === 0, errors.join(" | "));
  await app.close();
  process.exit(G.report() ? 1 : 0);
})().catch(e => { console.log("T8 ERROR:", e.stack.split("\n").slice(0, 3).join(" | ")); process.exit(2); });
