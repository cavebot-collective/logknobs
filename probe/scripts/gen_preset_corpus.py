#!/usr/bin/env python3
"""
Gate T13 evidence: every preset and every micro-template executed by real git on
the three topology repositories. A preset git rejects fails here, and the
simulator must reproduce git's bytes for every one (presets family of Oracle A).

Also: the options the v0.9.0 output panel adds that no earlier corpus covers --
--reverse, --date=relative / human, and the --graph/--reverse conflict.
"""
import itertools, json, subprocess, sys, pathlib

ROOT, REG, OUT = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3])
STYLES = ["terse", "conventional", "verbose"]


def run(style, args, cfg=()):
    p = subprocess.run(["git", "-C", str(ROOT / f"topo-{style}"), *cfg, "log", *args], capture_output=True)
    return {"style": style, "args": args, "config": list(cfg), "rc": p.returncode, "stdout_hex": p.stdout.hex(),
            "stderr": p.stderr.decode("utf-8", "replace")[:300]}


def main():
    reg = json.loads(REG.read_text())
    vecs = []
    for pr, style, color in itertools.product(reg["presets"], STYLES, ["always", "never"]):
        fmt = [f"--format=tformat:{pr['format']}"] if pr["format"] is not None else []
        args = [f"--color={color}", *pr["args"], *fmt]
        vecs.append({"family": "preset", "name": f"{pr['id']}/{style}/{color}", "preset": pr["id"], **run(style, args)})
    for ctl, mts in reg["micro_templates"].items():
        for m, style, color in itertools.product(mts, STYLES, ["always", "never"]):
            args = [f"--color={color}", "--all", f"--format=tformat:%C(auto)%h {m['token']}"]
            vecs.append({"family": "micro-template", "name": f"{ctl}/{m['id']}/{style}/{color}", **run(style, args)})
    for style, order, date in itertools.product(STYLES, [[], ["--topo-order"], ["--date-order"]], ["relative", "human", "short"]):
        args = ["--color=never", "--reverse", "--all", f"--date={date}", "--format=tformat:%h %ad %s", *order]
        vecs.append({"family": "reverse-date", "name": f"{style}/{'+'.join(order) or 'default'}/{date}", **run(style, args)})
    # the conflict the output panel enforces
    conflict = run("terse", ["--graph", "--reverse", "--format=%h"])
    OUT.write_text(json.dumps({"vectors": vecs, "conflict_graph_reverse": conflict}, indent=1))
    bad = [v for v in vecs if v["rc"]]
    print(f"preset corpus: {len(vecs)} vectors; failed invocations: {len(bad)}; "
          f"--graph --reverse rc={conflict['rc']} ({conflict['stderr'].strip()})")
    for v in bad[:8]: print("  FAILED", v["name"], v["stderr"])
    return 1 if bad or conflict["rc"] == 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
