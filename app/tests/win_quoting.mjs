/*
 * Windows quoting gate. Runs on windows-latest (workflow windows-quoting.yml).
 *
 * For every stress argument list and every shell target, the generated command
 * line is run through that shell for real, and git's stdout must equal, byte
 * for byte, the output of git invoked directly with the same argv (no shell).
 * The same is done for the `git config` commands the app's config export
 * generates: the value git reads back must be exactly the value intended.
 *
 *   cmd             cmd.exe /d /s /c "<line>"     (the prompt's parsing rules)
 *   cmd-batch       the line inside a .bat file run by cmd.exe
 *   powershell      pwsh -File x.ps1              (7.3+ argument passing)
 *   powershell-5.1  powershell.exe -File x.ps1    (legacy argument passing)
 *
 * Environment variables named like git placeholders are set on purpose, so a
 * line that lets cmd expand %cd% or %an% fails here instead of on a user's
 * machine. Writes a markdown table to $GITHUB_STEP_SUMMARY and a JSON record.
 */
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SHELLS, commandLine } from "../src/quoting.mjs";
const RESULTS = fileURLToPath(new URL("./results/", import.meta.url));

const REPO = process.argv[2];
if (!REPO) { console.error("usage: node win_quoting.mjs <repo>"); process.exit(2); }
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lk q "));      // a space in the path, on purpose
const TRAP = { AN: "TRAP_AN", S: "TRAP_S", H: "TRAP_H", N: "TRAP_N", AD: "TRAP_AD", D: "TRAP_D" };
const env = { ...process.env, ...TRAP, GIT_CONFIG_NOSYSTEM: "1", GIT_PAGER: "cat" };

const TEMPLATES = {
  "cd-trap": "%h %cd%n%s",
  "an-trap": "%h %an%n%s %ad%d%",
  "quotes": `%h "%s" it's`,
  "typographic-quotes": "%h \u2018%s\u2019 \u201Cx\u201D",
  "metachars": "%h & %s | <x> ^ (y) ! ; , = `t $env:PATH",
  "backslashes": "%h \\ %s \\\\ \\\" end",
  "trailing-backslash": "%h %s \\",
  "cjk-emoji": "%h \u4E2D\u6587 %s \uD83C\uDF0D",
  "lead-trail-space": " %h %s ",
  "color": "%C(auto)%h%C(bold #ff8800)%d%Creset %s",
  "percent-literal": "%h 100%% done %%cd%%",
  "padding": "%<(12,trunc)%an|%>(9)%h|%s",
};
const cases = [];
for (const [name, tpl] of Object.entries(TEMPLATES)) {
  cases.push({ name, kind: "log", args: ["-C", REPO, "log", "--color=always", "-3", `--format=${tpl}`] });
}
cases.push({ name: "graph-config", kind: "log", args: ["-C", REPO, "-c", "log.graphColors=blue, 208", "-c", "color.decorate.HEAD=bold #ff8800",
  "log", "--graph", "--all", "--color=always", "--date=short", "--format=%C(auto)%h %ad%d %s"] });
for (const [name, tpl] of Object.entries(TEMPLATES))
  cases.push({ name: "config:" + name, kind: "config", key: "pretty.lkt", value: `tformat:${tpl}` });
cases.push({ name: "config:alias", kind: "config", key: "alias.lkt", value: "log --graph --all --pretty=lkt" });

const have = exe => spawnSync(exe, ["-NoProfile", "-Command", "exit 0"], { stdio: "ignore" }).status === 0;
const RUNNERS = {
  "cmd": line => spawnSync("cmd.exe", ["/d", "/s", "/c", `"${line}"`], { windowsVerbatimArguments: true, env, maxBuffer: 1 << 26 }),
  "cmd-batch": line => { const f = path.join(TMP, "run.bat"); fs.writeFileSync(f, `@echo off\r\nchcp 65001 >nul\r\n${line}\r\n`, "utf8");
    return spawnSync("cmd.exe", ["/d", "/c", f], { env, maxBuffer: 1 << 26 }); },
  "powershell": line => { const f = path.join(TMP, "run.ps1"); fs.writeFileSync(f, "\uFEFF" + line + "\r\n", "utf8");
    return spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", f], { env, maxBuffer: 1 << 26 }); },
  "powershell-5.1": line => { const f = path.join(TMP, "run51.ps1"); fs.writeFileSync(f, "\uFEFF" + line + "\r\n", "utf8");
    return spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", f], { env, maxBuffer: 1 << 26 }); },
};
const available = { "bash": false, "cmd": true, "cmd-batch": true, "powershell": have("pwsh"), "powershell-5.1": have("powershell.exe") };

const rows = []; let fail = 0;
for (const shell of SHELLS.filter(s => s !== "bash")) {
  if (!available[shell]) { rows.push({ shell, name: "(shell not installed)", ok: false }); fail++; continue; }
  for (const c of cases) {
    let ok, note = "", line;
    if (c.kind === "log") {
      const want = execFileSync("git", c.args, { env, maxBuffer: 1 << 26 });
      line = commandLine(shell, "git", c.args);
      const r = RUNNERS[shell](line);
      const got = r.stdout || Buffer.alloc(0);
      ok = r.status === 0 && Buffer.compare(got, want) === 0;
      if (!ok) note = `rc=${r.status} got ${JSON.stringify(got.toString("utf8").slice(0, 80))} want ${JSON.stringify(want.toString("utf8").slice(0, 80))} ${String(r.stderr || "").slice(0, 120)}`;
    } else {
      const cfgFile = path.join(TMP, `${shell}.gitconfig`); fs.writeFileSync(cfgFile, "");
      line = commandLine(shell, "git", ["config", "--file", cfgFile, c.key, c.value]);
      const r = RUNNERS[shell](line);
      const back = spawnSync("git", ["config", "--file", cfgFile, "--get", c.key], { env }).stdout?.toString("utf8").replace(/\r?\n$/, "");
      ok = r.status === 0 && back === c.value;
      if (!ok) note = `rc=${r.status} read back ${JSON.stringify(back)} want ${JSON.stringify(c.value)} ${String(r.stderr || "").slice(0, 120)}`;
    }
    rows.push({ shell, name: c.name, ok, line, note }); if (!ok) fail++;
  }
}
// Negative controls: naive quoting MUST fail on the cases built to catch it.
// If one passes, the traps are not live (e.g. the variable was not expanded)
// and the passes above prove nothing.
const naive = {
  "cmd: bash-style double quotes let %cd% expand": ["cmd", `git -C "${REPO}" log -3 --color=always "--format=%h %cd%n%s"`, "cd-trap"],
  "cmd: unescaped %an% expands to the trap value": ["cmd", `git -C "${REPO}" log -3 --color=always "--format=%h %an%n%s %ad%d%"`, "an-trap"],
  "cmd-batch: prompt quoting loses % in a .bat": ["cmd-batch", commandLine("cmd", "git", cases.find(c => c.name === "cd-trap").args), "cd-trap"],
  "powershell-5.1: 7.3+ quoting breaks embedded quotes": ["powershell-5.1", commandLine("powershell", "git", cases.find(c => c.name === "quotes").args), "quotes"],
};
for (const [name, [shell, line, caseName]] of Object.entries(naive)) {
  if (!available[shell]) continue;
  const want = execFileSync("git", cases.find(c => c.name === caseName).args, { env, maxBuffer: 1 << 26 });
  const r = RUNNERS[shell](line);
  const differs = r.status !== 0 || Buffer.compare(r.stdout || Buffer.alloc(0), want) !== 0;
  rows.push({ shell: "negative control", name, ok: differs, line, note: differs ? "" : "naive quoting was NOT caught: the trap is not live" });
  if (!differs) fail++;
}
const by = {};
for (const r of rows) { const b = (by[r.shell] ||= [0, 0]); b[r.ok ? 0 : 1]++; }
let md = `### Windows quoting — generated commands run through each shell vs git invoked directly\n\n| shell | pass | fail |\n|---|---|---|\n`;
for (const [s, [p, f]] of Object.entries(by)) md += `| ${s} | ${p} | ${f} |\n`;
const fails = rows.filter(r => !r.ok);
if (fails.length) { md += `\n#### failures\n\n| shell | case | detail |\n|---|---|---|\n`;
  for (const r of fails) md += `| ${r.shell} | ${r.name} | \`${(r.note || "").replace(/\|/g, "\\|").replace(/`/g, "'")}\` |\n`; }
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
fs.mkdirSync(RESULTS, { recursive: true });
fs.writeFileSync(path.join(RESULTS, "win-quoting.json"), JSON.stringify(rows, null, 1));
console.log(`\nWIN-QUOTING GATE: ${fail ? "FAIL" : "PASS"} (${rows.length - fail}/${rows.length})`);
process.exit(fail ? 1 : 0);
