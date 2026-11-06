#!/usr/bin/env python3
"""Derive display width per codepoint FROM GIT, for every non-ASCII character
that appears in any corpus. The simulator's width table is then checked against
this, so a table gap surfaces as a named codepoint rather than as a mysterious
truncation failure two layers up."""
import json, os, subprocess, sys, pathlib, unicodedata
EV = pathlib.Path(sys.argv[1]); DEST = sys.argv[2]
cps = set()
for f in ["corpus.json","wrap-sweep.json","trunc-sweep.json"]:
    d = json.loads((EV/f).read_text())
    for v in d["vectors"]:
        s = bytes.fromhex(v["stdout_hex"]).decode("utf-8","replace")
        cps.update(ord(c) for c in s if ord(c) > 0x7f)
    for s in list(d.get("bodies",{}).values())+list(d.get("subjects",{}).values()):
        cps.update(ord(c) for c in s if ord(c) > 0x7f)
cps = sorted(cps)
sh = lambda *a, **k: subprocess.run(a, capture_output=True, **k)
subprocess.run(["rm","-rf",DEST]); os.makedirs(DEST)
env = dict(os.environ, GIT_CONFIG_GLOBAL="/dev/null", GIT_CONFIG_SYSTEM="/dev/null",
           GIT_AUTHOR_NAME="A", GIT_AUTHOR_EMAIL="a@x", GIT_COMMITTER_NAME="C",
           GIT_COMMITTER_EMAIL="c@x", GIT_AUTHOR_DATE="1700000000 +0000", GIT_COMMITTER_DATE="1700000000 +0000")
sh("git","-C",DEST,"init","-q",env=env)
widths = {}
for cp in cps:
    ch = chr(cp)
    pathlib.Path(DEST,"f").write_text(str(cp)); sh("git","-C",DEST,"add","-A",env=env)
    pathlib.Path("/tmp/wm").write_bytes((ch+"\n").encode()); sh("git","-C",DEST,"commit","-q","--file=/tmp/wm","--cleanup=verbatim",env=env)
    # pad to 10 columns; the number of trailing spaces reveals git's width
    out = sh("git","-C",DEST,"log","-1","--color=never","--format=%<(10)%s|",env=env).stdout.decode("utf-8")
    body = out.rstrip("\n").rstrip("|")
    spaces = len(body) - len(body.rstrip(" "))
    widths[f"U+{cp:04X}"] = {"char": ch, "git_width": 10 - spaces,
                             "eaw": unicodedata.east_asian_width(ch), "name": unicodedata.name(ch, "?")}
(EV/"widths.json").write_text(json.dumps(widths, indent=1, ensure_ascii=False))
print(f"probed {len(widths)} codepoints against git")
for k,v in widths.items():
    if v["git_width"] != (2 if v["eaw"] in ("W","F") else (0 if unicodedata.combining(v["char"]) else 1)):
        print(f"  NOTE {k} {v['char']!r} git={v['git_width']} eaw={v['eaw']} {v['name']}")
