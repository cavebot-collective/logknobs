#!/usr/bin/env python3
"""
Golden corpus for --graph and multi-commit history.

The graph port is judged by this corpus and nothing else, as truncation and
wrapping were. It sweeps the axes that change what graph.c does:

  templates   one line, two lines, a variable line count (%b), an entry that
              ends in a newline (which triggers padding before the terminator),
              padding, and %C(auto) decoration
  terminator  tformat: (terminator) and format: (separator)
  walk        --all / HEAD-only, topo (implied by --graph), --date-order,
              --author-date-order, --first-parent
  color       never / always, and a custom log.graphColors
  built-ins   --oneline, default medium, short, with --decorate

Plus the same templates WITHOUT --graph across the order modes, because the
history preview has to order commits correctly with the graph off too.
"""
from __future__ import annotations
import itertools, json, subprocess, sys, pathlib

ROOT, OUT = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
STYLES = ["terse", "conventional", "verbose"]
TEMPLATES = {
    "one":      "%h %s",
    "two":      "%h%n%s",
    "body":     "%h %s%n%b",
    "nl-end":   "%h %s%n",
    "pad":      "%<(12,trunc)%s|%h",
    "auto-dec": "%C(auto)%h%d %s",
}
WALKS = {
    "all":         ["--all"],
    "head":        [],
    "all-date":    ["--all", "--date-order"],
    "all-author":  ["--all", "--author-date-order"],
    "all-first":   ["--all", "--first-parent"],
}


def run(style: str, args: list[str], cfg: list[str] = ()) -> dict:
    cmd = ["git", "-C", str(ROOT / f"topo-{style}"), *cfg, "log", *args]
    p = subprocess.run(cmd, capture_output=True)
    return {"style": style, "args": args, "config": list(cfg), "rc": p.returncode,
            "stdout_hex": p.stdout.hex(), "stderr": p.stderr.decode("utf-8", "replace")[:200]}


def main() -> int:
    vecs = []
    for style, (tn, tpl), (wn, walk), term, color in itertools.product(
            STYLES, TEMPLATES.items(), WALKS.items(), ["tformat", "format"], ["never", "always"]):
        if tn == "auto-dec" and color == "never":
            continue  # identical to a plain template under never; keep the corpus lean
        args = ["--graph", f"--color={color}", f"--format={term}:{tpl}", *walk]
        vecs.append({"family": "graph", "name": f"{style}/{tn}/{wn}/{term}/{color}", **run(style, args)})
    # custom column colors
    for style in STYLES:
        for gc in ["blue,red", "bold magenta, 208, #00ff00", "cyan"]:
            args = ["--graph", "--color=always", "--format=tformat:%h %s", "--all"]
            vecs.append({"family": "graph-colors", "name": f"{style}/{gc}",
                         **run(style, args, ["-c", f"log.graphColors={gc}"])})
    # Built-ins under --graph, now also under color (the v0.8.0 built-in family
    # ran --color=never only, which hid a header-coloring defect), plus the
    # --oneline shorthand, which is --pretty=oneline --abbrev-commit.
    for style, b, deco, color in itertools.product(STYLES, ["--pretty=oneline", "--oneline", "--pretty=medium",
                                                            "--pretty=short", "--abbrev-commit"],
                                                   ["no", "short", "full"], ["never", "always"]):
        args = ["--graph", f"--color={color}", b, f"--decorate={deco}", "--all"]
        vecs.append({"family": "graph-builtin", "name": f"{style}/{b}/decorate={deco}/{color}", **run(style, args)})
    # history without --graph: order modes
    for style, (tn, tpl), order in itertools.product(
            STYLES, [("one", "%h %s")], [[], ["--topo-order"], ["--date-order"], ["--author-date-order"],
                                         ["--first-parent"]]):
        args = ["--color=never", f"--format=tformat:{tpl}", "--all", *order]
        vecs.append({"family": "history", "name": f"{style}/{'+'.join(order) or 'default'}", **run(style, args)})
    OUT.write_text(json.dumps({"vectors": vecs}, indent=1))
    bad = [v for v in vecs if v["rc"]]
    from collections import Counter
    print(f"graph corpus: {len(vecs)} vectors, {sum(len(bytes.fromhex(v['stdout_hex'])) for v in vecs)} bytes; "
          f"failed invocations: {len(bad)}")
    for k, n in sorted(Counter(v["family"] for v in vecs).items()): print(f"  {k:<14} {n}")
    for v in bad[:5]: print("  FAILED", v["name"], v["stderr"])
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
