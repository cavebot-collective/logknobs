// Inlines the simulator (template engine, rev walk, graph, multi-commit view),
// the registry, the sample records and the brand lockup into one
// self-contained HTML file. No bundler: the app has no runtime dependencies by
// design, and a single file is what both hosts (browser, Electron) load.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
// Paths are relative to this file, so the build works from any directory; the
// LK_* overrides let a build run against an unpacked archive instead.
const HERE = fileURLToPath(new URL(".", import.meta.url));
process.chdir(HERE);
const SIM = process.env.LK_SIM || fileURLToPath(new URL("../probe/sim/", import.meta.url));
const EV = process.env.LK_EVIDENCE || fileURLToPath(new URL("../probe/evidence/", import.meta.url));
const REGISTRY_FILE = "registry-v0.3.0.json";

// Modules in dependency order. Their imports are satisfied by concatenation, so
// import lines are dropped and "export" keywords stripped. A name defined twice
// would be a SyntaxError at load, which the T8 launch catches.
const MODULES = ["width_table.mjs", "simulator.mjs", "walk.mjs", "graph.mjs", "logview.mjs"];
const sim = [...MODULES.map(f => SIM + f), "src/quoting.mjs"].map(f => `// ---- ${f.split("/").pop()}\n` + readFileSync(f, "utf8")
  .replace(/^import [^;]+;\s*$/gm, "").replace(/^export /gm, "")).join("\n");

const reg = JSON.parse(readFileSync(EV + REGISTRY_FILE, "utf8"));
for (const d of reg.directives) delete d.instances;             // UI doesn't need probe instances
const store = JSON.parse(readFileSync(EV + "records.json", "utf8"));
const pick = frag => Object.values(store.records).find(r => r.message.includes(frag));
const recs = [pick("fix typo"), pick("feat(parser)"), pick("refactor(core)")];
// history mode: the three topology repositories, one per message style, one shape
const stores = ["terse", "conventional", "verbose"].map(s => {
  const st = JSON.parse(readFileSync(`${EV}topology/records-${s}.json`, "utf8"));
  return { head: st.head, refs: st.refs, records: st.records };
});
const lockup = readFileSync("brand/assets/logknobs-wordmark-small.svg", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
let html = readFileSync("src/app.html", "utf8");
const subst = { "/*__LOCKUP__*/": JSON.stringify(lockup), "/*__SIM__*/": sim, "/*__REGISTRY__*/": JSON.stringify(reg),
                "/*__RECORDS__*/": JSON.stringify(recs), "/*__STORES__*/": JSON.stringify(stores),
                "/*__VERSION__*/": JSON.stringify(pkg.version) };
for (const [k, v] of Object.entries(subst)) {
  if (!html.includes(k)) throw new Error(`build: placeholder ${k} missing from src/app.html`);
  html = html.split(k).join(v);
}
mkdirSync("dist", { recursive: true });
writeFileSync("dist/index.html", html);
console.log(`logknobs ${pkg.version} — dist/index.html ${(html.length / 1024).toFixed(0)} KB — ${Object.keys(reg.controls).length} controls, ` +
            `${reg.directives.length} directives, ${Object.keys(reg.options).length} options, ${reg.presets.length} presets, ` +
            `${Object.keys(reg.themes).length} themes, ${recs.length} single cases, ${stores.length} history repositories`);
