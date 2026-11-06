#!/usr/bin/env python3
"""
Tokenization sweep: which characters after '%' git reads as one placeholder.
Written after the smartlog preset exposed "%ndate" being read as "%nd" + "ate".
Every letter after '%', followed by every letter (and '?'), on one commit of
each kind (merge, tagged, plain) -- under color so %C forms are exercised too.
"""
import json, string, subprocess, sys, pathlib
ROOT, OUT = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
letters = string.ascii_letters
vecs = []
for first in letters:
    fmts = [f"|%{first}{second}|" for second in letters + "?"]
    # one vector per first letter: all 53 continuations, newline-separated, so a
    # failure names the first letter and the diff names the continuation
    fmt = "%n".join(fmts)
    args = ["--color=always", "-3", f"--format=tformat:{fmt}"]
    p = subprocess.run(["git", "-C", str(ROOT / "topo-verbose"), "log", *args], capture_output=True)
    vecs.append({"family": "tokenize", "name": f"%{first}*", "style": "verbose", "args": args, "config": [],
                 "rc": p.returncode, "stdout_hex": p.stdout.hex()})
OUT.write_text(json.dumps({"vectors": vecs}, indent=1))
print(f"token sweep: {len(vecs)} vectors x 53 continuations; failed invocations: {sum(v['rc'] != 0 for v in vecs)}")

# %S under every walk: the ref a commit was reached by is walk-dependent, so the
# simulator computes it (sim/walk.mjs); this family judges that computation.
for style in ["terse", "conventional", "verbose"]:
    for walk in [["--all"], ["--all", "--date-order"], ["--all", "--first-parent"], ["--all", "--graph"], []]:
        args = ["--color=never", "--format=tformat:%h %S", *walk]
        p = subprocess.run(["git", "-C", str(ROOT / f"topo-{style}"), "log", *args], capture_output=True)
        vecs.append({"family": "ref-source", "name": f"{style}/{'+'.join(walk) or 'HEAD'}", "style": style,
                     "args": args, "config": [], "rc": p.returncode, "stdout_hex": p.stdout.hex()})
OUT.write_text(json.dumps({"vectors": vecs}, indent=1))
print(f"  + ref-source family: 15 vectors")
