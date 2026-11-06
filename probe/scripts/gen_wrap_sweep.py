#!/usr/bin/env python3
"""
Wrap discrimination sweep.

The main corpus reflows ONE body text under varying (w,i1,i2). That cannot
discriminate between candidate explanations for the residual: it holds a single
CJK-adjacent newline. This sweep builds a throwaway repo whose commit bodies
vary one thing at a time, so that a rule inferred from the result is falsified
by the other bodies if it is wrong.

Variables isolated:
  - word after a source newline: narrow ASCII / wide CJK / narrow-then-wide /
    emoji / 1-column non-ASCII (e-acute) -- the last discriminates "non-ASCII"
    from "wide"
  - wide word before the newline, and mid-line, not at the boundary
  - words longer than the width, ASCII and CJK
  - exact-width hits
  - paragraph breaks
  - line beginning with a wide word, and a bare wide-word line
"""
from __future__ import annotations
import json, os, subprocess, sys, pathlib

DEST = sys.argv[1]
OUT = pathlib.Path(sys.argv[2])

BODIES = {
    "ascii-merge":        "aaa bbb ccc\nddd eee fff\n",
    "wide-after-nl":      "aaa bbb ccc\n日本語 eee\n",
    "narrow-then-wide":   "aaa bbb ccc\nx日本語 eee\n",
    "emoji-after-nl":     "aaa bbb ccc\n🌍 eee\n",
    "eacute-after-nl":    "aaa bbb ccc\né ccc ddd\n",
    "wide-later-in-line": "aaa bbb ccc\nddd 日本語\n",
    "wide-before-nl":     "aaa 日本語 ccc\nddd eee\n",
    "wide-mid-then-nl":   "aaa 日本 ccc ddd\neee\n",
    "overlong-ascii":     "aaa bbb\n" + "x" * 50 + "\n",
    "overlong-cjk":       "aaa bbb\n" + "日" * 30 + "\n",
    "long-single-line":   "aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll mmm nnn\n",
    "paragraph":          "aaa\n\nbbb\n",
    "exact-19-then-nl":   "aaaa bbbb cccc dddd\ne\n",
    "exact-20-then-nl":   "aaaa bbbb cccc ddddd\ne\n",
    "single-char-after":  "aaa bbb ccc ddd\nx\n",
    "line-starts-wide":   "日本語 aaa\nbbb ccc\n",
    "bare-wide-line":     "aaa\n日本語\n",
    "wide-then-narrow-nl": "aaa bbb\n日本語\nccc\n",
    "two-wide-lines":     "日本語 テキスト\n幅を数える\n",
    "trailing-space-src": "aaa bbb \nccc\n",
    # boundary of the "next character" rule: is it non-ASCII, or non-alnum?
    "punct-after-nl":     "aaa bbb ccc\n(ddd) eee\n",
    "digit-after-nl":     "aaa bbb ccc\n42 eee\n",
    "upper-after-nl":     "aaa bbb ccc\nDdd eee\n",
    "dash-after-nl":      "aaa bbb ccc\n- ddd eee\n",
    "hash-after-nl":      "aaa bbb ccc\n#412 eee\n",
    "lt-after-nl":        "aaa bbb ccc\n<x@y> eee\n",
    "space-after-nl":     "aaa bbb ccc\n ddd eee\n",
    "tab-after-nl":       "aaa bbb ccc\n\tddd eee\n",
    "nbsp-after-nl":      "aaa bbb ccc\n\u00a0ddd eee\n",
    "combining-after-nl": "aaa bbb ccc\ne\u0301 ccc\n",
}

WIDTHS = [20, 40]
INDENTS = [(0, 0), (2, 4)]


def sh(*a, **kw):
    return subprocess.run(a, capture_output=True, **kw)


def main() -> int:
    subprocess.run(["rm", "-rf", DEST]); os.makedirs(DEST)
    env = dict(os.environ, GIT_CONFIG_GLOBAL="/dev/null", GIT_CONFIG_SYSTEM="/dev/null",
               GIT_AUTHOR_NAME="A", GIT_AUTHOR_EMAIL="a@x", GIT_COMMITTER_NAME="C",
               GIT_COMMITTER_EMAIL="c@x", GIT_AUTHOR_DATE="1700000000 +0000",
               GIT_COMMITTER_DATE="1700000000 +0000")
    sh("git", "-C", DEST, "init", "-q", env=env)
    oids = {}
    for i, (name, body) in enumerate(BODIES.items()):
        pathlib.Path(DEST, f"{i}.txt").write_text("x")
        sh("git", "-C", DEST, "add", "-A", env=env)
        msg = f"subject {name}\n\n{body}"
        pathlib.Path("/tmp/wm").write_bytes(msg.encode("utf-8"))
        sh("git", "-C", DEST, "commit", "-q", "--file=/tmp/wm", "--cleanup=verbatim", env=env)
        oids[name] = sh("git", "-C", DEST, "rev-parse", "HEAD", env=env).stdout.decode().strip()

    vectors = []
    for name, body in BODIES.items():
        for w in WIDTHS:
            for i1, i2 in INDENTS:
                fmt = f"%w({w},{i1},{i2})%b"
                p = sh("git", "-C", DEST, "log", "-1", "--color=never",
                       f"--format={fmt}", oids[name], env=env)
                vectors.append({"name": f"{name}/w{w}/i{i1},{i2}", "body": body,
                                "w": w, "i1": i1, "i2": i2, "fmt": fmt,
                                "stdout_hex": p.stdout.hex(), "rc": p.returncode})
    OUT.write_text(json.dumps({"bodies": BODIES, "vectors": vectors}, indent=1,
                              ensure_ascii=False))
    bad = [v for v in vectors if v["rc"]]
    print(f"wrap sweep: {len(vectors)} vectors over {len(BODIES)} bodies; failed={len(bad)}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
