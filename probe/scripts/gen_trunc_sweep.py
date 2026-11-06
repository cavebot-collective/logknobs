#!/usr/bin/env python3
"""Held-out truncation sweep. The trunc/ltrunc/mtrunc rules were derived on
ONE CJK subject; this sweeps them over subjects they never saw. Any failure
here means the derived rule was overfit to the fixture, not git's rule."""
import json, os, subprocess, sys, pathlib
DEST, OUT = sys.argv[1], pathlib.Path(sys.argv[2])
SUBJECTS = {
    "ascii":        "the quick brown fox jumps over the lazy dog again",
    "cjk-only":     "日本語の文章を正しく切り詰める処理を検証する",
    "cjk-leading":  "日本語 then ascii tail here for testing",
    "emoji-dense":  "🌍🌎🌏 planet 🚀 rocket 🎉 party 🐍 snake 🦀 crab",
    "eacute":       "café résumé naïve façade coöperate déjà vu",
    "korean":       "한국어 문자열을 자르는 규칙을 확인합니다",
    "mixed-alt":    "a日b本c語d文e章f正g確h切i詰j",
    "hangul-emoji": "안녕 🌍 세계 🚀 테스트",
}
sh = lambda *a, **k: subprocess.run(a, capture_output=True, **k)
subprocess.run(["rm","-rf",DEST]); os.makedirs(DEST)
env = dict(os.environ, GIT_CONFIG_GLOBAL="/dev/null", GIT_CONFIG_SYSTEM="/dev/null",
           GIT_AUTHOR_NAME="A", GIT_AUTHOR_EMAIL="a@x", GIT_COMMITTER_NAME="C",
           GIT_COMMITTER_EMAIL="c@x", GIT_AUTHOR_DATE="1700000000 +0000",
           GIT_COMMITTER_DATE="1700000000 +0000")
sh("git","-C",DEST,"init","-q",env=env)
oids = {}
for i,(n,subj) in enumerate(SUBJECTS.items()):
    pathlib.Path(DEST,f"{i}.txt").write_text("x"); sh("git","-C",DEST,"add","-A",env=env)
    pathlib.Path("/tmp/tm").write_bytes((subj+"\n").encode()); sh("git","-C",DEST,"commit","-q","--file=/tmp/tm","--cleanup=verbatim",env=env)
    oids[n] = sh("git","-C",DEST,"rev-parse","HEAD",env=env).stdout.decode().strip()
vec = []
for n,subj in SUBJECTS.items():
    for mode in ["trunc","ltrunc","mtrunc"]:
        for N in range(1,41):
            fmt = f"%<({N},{mode})%s|"
            p = sh("git","-C",DEST,"log","-1","--color=never",f"--format={fmt}",oids[n],env=env)
            vec.append({"name":f"{mode}/{n}/N{N}","subject":subj,"fmt":fmt,"stdout_hex":p.stdout.hex(),"rc":p.returncode})
OUT.write_text(json.dumps({"subjects":SUBJECTS,"vectors":vec},indent=1,ensure_ascii=False))
print(f"trunc sweep: {len(vec)} vectors over {len(SUBJECTS)} held-out subjects; failed={sum(v['rc']!=0 for v in vec)}")
