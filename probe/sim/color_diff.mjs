/*
 * Oracle A -- color-grammar family.
 *
 * Every vector is judged on two axes:
 *   accepted by git  -> simulator output must be byte-identical
 *   rejected by git  -> simulator must report an error, and only in that mode
 * The second axis matters as much as the first: git's refusal depends on the
 * color mode (a spec is validated only when emitted), and a tool that renders
 * a guess where git aborts would teach users a template that breaks in a
 * terminal.
 */
import { readFileSync } from "node:fs";
import { render } from "./simulator.mjs";

const EV = process.argv[2] || decodeURIComponent(new URL("../evidence", import.meta.url).pathname);
const sweep = JSON.parse(readFileSync(`${EV}/color-sweep.json`, "utf8"));
const store = JSON.parse(readFileSync(`${EV}/records.json`, "utf8"));
// The sweep records the commit it ran against; use it, never guess.
const head = store.records[sweep.rev];
if (!head) throw new Error(`precondition: swept rev ${sweep.rev} missing from records.json`);

const fams = {}; const fails = [];
for (const v of sweep.vectors) {
  const r = render(v.format, head, { color: v.color });
  const want = Buffer.from(v.stdout_hex, "hex");
  let ok;
  if (v.rc !== 0) ok = !!r.error;
  else ok = !r.error && Buffer.from(r.text + "\n", "utf8").equals(want);
  const f = (fams[v.family] ||= { pass: 0, fail: 0 }); ok ? f.pass++ : f.fail++;
  if (!ok) fails.push({ ...v, got: r.error ? `ERROR ${r.error}` : JSON.stringify(r.text),
                        want: v.rc ? `rc=${v.rc}` : JSON.stringify(want.toString("utf8").replace(/\n$/, "")) });
}
let P = 0, T = 0;
console.log("ORACLE A -- color grammar (simulator vs git 2.43)");
for (const [k, f] of Object.entries(fams)) {
  P += f.pass; T += f.pass + f.fail;
  console.log(`  ${k.padEnd(10)} ${String(f.pass).padStart(4)}/${f.pass + f.fail}`);
}
console.log(`  TOTAL      ${P}/${T}`);
for (const f of fails.slice(0, +process.env.N || 12))
  console.log(`  FAIL [${f.family}] ${JSON.stringify(f.spec)} color=${f.color}\n       want ${f.want}\n       got  ${f.got}`);
process.exit(P === T ? 0 : 1);
