#!/usr/bin/env python3
"""
Held-out graph validation: seeded random DAGs the port has never seen.

The graph corpus was also the corpus the rev-walk fix was derived from, so a
score on it does not show the port generalizes. These repositories are built
from a seeded PRNG (deterministic per seed) and deliberately go where the
hand-built fixture does not: enough columns over the history to cycle through
all twelve default column colors (measured: up to 11 simultaneous columns, and
every seed reaches the bold range), octopus merges of three
to five parents, criss-cross merges, and merges of long-diverged branches.
Every commit touches its own file, so every merge -- octopus included -- is
conflict-free by construction.
"""
import json, os, random, subprocess, sys, pathlib, shutil

ROOT, OUT, SEEDS = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), [int(x) for x in sys.argv[3:]]
T0 = 1_710_000_000


def build(seed):
    rng = random.Random(seed)
    d = ROOT / f"rand-{seed}"
    if d.exists(): shutil.rmtree(d)
    d.mkdir(parents=True)
    env = dict(os.environ, GIT_CONFIG_GLOBAL="/dev/null", GIT_CONFIG_SYSTEM="/dev/null",
               GIT_AUTHOR_NAME="R", GIT_AUTHOR_EMAIL="r@x", GIT_COMMITTER_NAME="R", GIT_COMMITTER_EMAIL="r@x")
    t = [T0]
    def git(*a, check=True):
        t[0] += 60
        e = dict(env, GIT_AUTHOR_DATE=f"{t[0] - rng.randint(0, 600)} +0000", GIT_COMMITTER_DATE=f"{t[0]} +0000")
        return subprocess.run(["git", "-C", str(d), *a], env=e, capture_output=True, text=True, check=check)
    git("init", "-q", "-b", "b0"); git("config", "core.abbrev", "7")
    n = 0
    def commit(msg):
        nonlocal n; n += 1
        (d / f"f{n}").write_text(msg); git("add", f"f{n}"); git("commit", "-q", "-m", msg)
    commit("root")
    branches = ["b0"]
    for step in range(rng.randint(36, 52)):
        r = rng.random()
        if r < 0.22 and len(branches) < 16:
            src = rng.choice(branches); nb = f"b{len(branches)}"
            git("checkout", "-q", src)
            if rng.random() < 0.4: git("checkout", "-q", "HEAD~1", check=False)
            git("checkout", "-q", "-b", nb); branches.append(nb); commit(f"start {nb}")
        elif r < 0.42 and len(branches) > 1:
            into = rng.choice(branches); k = rng.choice([1, 1, 1, 2, 3, 4])
            others = rng.sample([b for b in branches if b != into], min(k, len(branches) - 1))
            git("checkout", "-q", into)
            git("merge", "-q", "--no-ff", "-m", f"merge {'+'.join(others)} into {into}", *others, check=False)
        else:
            b = rng.choice(branches); git("checkout", "-q", b); commit(f"work on {b} #{step}")
    if rng.random() < 0.5:
        git("checkout", "-q", "--orphan", "orphan"); git("rm", "-rqf", "."); commit("orphan root")
    git("checkout", "-q", "b0")
    return d


def main():
    vecs = []
    for seed in SEEDS:
        d = build(seed)
        subprocess.run(["python3", str(pathlib.Path(__file__).parent / "extract_records.py"), str(d),
                        str(OUT.parent / f"records-rand-{seed}.json")], capture_output=True, check=True)
        for fmt in ["tformat:%h %s", "tformat:%h%n%s", "format:%h %s", "tformat:%C(auto)%h%d"]:
            for color in ["never", "always"]:
                for walk in [["--all"], ["--all", "--date-order"], ["--all", "--first-parent"], []]:
                    args = ["--graph", f"--color={color}", f"--format={fmt}", *walk]
                    p = subprocess.run(["git", "-C", str(d), "log", *args], capture_output=True)
                    vecs.append({"family": "graph-heldout", "style": f"rand-{seed}", "args": args, "config": [],
                                 "name": f"rand-{seed}/{fmt}/{color}/{'+'.join(walk) or 'HEAD'}",
                                 "rc": p.returncode, "stdout_hex": p.stdout.hex()})
        n = len(subprocess.run(["git", "-C", str(d), "rev-list", "--all"], capture_output=True, text=True).stdout.split())
        maxw = max(len(l.split("*")[0]) for l in subprocess.run(["git", "-C", str(d), "log", "--graph", "--all", "--format=x%n"],
                                                                capture_output=True, text=True).stdout.splitlines() if "*" in l)
        print(f"  seed {seed}: {n} commits, widest commit row {maxw // 2 + 1} columns")
    OUT.write_text(json.dumps({"vectors": vecs}, indent=1))
    print(f"held-out graph corpus: {len(vecs)} vectors; failed invocations: {sum(v['rc'] != 0 for v in vecs)}")


if __name__ == "__main__":
    main()
