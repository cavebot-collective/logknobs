#!/usr/bin/env python3
"""
Golden-corpus generator for the git-log format simulator.

This is the artifact the simulator is tested against. Each vector records the
exact argument vector handed to git and the exact bytes git produced, so a
reimplementation can be checked for byte equality rather than for eyeball
plausibility.

Design note on padding/truncation: the probe established that git's wide
character truncation does not obey a simple "fit within N columns" rule -- a
request for 14 columns and a request for 15 columns both yield 15 columns of
output on a CJK subject, and a request for 20 yields 21. Rather than encode a
guessed rule, the corpus sweeps the parameter space densely and pins observed
behavior. Agreement on the corpus is the contract; the rule itself is left
underdetermined on purpose.
"""
from __future__ import annotations
import json, os, subprocess, sys, pathlib, itertools, collections

REPO = sys.argv[1]
OUT = pathlib.Path(sys.argv[2])


# Signature verification needs the fixture's keyring, which lives beside the
# repo (never inside it -- see build_fixture.sh). Without this, every %G*
# vector records E "cannot check" instead of the signed behavior.
ENV = dict(os.environ, GNUPGHOME=REPO.rstrip("/") + "-gnupg")


def git(args: list[str]) -> tuple[int, bytes, bytes]:
    p = subprocess.run(["git", "-C", REPO] + args, capture_output=True, env=ENV)
    return p.returncode, p.stdout, p.stderr


def revs() -> dict[str, str]:
    _, out, _ = git(["log", "--all", "--format=%H %s"])
    table = {}
    for line in out.decode("utf-8").splitlines():
        h, _, s = line.partition(" ")
        table[s] = h
    pick = lambda frag: next(v for k, v in table.items() if frag in k)
    return {
        "terse":        pick("fix typo"),
        "conventional": pick("feat(parser)"),
        "verbose":      pick("refactor(core)"),
        "tagged":       pick("docs: clarify"),
        "wide":         pick("i18n"),
        "merge":        pick("Merge branch"),
        "encoded":      pick("explicit encoding header"),
        "signed":       pick("signed commit for"),
    }


REV = revs()
VECTORS: list[dict] = []


def emit(family: str, name: str, args: list[str]) -> None:
    rc, out, err = git(["log"] + args)
    VECTORS.append({
        "family": family,
        "name": name,
        "argv": ["git", "log"] + args,
        "rc": rc,
        "stdout_hex": out.hex(),
        "stdout_len": len(out),
        "stderr": err.decode("utf-8", "replace").strip()[:200],
    })


# ---------------------------------------------------------------- placeholders
REGISTRY = json.loads((OUT / "registry.json").read_text())
LIVE = [p["token"] for p in REGISTRY["placeholders"] if p["class"] == "EXPANDS"]

for tok in LIVE:
    for case, rev in REV.items():
        emit("placeholder", f"{tok}@{case}",
             ["-1", "--color=never", "--format=" + tok, rev])

# ------------------------------------------------------------------ reflog
# Every %g* placeholder is empty outside a reflog walk. Probing them without
# -g records an empty vector and reports false coverage.
for tok in ["%gD", "%gd", "%gn", "%gN", "%ge", "%gE", "%gs"]:
    emit("reflog", tok,
         ["-1", "--color=never", "--walk-reflogs", "--format=" + tok])

# ------------------------------------------------------------ padding sweep
SUBJECTS = {"terse": REV["terse"], "verbose": REV["verbose"], "wide": REV["wide"]}
for (mode, msym), (case, rev), n in itertools.product(
        [("left", "%<"), ("right", "%>"), ("steal", "%>>"), ("center", "%><")],
        SUBJECTS.items(), range(1, 41)):
    emit("pad", f"{mode}/{case}/N{n}",
         ["-1", "--color=never", "--format=" + f"{msym}({n})%s|", rev])

for (trunc, case, n) in itertools.product(
        ["trunc", "ltrunc", "mtrunc"], SUBJECTS, range(1, 41)):
    emit("pad-trunc", f"{trunc}/{case}/N{n}",
         ["-1", "--color=never", "--format=" + f"%<({n},{trunc})%s|", SUBJECTS[case]])

# column-relative padding depends on preceding output length
for sym, label in [("%<|", "col-left"), ("%>|", "col-right"), ("%><|", "col-center")]:
    for prefix in ["", "abc", "%h ", "%s "]:
        for n in (10, 20, 40, 60):
            emit("pad-col", f"{label}/pre={prefix or 'empty'}/N{n}",
                 ["-1", "--color=never",
                  "--format=" + f"{prefix}{sym}({n})%h|", REV["conventional"]])

# ------------------------------------------------------------------ wrapping
for w, i1, i2 in itertools.product([0, 20, 40, 60, 80], [0, 2, 4], [0, 4, 8]):
    emit("wrap", f"w({w},{i1},{i2})",
         ["-1", "--color=never", "--format=" + f"%w({w},{i1},{i2})%b", REV["verbose"]])
emit("wrap", "w(20)/cjk", ["-1", "--color=never", "--format=%w(20)%s", REV["wide"]])

# -------------------------------------------------------------------- color
COLORS = ["%Cred", "%Cgreen", "%Cblue", "%Creset", "%C(auto)", "%C(auto,blue)",
          "%C(always,red)", "%C(bold)", "%C(bold ul italic)", "%C(reverse)",
          "%C(dim)", "%C(strike)", "%C(blink)", "%C(226)", "%C(#ff8800)",
          "%C(normal)", "%C(brightred)", "%C(bold red ul)"]
for spec, mode in itertools.product(COLORS, ["always", "never", "auto"]):
    emit("color", f"{spec}/{mode}",
         ["-1", f"--color={mode}", "--format=" + spec + "%h%Creset|", REV["conventional"]])

# ------------------------------------------------------- named + date formats
for f in REGISTRY["named_formats"]:
    if f["class"] == "ACCEPTED":
        for case, rev in REV.items():
            emit("named-format", f'{f["name"]}@{case}',
                 ["-1", "--color=never", "--pretty=" + f["name"], rev])
for d in REGISTRY["date_formats"]:
    if d["class"] == "ACCEPTED":
        emit("date-format", d["name"],
             ["-1", "--color=never", "--date=" + d["name"],
              "--format=%ad|%cd", REV["conventional"]])

# ------------------------------------------ non-format flags that alter output
FLAGS = [["--abbrev-commit"], ["--abbrev=4"], ["--abbrev=16"], ["--no-abbrev-commit"],
         ["--graph"], ["--oneline"], ["--decorate=short"], ["--decorate=full"],
         ["--decorate=no"], ["--decorate=auto"], ["--parents"], ["--children"],
         ["--stat"], ["--shortstat"], ["--name-only"], ["--name-status"],
         ["--numstat"], ["--patch"], ["--raw"], ["--left-right"], ["--notes"],
         ["--no-notes"], ["--show-signature"], ["--relative-date"],
         ["--first-parent"], ["--merges"], ["--no-merges"], ["--reverse"],
         ["--walk-reflogs"], ["--all"], ["--simplify-by-decoration"]]
for flags in FLAGS:
    emit("flag", " ".join(flags),
         ["-3", "--color=never", "--format=%h %s"] + flags)

# --------------------------------------------------------- separator semantics
for kind in ["format", "tformat"]:
    emit("separator", kind,
         ["-3", "--color=never", f"--pretty={kind}:%h"])


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    doc = {"git_version": REGISTRY["git_version"], "revs": REV, "vectors": VECTORS}
    (OUT / "corpus.json").write_text(json.dumps(doc, indent=1))
    tally = collections.Counter(v["family"] for v in VECTORS)
    errs = [v for v in VECTORS if v["rc"] != 0]
    total_bytes = sum(v["stdout_len"] for v in VECTORS)
    print(f"corpus: {len(VECTORS)} vectors, {total_bytes} bytes of golden output")
    for k, n in sorted(tally.items()):
        print(f"  {k:<14} {n}")
    print(f"failed invocations: {len(errs)}")
    for e in errs[:10]:
        print(f"  {e['name']}: {e['stderr']}")
    return 1 if errs else 0


if __name__ == "__main__":
    raise SystemExit(main())
