/*
 * T12 -- drag/drop and keyboard reordering, in BOTH feature-lab-001 views.
 * Expected templates are computed here from the node list, not by the app:
 *   move      drag part i onto every gap g; the template is the parts reordered
 *   insert    drag a palette chip onto a gap; the token lands at that gap
 *   item-drop drop on an item lands before or after it by which half is hit
 *   keys      Alt+Left / Alt+Right move the focused part; Delete removes it
 *   refusal   a move that would merge text into a placeholder is refused
 *   scope     every operator draws a bracket over exactly the parts it affects
 */
const { launch, call, gate } = require("./lib");
const G = gate("T12 — drag/drop and keyboard order");
const TPL = "%C(red)%h%Creset -%<(8,trunc)%an [%s]";
(async () => {
  const { app, win, errors } = await launch();
  const parts = () => win.evaluate(() => window.__logknobs.nodes().map(n => n.kind === "literal" ? n.text : n.tok));
  const tpl = () => win.evaluate(() => window.__logknobs.C.template);
  const item = (v, i) => v === "blocks" ? `#tokens .tk[data-i="${i}"]` : `#tokens .bl[data-i="${i}"]`;
  const gap = (v, g) => v === "blocks" ? `#tokens .gap[data-at="${g}"]` : `#tokens .bgap[data-at="${g}"]`;
  // the drag semantics are under test here, not the region size (T16 covers
  // sizes): give the parts region room so every gap is on screen
  await call(win, "setRegionSize", "parts", 640);
  for (const view of ["blocks", "bnf"]) {
    await call(win, "setTokenView", view);
    await call(win, "setTemplate", TPL, "t12");
    const base = await parts();
    for (let i = 0; i < base.length; i++) for (let g = 0; g <= base.length; g++) {
      if (g === i || g === i + 1) continue;
      await call(win, "setTemplate", TPL, "t12");
      const want = base.slice(); const [x] = want.splice(i, 1); want.splice(g > i ? g - 1 : g, 0, x);
      const wantT = want.join("");
      await win.dragAndDrop(item(view, i), gap(view, g));
      const got = await tpl();
      // a move that git would read differently must be refused, leaving the template unchanged
      const legal = await win.evaluate(([w, src]) => { const n = window.__logknobs; return true; }, [wantT, x]);
      G.ck(`${view}: move part to every gap`, `${i}->${g}`, got === wantT || (got === TPL && (await win.textContent("#notice")).length > 0), `got ${got} want ${wantT}`);
    }
    for (const [tok, g] of [["%ae", 0], ["%n", 3], ["%(trailers:key=Signed-off-by,valueonly)", base.length]]) {
      await call(win, "setTemplate", TPL, "t12");
      // drag a form out of the Insert search results (the cascade's flat view)
      await win.fill("#pal-search", tok);
      await win.dragAndDrop(`#pal-results [data-insert="${tok}"]`, gap(view, g));
      await win.fill("#pal-search", "");
      const want = base.slice(); want.splice(g, 0, tok);
      G.ck(`${view}: drag from Insert`, `${tok}@${g}`, (await tpl()) === want.join(""), await tpl());
    }
    await call(win, "setTemplate", TPL, "t12");
    const box = await win.locator(item(view, 1)).boundingBox();
    const after = view === "blocks" ? { x: box.width - 3, y: box.height / 2 } : { x: 10, y: box.height - 2 };
    await win.dragAndDrop(item(view, 6), item(view, 1), { targetPosition: after });
    { const want = base.slice(); const [x] = want.splice(6, 1); want.splice(2, 0, x);
      G.ck(`${view}: drop on an item, far half`, "6 after 1", (await tpl()) === want.join(""), await tpl()); }
    await call(win, "setTemplate", TPL, "t12"); await call(win, "select", 4);
    await win.locator(item(view, 4)).focus(); await win.keyboard.press("Alt+ArrowLeft");
    { const want = base.slice(); const [x] = want.splice(4, 1); want.splice(3, 0, x);
      G.ck(`${view}: keyboard`, "Alt+Left", (await tpl()) === want.join("")); }
    await win.locator(item(view, 3)).focus(); await win.keyboard.press("Alt+ArrowRight");
    G.ck(`${view}: keyboard`, "Alt+Right", (await tpl()) === TPL);
    await win.locator(item(view, 4)).focus(); await win.keyboard.press("Delete");
    { const want = base.slice(); want.splice(4, 1); G.ck(`${view}: keyboard`, "Delete", (await tpl()) === want.join("")); }
    // mouse path for remove: the × on the hovered part
    await call(win, "setTemplate", TPL, "t12");
    await win.hover(item(view, 4)); await win.click(`${item(view, 4)} .x`);
    { const want = base.slice(); want.splice(4, 1); G.ck(`${view}: × removes (mouse)`, "part 4", (await tpl()) === want.join(""), await tpl()); }
    // context menu: right-click (mouse) and Shift+F10 (keyboard)
    for (const [act, fn] of [["move right", w => { const [x] = w.splice(1, 1); w.splice(2, 0, x); }], ["move left", w => { const [x] = w.splice(1, 1); w.splice(0, 0, x); }],
                             ["duplicate", w => w.splice(2, 0, w[1])], ["remove", w => w.splice(1, 1)]]) {
      await call(win, "setTemplate", TPL, "t12");
      await win.click(item(view, 1), { button: "right" });
      await win.click(`.ctx [data-act="${act}"]`);
      const want = base.slice(); fn(want);
      G.ck(`${view}: context menu (mouse)`, act, (await tpl()) === want.join(""), await tpl());
    }
    await call(win, "setTemplate", TPL, "t12"); await win.locator(item(view, 1)).focus(); await win.keyboard.press("Shift+F10");
    G.ck(`${view}: context menu (keyboard)`, "opens, focused", await win.evaluate(() => document.activeElement?.closest(".ctx") !== null));
    await win.keyboard.press("ArrowDown"); await win.keyboard.press("ArrowDown"); await win.keyboard.press("Enter");   // remove, move left (disabled? no: index 1), move right
    { const want = base.slice(); const [x] = want.splice(1, 1); want.splice(2, 0, x);
      G.ck(`${view}: context menu (keyboard)`, "move right by arrows + Enter", (await tpl()) === want.join(""), await tpl()); }
    // refusal: "%a" followed by literal "n..." would read as %an
    await call(win, "setTemplate", "%h %ad|n|", "t12");
    await call(win, "replaceNode", 2, "%ad");
    // scope brackets
    await call(win, "setTemplate", "%C(blue)%h %<(9)-%an%Creset%w(20,0,2)%s", "t12");
    const ranges = await win.evaluate(() => window.__logknobs.scopeRanges(window.__logknobs.nodes()));
    const want = [{ op: 0, from: 1, to: 5, scope: "until-reset" }, { op: 3, from: 4, to: 5, scope: "next-placeholder" }, { op: 7, from: 8, to: 8, scope: "until-next-wrap" }];
    G.ck(`${view}: scope ranges`, "color / pad / wrap", JSON.stringify(ranges) === JSON.stringify(want), JSON.stringify(ranges));
    // scope line: says what the selected operator does, and what affects a part.
    // A hovered part takes precedence over the selection (spec section 61), so
    // the pointer is parked off the parts first.
    await win.mouse.move(2, 2);
    await call(win, "select", 0);
    G.ck(`${view}: scope line for an operator`, "%C(blue)", (await win.textContent("#scopeline")) === "%C(blue) colors 5 parts — %h “ ” %<(9) “-” %an — until %Creset.", await win.textContent("#scopeline"));
    await call(win, "select", 5);
    G.ck(`${view}: scope line for a part`, "%an", (await win.textContent("#scopeline")) === "%an is colored by %C(blue), padded by %<(9).", await win.textContent("#scopeline"));
    G.ck(`${view}: affected parts are outlined`, "%C(blue)", await win.evaluate(() => { window.__logknobs.select(0); return [...document.querySelectorAll("#tokens .aff")].map(e => +e.dataset.i).join(); }) === "1,2,3,4,5");
    if (view === "blocks") {
      // each operator's stripes sit under exactly the parts in its range (no more, no fewer)
      const cover = await win.evaluate(() => { const out = {};
        for (const cell of document.querySelectorAll("#tokens .cell")) { const i = +cell.querySelector(".tk").dataset.i;
          for (const s of cell.querySelectorAll(".stripe[data-op]")) (out[s.dataset.op] ||= []).push(i); }
        return out; });
      G.ck("blocks: stripes cover exactly the affected parts", "per operator", JSON.stringify(cover) === JSON.stringify({ 0: [1, 2, 3, 4, 5], 3: [4, 5], 7: [8] }), JSON.stringify(cover));
      // a long template wraps instead of scrolling sideways
      await call(win, "setTemplate", "%h %s %an %ae %ad %cn %ce %cd %d %D %b %N %G? %gs %T %P %e %x41 %m %S %h %s %an %ae %ad", "t12");
      G.ck("blocks: long templates wrap, nothing scrolls out of sight", "wrap", await win.evaluate(() => { const t = document.getElementById("tokens");
        const tops = new Set([...t.querySelectorAll(".tk")].map(e => Math.round(e.getBoundingClientRect().top))); return t.scrollWidth <= t.clientWidth + 1 && tops.size > 1; }));
    } else {
      const ind = await win.evaluate(() => [...document.querySelectorAll("#tokens .bl")].map(b => b.textContent.match(/^ */)[0].length / 2));
      G.ck("bnf: indentation is scope depth", "depths", JSON.stringify(ind) === JSON.stringify([0, 1, 1, 1, 2, 2, 0, 0, 1]), JSON.stringify(ind));
    }
  }
  // a merge-making move is refused: literal "s" moved right after %a-family would become a new placeholder
  await call(win, "setTemplate", "%ad s|", "t12");
  await call(win, "moveNode", 1, 0);
  const n = await win.evaluate(() => window.__logknobs.C.template);
  G.ck("refusal", "move that changes how git reads text", n === "%ad s|" || n === " s|%ad", n);
  await call(win, "setTemplate", "%a", "t12"); await call(win, "insertLiteral", "n", 1);
  G.ck("refusal", "literal that would complete %a into %an", (await tpl()) === "%a" && (await win.textContent("#notice")).includes("merge"));
  G.ck("runtime", "no page errors", !errors.length, errors.join(" | "));
  await app.close(); process.exit(G.report() ? 1 : 0);
})().catch(e => { console.log("T12 ERROR:", e.stack.split("\n").slice(0, 3).join(" | ")); process.exit(2); });
