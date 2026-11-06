#!/usr/bin/env python3
"""
Golden corpus for decoration RENDERING (v0.9.0: %d/%D/%(decorate) moved from
host-supplied to computed). The ref set and order on each commit stay host
input; this corpus judges everything the simulator now computes from it:

  placeholders  %d, %D, %C(auto)%d, %(decorate), %(decorate:<options>)
  options       prefix / suffix / separator / pointer / tag, hex-escaped
  names         --decorate=short / full
  colors        default slot colors, every color.decorate.<slot> override in
                use by the fixture (branch, remoteBranch, tag, HEAD), slot-name
                case (HEAD vs head), color.diff.commit for the punctuation
  built-ins     --oneline / medium with --decorate under the same overrides
"""
import itertools, json, subprocess, sys, pathlib

ROOT, OUT = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
TEMPLATES = {
    "d": "%h%d", "D": "%h [%D]", "auto-d": "%C(auto)%h%d", "auto-D": "%C(auto)%D",
    "deco": "%h%(decorate)", "auto-deco": "%C(auto)%(decorate)",
    "opts": "%C(auto)%(decorate:prefix=<,suffix=>,separator=%x7C,pointer=%x3D%x3E,tag=T:)",
    "opts-empty": "%C(auto)%(decorate:prefix=,suffix=,tag=)",
}
CONFIGS = {
    "default": [],
    "slots": ["-c", "color.decorate.branch=blue", "-c", "color.decorate.remoteBranch=magenta ul",
              "-c", "color.decorate.tag=reverse yellow", "-c", "color.decorate.HEAD=bold #ff8800"],
    "slot-case": ["-c", "color.decorate.head=red", "-c", "color.decorate.REMOTEBRANCH=green"],
    "commit-color": ["-c", "color.diff.commit=cyan bold"],
}


def run(style, cfg, args):
    p = subprocess.run(["git", "-C", str(ROOT / f"topo-{style}"), *cfg, "log", *args], capture_output=True)
    return {"style": style, "args": args, "config": cfg, "rc": p.returncode, "stdout_hex": p.stdout.hex(),
            "stderr": p.stderr.decode("utf-8", "replace")[:200]}


def main():
    vecs = []
    for (tn, tpl), (cn, cfg), deco, color in itertools.product(
            TEMPLATES.items(), CONFIGS.items(), ["short", "full"], ["never", "always"]):
        args = [f"--color={color}", f"--decorate={deco}", f"--format=tformat:{tpl}", "--all"]
        vecs.append({"family": "decoration", "name": f"{tn}/{cn}/{deco}/{color}", **run("terse", cfg, args)})
    for b, (cn, cfg), deco in itertools.product(["--oneline", "--pretty=medium"], CONFIGS.items(), ["short", "full"]):
        args = ["--color=always", b, f"--decorate={deco}", "--all"]
        vecs.append({"family": "decoration-builtin", "name": f"{b}/{cn}/{deco}", **run("conventional", cfg, args)})
    OUT.write_text(json.dumps({"vectors": vecs}, indent=1))
    bad = [v for v in vecs if v["rc"]]
    print(f"decoration corpus: {len(vecs)} vectors; failed invocations: {len(bad)}")
    for v in bad[:5]: print("  FAILED", v["name"], v["stderr"])
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
