#!/usr/bin/env python3
"""
Color-grammar sweep for %C(...) on the pinned git binary.

The v0.8.0 simulator ignored the background color, negated attributes, and
'normal'/'default' -- and had no notion of an invalid spec, although git
treats one as fatal for the whole --format. This sweep pins the grammar by
execution. Each vector records rc and stderr as well as stdout, because for an
invalid spec the observable behavior IS the failure.

Families:
  single     every foreground form alone
  pair       foreground + background, including normal/default in both slots
  attrs      every attribute, alone and negated (both spellings)
  order      attribute permutations -- does source order survive?
  mixed      attributes + colors in varied positions
  mode       auto/always prefixes under --color=always and --color=never
  invalid    specs git must reject
"""
from __future__ import annotations
import itertools, json, subprocess, sys, pathlib

REPO, OUT = sys.argv[1], pathlib.Path(sys.argv[2])
NAMES = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"]
ATTRS = ["bold", "dim", "italic", "ul", "blink", "reverse", "strike"]

cases: list[tuple[str, str, str]] = []          # (family, spec, color-mode)
def add(fam, spec, mode="always"): cases.append((fam, spec, mode))

for c in NAMES + ["bright" + n for n in NAMES] + ["default", "normal", "0", "7", "8", "15",
                                                  "16", "100", "226", "255", "#000000",
                                                  "#ff8800", "#FFFFFF", "#0a0B0c"]:
    add("single", c)
for fg, bg in itertools.product(["red", "brightred", "default", "normal", "226", "#ff8800"],
                                 ["blue", "brightblue", "default", "normal", "17", "#001122"]):
    add("pair", f"{fg} {bg}")
for a in ATTRS:
    add("attrs", a); add("attrs", "no" + a); add("attrs", "no-" + a)
for perm in itertools.permutations(["bold", "ul", "italic"]):
    add("order", " ".join(perm))
for perm in itertools.permutations(["red", "bold", "blue"]):
    add("order", " ".join(perm))
for spec in ["bold nobold", "nobold bold", "noul ul", "ul noul", "dim nodim italic",
             "red bold blue ul", "bold red", "red bold", "reverse brightyellow brightblack",
             "nobold red", "red nobold", "strike #ff0000 #0000ff", "normal normal",
             "default default", "blink normal blue", "bold bold", "red red"]:
    add("mixed", spec)
for spec in ["auto", "always,red", "auto,red", "always,bold red ul", "auto,bold", "always"]:
    for mode in ("always", "never"):
        add("mode", spec, mode)
for spec in ["#f80", "#ff880", "#gg0000", "red blue green", "256", "-1", "brightorange",
             "purple", "boldred", "no bold", "nono", "#ff8800 #001122 #333333", "red,blue",
             "always"]:
    # Validity depends on the color mode: git does not parse a spec it is not
    # going to emit. Every invalid case is therefore probed under both modes.
    add("invalid", spec, "always"); add("invalid", spec, "never")
# The derived rule: a spec is parsed (and so validated) exactly when it will be
# emitted -- under --color=always, or when it carries the always, prefix.
for spec in ["always,purple", "auto,purple", "always,#f80", "auto,#f80"]:
    add("invalid", spec, "always"); add("invalid", spec, "never")


# Whole-format cases: the dispatch rules for %C live in the format parser, not
# in the color grammar, so these probe raw formats rather than one spec.
RAW: list[tuple[str, str, str]] = []
for fmt in ["%Creddish|", "%Cgreenery|", "%Cbluex|", "%Cresetx|", "%Cyellow|", "%Cmagenta|",
            "%CRED|", "%C|", "%Cred%Cgreen|",
            "a%C(auto)%h|", "%C(auto)%h|", "a%C(auto)b|", "%C(auto)%C(auto)%h|",
            "%h%C(auto)%h|", "a%C(auto,red)b|", "%C(always,)x|", "%C()x|", "%C(reset)x|",
            "%C(RED)x|", "%C(Bold Red)x|", "%C(BRIGHTBLUE)x|", "%C(#FF8800)x|", "%C(NoBold)x|"]:
    for mode in ("always", "never"):
        RAW.append(("raw", fmt, mode))


def run(spec: str, mode: str, raw: bool = False) -> dict:
    fmt = spec if raw else f"%C({spec})X%Creset|"
    p = subprocess.run(["git", "-C", REPO, "log", "-1", f"--color={mode}", f"--format={fmt}", "HEAD"],
                       capture_output=True)
    return {"rc": p.returncode, "stdout_hex": p.stdout.hex(),
            "stderr": p.stderr.decode("utf-8", "replace").strip()[:200], "format": fmt}


def main() -> int:
    vecs = []
    for fam, spec, mode in cases:
        r = run(spec, mode)
        vecs.append({"family": fam, "spec": spec, "color": mode, **r})
    for fam, fmt, mode in RAW:
        r = run(fmt, mode, raw=True)
        vecs.append({"family": fam, "spec": fmt, "color": mode, **r})
    # Record WHICH commit the sweep ran against. The runner previously guessed
    # "the notes commit" because it lists first under --all -- but notes live
    # on refs/notes/commits, not HEAD.
    head = subprocess.run(["git", "-C", REPO, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    OUT.write_text(json.dumps({"rev": head, "vectors": vecs}, indent=1))
    ok = sum(v["rc"] == 0 for v in vecs); bad = len(vecs) - ok
    print(f"color sweep: {len(vecs)} vectors ({ok} accepted, {bad} rejected by git)")
    for v in vecs:
        if v["family"] == "invalid" and v["rc"] == 0:
            print(f"  NOTE expected-invalid but ACCEPTED: {v['spec']!r} -> "
                  f"{bytes.fromhex(v['stdout_hex'])!r}")
        if v["family"] != "invalid" and v["rc"] != 0:
            print(f"  NOTE expected-valid but REJECTED: {v['spec']!r}: {v['stderr']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
