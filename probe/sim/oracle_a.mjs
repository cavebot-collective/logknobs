/*
 * Oracle A -- byte differential.
 *
 * For every corpus vector in a template-evaluation family, re-derive the render
 * with the simulator and compare BYTES against what git actually produced.
 *
 * Two reporting rules keep the number honest:
 *
 *  1. Vectors whose output depends on a host-supplied field (decoration,
 *     describe, notes, signature status, relative/human dates, %S, %m) are
 *     counted SEPARATELY. The simulator is handed those values, so agreement
 *     proves placement, not computation. Folding them into the headline number
 *     would inflate it with vectors that cannot fail.
 *
 *  2. Families that are git CLI behavior rather than template evaluation
 *     (named-format, flag, date-format, separator) are out of scope here and
 *     reported as such rather than silently skipped.
 */
import { readFileSync } from "node:fs";
import { render } from "./simulator.mjs";

const EVIDENCE = process.argv[2] || decodeURIComponent(new URL("../evidence", import.meta.url).pathname);
const corpus = JSON.parse(readFileSync(`${EVIDENCE}/corpus.json`, "utf8"));
const store = JSON.parse(readFileSync(`${EVIDENCE}/records.json`, "utf8"));

const ENGINE_FAMILIES = new Set(["placeholder", "pad", "pad-trunc", "pad-col",
                                 "wrap", "color"]);
const OUT_OF_SCOPE = new Set(["named-format", "flag", "date-format", "separator",
                              "reflog"]);
// %d, %D and %(decorate...) were host-supplied through v0.8.0. Since v0.9.0 the
// simulator RENDERS decorations (format_decorations port); only the ref set and
// its order come from the host, as parsed --decorate=full input. They are now
// scored in the ENGINE bucket.
const HOST_TOKENS = [/%N\b/, /%S\b/, /%m\b/, /%ar\b/, /%cr\b/,
                     /%ah\b/, /%ch\b/, /%G/, /%\(describe/];

const argOf = (argv, p) => {
  const a = argv.find(x => x.startsWith(p));
  return a ? a.slice(p.length) : null;
};

const results = new Map();
const failures = [];

for (const v of corpus.vectors) {
  if (OUT_OF_SCOPE.has(v.family)) continue;
  if (!ENGINE_FAMILIES.has(v.family)) continue;

  const fmt = argOf(v.argv, "--format=");
  if (fmt === null) continue;
  const rev = v.argv[v.argv.length - 1];
  const rec = store.records[rev];
  if (!rec) continue;

  const color = argOf(v.argv, "--color=") || "never";
  const hostDependent = HOST_TOKENS.some(re => re.test(fmt));
  const bucket = hostDependent ? `${v.family} [host-supplied]` : v.family;

  const golden = Buffer.from(v.stdout_hex, "hex");
  let actual;
  try {
    actual = Buffer.from(render(fmt, rec, { color }).text + "\n", "utf8");
  } catch (e) {
    actual = Buffer.from(`<<throw: ${e.message}>>`, "utf8");
  }

  const ok = actual.equals(golden);
  const r = results.get(bucket) || { pass: 0, fail: 0 };
  ok ? r.pass++ : r.fail++;
  results.set(bucket, r);
  if (!ok && failures.length < 400) {
    failures.push({ family: v.family, name: v.name, fmt,
                    want: golden.toString("utf8").replace(/\n$/, ""),
                    got: actual.toString("utf8").replace(/\n$/, "") });
  }
}

let P = 0, F = 0, HP = 0, HF = 0;
console.log("ORACLE A — byte differential (simulator vs real git)\n");
for (const [k, r] of [...results].sort()) {
  const tot = r.pass + r.fail;
  const pct = ((r.pass / tot) * 100).toFixed(1);
  console.log(`  ${k.padEnd(28)} ${String(r.pass).padStart(4)}/${String(tot).padEnd(4)}  ${pct}%`);
  if (k.includes("host-supplied")) { HP += r.pass; HF += r.fail; }
  else { P += r.pass; F += r.fail; }
}
console.log(`\n  ENGINE  ${P}/${P + F}  (${((P / (P + F)) * 100).toFixed(1)}%)`);
console.log(`  host-supplied (placement only) ${HP}/${HP + HF}`);

const QUIET = process.env.QUIET === "1";
const byFamily = QUIET ? {} : {};
if (!QUIET) {
for (const f of failures) (byFamily[f.family] ||= []).push(f);
for (const f of failures) (byFamily[f.family] ||= []).push(f);
for (const [fam, fs] of Object.entries(byFamily)) {
  console.log(`\n--- ${fam}: ${fs.length} failures, first 2 ---`);
  for (const f of fs.slice(0, 2)) {
    console.log(`  ${f.name}  fmt=${JSON.stringify(f.fmt)}`);
    console.log(`    want ${JSON.stringify(f.want.slice(0, 100))}`);
    console.log(`    got  ${JSON.stringify(f.got.slice(0, 100))}`);
  }
}
}

// ---- T8a: per-control Oracle A coverage ----------------------------------
// Partial activation of the D-2 gate. T8 proper needs the UI (a control's
// change must be shown to propagate to the preview); T8a asserts the weaker,
// checkable property that every control owns at least one directive that a
// PASSING vector exercises. A control failing T8a cannot possibly pass T8.
import { tokenize } from "./simulator.mjs";
const reg = JSON.parse(readFileSync(`${EVIDENCE}/registry-v0.1.0.json`, "utf8"));
const PAD = /^%(>>|><\||<\||>\||><|<|>)\(/;
const dirOfNode = n => {
  if (n.kind === "pad") return `%${{left:"<",right:">",steal:">>",centre:"><","col-left":"<|","col-right":">|","col-centre":"><|"}[n.mode]}(<n>)`;
  if (n.kind === "wrap") return "%w(<w>,<i1>,<i2>)";
  if (n.kind === "color") return /^%C\(/.test(n.tok) ? "%C(<spec>)" : n.tok;
  if (n.kind === "modifier") return `%${n.tok[1] === "+" ? "+" : n.tok[1] === "-" ? "-" : " "}<X>`;
  if (n.kind === "value" && n.field === "hexbyte") return "%xNN";
  if (n.kind === "value" && n.field === "percent") return "%%";
  if (n.kind === "value" && /^%\(/.test(n.tok)) return `%(${n.field})`;
  return n.tok;
};
const covered = new Set();
for (const v of corpus.vectors) {
  if (!ENGINE_FAMILIES.has(v.family)) continue;
  const fmt = argOf(v.argv, "--format="); if (!fmt) continue;
  const rec = store.records[v.argv[v.argv.length - 1]]; if (!rec) continue;
  const color = argOf(v.argv, "--color=") || "never";
  let ok = false;
  try { ok = Buffer.from(render(fmt, rec, { color }).text + "\n", "utf8")
               .equals(Buffer.from(v.stdout_hex, "hex")); } catch {}
  if (!ok) continue;
  for (const n of tokenize(fmt)) covered.add(dirOfNode(n));
}
const ctrlCov = {}, missing = [];
for (const [name, c] of Object.entries(reg.controls)) {
  const hit = c.directives.filter(d => covered.has(d));
  ctrlCov[name] = `${hit.length}/${c.directives.length}`;
  if (!hit.length) missing.push(name);
}
console.log("\nT8a — per-control Oracle A coverage (directives exercised by a PASSING vector)");
for (const [k, v] of Object.entries(ctrlCov).sort()) console.log(`  ${k.padEnd(20)} ${v}`);
console.log(`\n  [${missing.length ? "FAIL" : "PASS"}] T8a  controls with zero passing coverage: ${missing.length ? missing.join(", ") : "none"}`);

// ---- named-format family ------------------------------------------------
import { renderNamed, NAMED_FORMATS } from "./simulator.mjs";
{
  let np = 0, nf = 0; const fails = [];
  for (const v of corpus.vectors.filter(x => x.family === "named-format")) {
    const pretty = argOf(v.argv, "--pretty="); if (!pretty || !NAMED_FORMATS.includes(pretty)) continue;
    const rec = store.records[v.argv[v.argv.length - 1]]; if (!rec) continue;
    const golden = Buffer.from(v.stdout_hex, "hex");
    let actual; try { actual = Buffer.from(renderNamed(pretty, rec, { color: "never" }), "utf8"); } catch (e) { actual = Buffer.from("<<" + e.message + ">>"); }
    if (actual.equals(golden)) np++; else { nf++; fails.push({ name: v.name, want: golden.toString("utf8"), got: actual.toString("utf8") }); }
  }
  console.log(`\n  named-format (built-in renderer)  ${np}/${np + nf}  ${((np / (np + nf)) * 100).toFixed(1)}%`);
  if (!QUIET) for (const f of fails.slice(0, +process.env.N || 3)) {
    const wl = f.want.split("\n"), gl = f.got.split("\n"); let i = 0; while (i < wl.length && wl[i] === gl[i]) i++;
    console.log(`  ${f.name}  first diff line ${i}\n    want ${JSON.stringify(wl[i])}\n    got  ${JSON.stringify(gl[i])}`);
  }
  if (nf) process.exitCode = 1;
}

// ---- options: separator semantics, --abbrev, --decorate ------------------
import { renderAll } from "./simulator.mjs";
{
  let op = 0, of = 0; const notes = [];
  const revs3 = ["log", "-3"]; // the flag family renders HEAD..HEAD~2; reproduce via first-parent chain
  const head = corpus.revs ? null : null;
  const chain = (() => { const byH = store.records; let h = Object.values(byH).find(r => r.host && r.host.decoration_bare && r.host.decoration_bare.startsWith("HEAD"))?.H; const out = []; while (h && byH[h] && out.length < 3) { out.push(byH[h]); h = byH[h].P[0]; } return out; })();
  const check = (name, want, got) => { if (want.equals(got)) op++; else { of++; notes.push(`${name}\n    want ${JSON.stringify(want.toString())}\n    got  ${JSON.stringify(got.toString())}`); } };
  for (const v of corpus.vectors.filter(x => x.family === "separator")) {
    const kind = argOf(v.argv, "--pretty=").split(":")[0];
    check("separator/" + kind, Buffer.from(v.stdout_hex, "hex"),
      Buffer.from(kind === "format" ? chain.map(r => render("%h", r).text).join("\n") : renderAll("%h", chain), "utf8"));
  }
  for (const v of corpus.vectors.filter(x => x.family === "flag" && /^--abbrev=\d+$/.test(x.name))) {
    const n = +v.name.split("=")[1];
    check(v.name, Buffer.from(v.stdout_hex, "hex"), Buffer.from(renderAll("%h %s", chain, { abbrev: n }), "utf8"));
  }
  console.log(`\n  options (separator, --abbrev)   ${op}/${op + of}`);
  if (!QUIET) for (const n of notes) console.log("  " + n);
  if (of) process.exitCode = 1;
}
