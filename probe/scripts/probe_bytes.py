#!/usr/bin/env python3
"""Byte-exact probe of padding/truncation over multibyte text.

Text-mode capture corrupts evidence: the differential oracle compares *bytes*,
so the probe must too. This isolates the single highest-risk divergence between
git and a JavaScript reimplementation -- git pads by display column but
truncates by byte, so `trunc` can split a UTF-8 sequence.
"""
import json, subprocess, sys, pathlib
REPO = sys.argv[1]; OUT = pathlib.Path(sys.argv[2])

def oid(pat):
    out = subprocess.run(["git","-C",REPO,"log","--all","--format=%H %s"],
                         capture_output=True).stdout.decode("utf-8","replace")
    for line in out.splitlines():
        h,_,s = line.partition(" ")
        if pat in s: return h
    raise SystemExit(pat)

wide = oid("i18n")
cases = []
for spec in ["%<(20)","%<(20,trunc)","%<(20,ltrunc)","%<(20,mtrunc)",
             "%<(14,trunc)","%<(15,trunc)","%<(16,trunc)","%>(30)","%><(30)"]:
    cases.append((spec, spec+"%s|", wide))
cases.append(("subject-raw","%s",wide))

rows=[]
for name, fmt, rev in cases:
    p = subprocess.run(["git","-C",REPO,"log","-1","--color=never","--format="+fmt,rev],
                       capture_output=True)
    b = p.stdout
    if b.endswith(b"\n"): b = b[:-1]
    try:
        dec = b.decode("utf-8"); valid = True
    except UnicodeDecodeError as e:
        dec = b.decode("utf-8","replace"); valid = False
    rows.append({"name":name,"format":fmt,"hex":b.hex(),"bytes":len(b),
                 "valid_utf8":valid,"decoded":dec})
    print(f"{name:<16} bytes={len(b):<4} utf8={'OK ' if valid else 'INVALID'} {dec!r}")

OUT.mkdir(parents=True,exist_ok=True)
(OUT/"bytes.json").write_text(json.dumps(rows,indent=2,ensure_ascii=False))
