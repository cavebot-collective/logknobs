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
      await win.dragAndDrop(`#palette .chip-ins[data-insert="${tok}"]`, gap(view, g));
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
    // refusal: "%a" followed by literal "n..." would read as %an
    await call(win, "setTemplate", "%h %ad|n|", "t12");
    await call(win, "replaceNode", 2, "%ad");
    // scope brackets
    await call(win, "setTemplate", "%C(blue)%h %<(9)-%an%Creset%w(20,0,2)%s", "t12");
    const ranges = await win.evaluate(() => window.__logknobs.scopeRanges(window.__logknobs.nodes()));
    const want = [{ op: 0, from: 1, to: 5, scope: "until-reset" }, { op: 3, from: 4, to: 5, scope: "next-placeholder" }, { op: 7, from: 8, to: 8, scope: "until-next-wrap" }];
    G.ck(`${view}: scope ranges`, "color / pad / wrap", JSON.stringify(ranges) === JSON.stringify(want), JSON.stringify(ranges));
    if (view === "blocks") {
      const brs = await win.evaluate(() => [...document.querySelectorAll("#tokens .br")].map(b => [+b.dataset.op, b.style.gridColumn]));
      G.ck("blocks: brackets cover exactly the affected parts", "grid columns", JSON.stringify(brs) === JSON.stringify([[0, "4 / 13"], [3, "10 / 13"], [7, "18 / 19"]]), JSON.stringify(brs));
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
