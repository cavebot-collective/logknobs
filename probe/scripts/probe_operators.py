#!/usr/bin/env python3
"""
Compositional probe for *operator* placeholders.

The first probe classified placeholders in isolation, which is correct for
value placeholders (%h, %an) but wrong for operators. Padding (%<, %>, %><),
wrapping (%w) and color (%C) do not produce output themselves -- they modify
the rendering of what follows. Probed alone they expand to empty and would be
misclassified as inert.

This probe therefore evaluates each operator in composition, and pins
--color=always so that color directives actually emit SGR sequences (without
a TTY git suppresses them, which silently defeats a differential oracle).

Unicode is probed explicitly: git's padding counts *display columns* while its
truncation counts *bytes*, so CJK and emoji are the divergence point between
git and a naive JavaScript reimplementation using String.length.
"""
from __future__ import annotations
import json, subprocess, sys, pathlib

REPO = sys.argv[1] if len(sys.argv) > 1 else str(pathlib.Path(__file__).resolve().parents[2] / ".work/fixture")
OUT = pathlib.Path(sys.argv[2])   # required: never default onto delivered evidence

REVS = {
    "terse":        "3b69fe8c7f5b7190dbb6db47de4c2c4da7d1b910",
    "conventional": "c9e77e7fc50f6bb51bf8c72c3c27589bafa1c278",
    "verbose":      "2bd351db33f7b82f3ac16dd81f1d79b3fdf19541",
}


def rev_for_subject(pattern: str) -> str:
    p = subprocess.run(["git", "-C", REPO, "log", "--all", "--format=%H %s"],
                       capture_output=True, text=True)
    for line in p.stdout.splitlines():
        oid, _, subj = line.partition(" ")
        if pattern in subj:
            return oid
    raise SystemExit(f"fixture missing commit matching {pattern!r}")


def run_fmt(fmt: str, rev: str, color: bool) -> dict:
    args = ["git", "-C", REPO, "log", "-1"]
    args.append("--color=always" if color else "--color=never")
    args += ["--format=" + fmt, rev]
    p = subprocess.run(args, capture_output=True, text=True, errors="surrogateescape")
    out = p.stdout
    if out.endswith("\n"):
        out = out[:-1]
    return {"rc": p.returncode, "out": out, "err": p.stderr.strip()[:200]}


CASES: list[tuple[str, str, str, bool]] = []
def case(group, name, fmt, rev, color=False):
    CASES.append((group, name, fmt, rev, color))


wide = rev_for_subject("i18n")
long_subj = REVS["verbose"]

# --- padding: left/right/centered, truncation variants ---------------------
for spec, label in [("%<(20)", "left-pad-20"), ("%<(20,trunc)", "trunc-right"),
                    ("%<(20,ltrunc)", "trunc-left"), ("%<(20,mtrunc)", "trunc-mid"),
                    ("%>(20)", "right-pad-20"), ("%>>(20)", "right-pad-steal"),
                    ("%><(20)", "center-20")]:
    case("pad", f"{label}/ascii-long", spec + "%s|", long_subj)
    case("pad", f"{label}/ascii-short", spec + "%s|", REVS["terse"])
    case("pad", f"{label}/cjk-emoji", spec + "%s|", wide)

# --- column-relative padding ---------------------------------------------
for spec, label in [("%<|(40)", "col-left-40"), ("%>|(40)", "col-right-40"),
                    ("%><|(40)", "col-center-40")]:
    case("pad", f"{label}/ascii", "abc" + spec + "%h|", REVS["conventional"])
    case("pad", f"{label}/cjk", "%s" + spec + "%h|", wide)

# --- wrapping -------------------------------------------------------------
case("wrap", "w60-2-4/verbose-body", "%w(60,2,4)%b", REVS["verbose"])
case("wrap", "w40-0-8/verbose-body", "%w(40,0,8)%b", REVS["verbose"])
case("wrap", "w0-0-0/verbose-body", "%w(0,0,0)%b", REVS["verbose"])
case("wrap", "w60/cjk-subject", "%w(20)%s", wide)

# --- color: the tri-state and the attribute grammar ---------------------
for spec in ["%Cred", "%Cgreen", "%Cblue", "%C(auto)", "%C(auto,blue)",
             "%C(always,red)", "%C(bold)", "%C(bold ul italic)", "%C(reverse)",
             "%C(dim)", "%C(strike)", "%C(blink)", "%C(226)", "%C(#ff8800)",
             "%C(normal)", "%C(brightred)", "%C(bold red ul)"]:
    case("color", f"{spec}/color=always", spec + "%h%Creset|", REVS["conventional"], True)
    case("color", f"{spec}/color=never", spec + "%h%Creset|", REVS["conventional"], False)

# --- interaction: does padding count SGR bytes as columns? ---------------
case("interaction", "pad-over-colored", "%<(20)%C(always,red)%s%Creset|", REVS["terse"], True)
case("interaction", "color-inside-pad-cjk", "%<(20)%C(always,green)%s%Creset|", wide, True)
case("interaction", "wrap-over-colored", "%w(40,0,4)%C(always,blue)%b%Creset", REVS["verbose"], True)
case("interaction", "pad-then-wrap", "%w(50,0,2)%<(15)%s|%b", REVS["conventional"])


def main() -> int:
    rows = []
    for group, name, fmt, rev, color in CASES:
        r = run_fmt(fmt, rev, color)
        rows.append({"group": group, "name": name, "format": fmt,
                     "rev": rev, "color": color, **r})
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "operators.json").write_text(json.dumps(rows, indent=2, ensure_ascii=False))

    errs = [r for r in rows if r["rc"] != 0]
    print(f"probed {len(rows)} compositional cases; errors={len(errs)}")
    for r in errs:
        print(f"  ERROR {r['name']}: {r['err']}")

    def show(group, limit=None):
        print(f"\n--- {group} ---")
        sel = [r for r in rows if r["group"] == group][:limit]
        for r in sel:
            print(f"  {r['name']:<34} {r['out']!r}")

    show("pad", 12)
    print("\n--- color tri-state (first 8) ---")
    for r in [x for x in rows if x["group"] == "color"][:8]:
        print(f"  {r['name']:<34} {r['out']!r}")
    show("interaction")
    print("\n--- wrap: w60,2,4 over verbose body (first 8 lines) ---")
    w = next(r for r in rows if r["name"] == "w60-2-4/verbose-body")
    for line in w["out"].splitlines()[:8]:
        print(f"  {line!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
