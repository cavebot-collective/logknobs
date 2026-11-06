/*
 * Quoting gate, Linux half. bash lines are EXECUTED here and must reproduce
 * git's output for the direct argv. The Windows targets cannot be executed on
 * Linux; for them this checks only that the MSVCRT layer round-trips through a
 * reference parser of the CommandLineToArgvW rules -- the real proof is the
 * windows-quoting workflow (tests/win_quoting.mjs) on windows-latest.
 */
import { execFileSync, execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { msvcrtQuote, commandLine } from "../src/quoting.mjs";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const REPO = path.join(process.env.LK_WORK || path.join(ROOT, ".work"), "topo-verbose");
const STRESS = ["%h %cd%n%s", `%h "%s" it's`, "%h ‘%s’", "%h & %s | <x> ^ (y) ! ; , = $HOME `x`", "%h \\ %s \\\\ \\\" end",
                "%h %s \\", "%h 中文 %s", " %h %s ", "%C(auto)%h%C(bold #ff8800)%d%Creset %s", "%h 100%% done", "%h\t%s", "\\\\server\\x\\%h"];
// CommandLineToArgvW (post-2008 rules) for one argument run
function parseArgs(s) {
  const out = []; let i = 0;
  while (i < s.length) {
    while (s[i] === " " || s[i] === "\t") i++;
    if (i >= s.length) break;
    let a = "", q = false;
    for (; i < s.length; i++) {
      const ch = s[i];
      if (ch === "\\") { let n = 0; while (s[i] === "\\") { n++; i++; }
        if (s[i] === '"') { a += "\\".repeat(n >> 1); if (n & 1) a += '"'; else q = !q; continue; }   // the quote is consumed
        a += "\\".repeat(n); i--; continue; }
      if (ch === '"') { if (q && s[i + 1] === '"') { a += '"'; i++; } else q = !q; continue; }
      if (!q && (ch === " " || ch === "\t")) break;
      a += ch;
    }
    out.push(a);
  }
  return out;
}
let pass = 0, fail = 0;
const ck = (name, ok, note = "") => { ok ? pass++ : (fail++, console.log(`  FAIL ${name} ${note}`)); };
for (const s of STRESS) {
  const back = parseArgs("x " + msvcrtQuote(s)).slice(1);
  ck(`msvcrt round-trip ${JSON.stringify(s)}`, back.length === 1 && back[0] === s, JSON.stringify(back));
}
for (const s of STRESS.filter(Boolean)) {
  const args = ["-C", REPO, "log", "-3", "--color=always", `--format=${s}`];
  const want = execFileSync("git", args);
  const got = execSync(commandLine("bash", "git", args), { shell: "/bin/bash" });
  ck(`bash executes ${JSON.stringify(s)}`, Buffer.compare(got, want) === 0);
}
console.log(`QUOTING (Linux half): ${pass}/${pass + fail}\n\nQUOTING GATE: ${fail ? "FAIL" : "PASS"} (${pass}/${pass + fail})`);
process.exit(fail ? 1 : 0);
