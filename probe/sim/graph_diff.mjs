/*
 * Oracle A -- graph, graph-colors, graph-builtin and history families.
 * Byte equality of the whole multi-commit output against real git.
 */
import { readFileSync } from "node:fs";
import { renderLog } from "./logview.mjs";

const EV = process.argv[2] || decodeURIComponent(new URL("../evidence", import.meta.url).pathname);
const CORPUS = process.argv[3] || "graph-corpus.json";   // graph-heldout.json for the held-out sweep
const C = JSON.parse(readFileSync(`${EV}/topology/${CORPUS}`, "utf8"));
const stores = {};
const store = s => (stores[s] ||= JSON.parse(readFileSync(`${EV}/topology/records-${s}.json`, "utf8")));
const arg = (a, p) => { const x = a.find(v => v.startsWith(p)); return x ? x.slice(p.length) : null; };

export function optsFromArgs(args, config) {
  const fmt = arg(args, "--format="), pretty = arg(args, "--pretty=");
  let mode = "tformat", template = null;
  if (fmt !== null) { const i = fmt.indexOf(":"); mode = fmt.slice(0, i); template = fmt.slice(i + 1); }
  else if (pretty !== null) mode = pretty;
  const oneline = args.includes("--oneline");
  if (oneline) mode = "oneline";
  if (fmt === null && pretty === null && !oneline) mode = "medium";     // git's default
  const cfg = {};
  for (let i = 0; i < config.length; i += 2) { const [k, v] = config[i + 1].split(/=(.*)/s); cfg[k] = v; }
  return {
    template, pretty: mode, graph: args.includes("--graph"), color: arg(args, "--color=") || "never",
    all: args.includes("--all"), firstParent: args.includes("--first-parent"),
    order: args.includes("--topo-order") ? "topo" : args.includes("--date-order") ? "date"
         : args.includes("--author-date-order") ? "author-date" : "default",
    decorate: arg(args, "--decorate=") || (args.includes("--decorate") ? "short" : "auto"), config: cfg,
    dateStyle: arg(args, "--date=") || "default", reverse: args.includes("--reverse"),
    maxCount: (a => a ? +a.slice(1) : undefined)(args.find(a => /^-\d+$/.test(a))),
    abbrevCommit: oneline || args.includes("--abbrev-commit"),
  };
}

const fam = {}, fails = [];
for (const v of C.vectors) {
  const got = renderLog(store(v.style), optsFromArgs(v.args, v.config));
  const want = Buffer.from(v.stdout_hex, "hex").toString("utf8");
  const ok = !got.error && got.text === want;
  const f = (fam[v.family] ||= { pass: 0, fail: 0 }); ok ? f.pass++ : f.fail++;
  if (!ok) fails.push({ v, got: got.error ? "ERROR " + got.error : got.text, want });
}
let P = 0, T = 0;
console.log("ORACLE A -- graph & history (simulator vs git 2.43)");
for (const [k, f] of Object.entries(fam)) { P += f.pass; T += f.pass + f.fail;
  console.log(`  ${k.padEnd(14)} ${String(f.pass).padStart(4)}/${f.pass + f.fail}`); }
console.log(`  TOTAL          ${P}/${T}`);
const N = +process.env.N || 3;
for (const { v, got, want } of fails.slice(0, N)) {
  const wl = want.split("\n"), gl = got.split("\n"); let i = 0; while (i < wl.length && wl[i] === gl[i]) i++;
  console.log(`\nFAIL ${v.name}  first diff at line ${i}`);
  for (let k = Math.max(0, i - 3); k < Math.min(wl.length, i + 3); k++)
    console.log(`   ${String(k).padStart(3)} want ${JSON.stringify(wl[k])}\n       got  ${JSON.stringify(gl[k])}`);
}
if (process.env.FAMS) for (const x of fails) console.log(x.v.name);
process.exit(P === T ? 0 : 1);
