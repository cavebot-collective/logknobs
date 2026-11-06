#!/usr/bin/env python3
"""
Deterministic topology fixtures for the --graph corpus.

One DAG, three message styles (terse / conventional / verbose). The shape is
chosen so that every state of git's graph.c state machine is reached:

    A ── B ── C ─────── M1 ── D ────────── M2 ── E          main (HEAD)
          \\    \\  \\     /  \\                /|\\
           a1 ──┼──┼─ a2     \\              / | \\           feature/a
                b1 ─┼── b2 ── b3 ──────────'  |  \\          feature/b  (b3 merges M1 back in)
                   c1 ──────── c2 ───────────'   \\          feature/c
                               h1 ───────────────'          hotfix (from M1)
                                     w1                     feature/wip (from D, unmerged)
    g1 ── g2                                                gh-pages (second root)

  - M1 is a two-parent merge, M2 a four-parent octopus (pre-commit expansion
    rows and the "*-." dashes)
  - b3 merges main INTO feature/b, so branch lines cross (collapsing, '_')
  - gh-pages is an orphan: a second root under --all
  - tags v1.0 (annotated, on M1) and v2.0 (lightweight, on M2), and
    refs/remotes/origin/main on M2, exercise every decoration slot in use

Committer dates strictly increase in creation order, so no ordering depends on
a tie-break. Author dates are skewed against committer dates for c1 and h1, so
--author-date-order and --date-order produce different orders.
"""
from __future__ import annotations
import os, subprocess, sys, pathlib, shutil

DEST = pathlib.Path(sys.argv[1]); STYLE = sys.argv[2]
assert STYLE in ("terse", "conventional", "verbose")
T0 = 1_700_000_000
AUTHORS = {"ada": ("Ada Lovelace", "ada@example.org"), "alan": ("Alan Turing", "alan@example.org"),
           "grace": ("Grace Hopper", "grace@example.org")}

# role -> (terse, conventional, verbose subject, verbose body)
MSG = {
 "A":  ("init", "chore: initialize repository", "chore: initialize the repository with a README and license",
        "Start from an empty tree so later history has a clean root.\n"),
 "B":  ("add core", "feat(core): add the evaluation loop", "feat(core): add the evaluation loop over parsed templates",
        "The loop walks the token list once per commit and writes into a\nsingle buffer, so rendering cost is linear in template length.\n"),
 "a1": ("parser wip", "feat(parser): tokenize format strings", "feat(parser): tokenize format strings into a typed node list",
        "Literals, value placeholders and operators become distinct node\nkinds, because operators modify the rendering of what follows them.\n\nRefs: #12\n"),
 "C":  ("fix crash", "fix(core): guard against an empty template", "fix(core): guard against an empty template reaching the evaluator",
        "An empty --format previously reached the loop with no nodes and\nwrote a stray terminator.\n\nFixes: #19\nSigned-off-by: Grace Hopper <grace@example.org>\n"),
 "a2": ("parser done", "feat(parser): support nested option lists", "feat(parser): support nested option lists inside %(...) forms",
        "Option values may themselves contain commas when hex-escaped, so\nthe splitter honors %x2C rather than splitting on every comma.\n"),
 "b1": ("colors", "feat(color): parse color specs", "feat(color): parse color specifications into SGR sequences",
        "Foreground first, background second; attributes form a set emitted\nin ascending order regardless of how they were written.\n"),
 "c1": ("docs", "docs: describe padding semantics", "docs: describe padding and truncation semantics for wide glyphs",
        "Right truncation admits the straddling character; left truncation\ndoes not. The asymmetry is deliberate and documented here.\n"),
 "M1": ("merge a", "merge: feature/a into main", "merge: bring the parser work from feature/a into main",
        "The parser is complete enough to replace the prototype tokenizer.\n"),
 "b2": ("bg colors", "feat(color): support background colors", "feat(color): support background colors and 24-bit values",
        "The second color in a spec is the background. Short hex is rejected\nbecause the pinned git binary rejects it.\n"),
 "c2": ("more docs", "docs: add a wrapping section", "docs: add a section on wrapping and soft line breaks",
        "A source newline is soft only before an ASCII alphanumeric; every\nother character forces a hard break.\n\nReviewed-by: Alan Turing <alan@example.org>\n"),
 "h1": ("hotfix", "fix: correct the abbrev default", "fix: correct the default abbreviation length in the exporter",
        "The exporter assumed seven characters; the fixture pins core.abbrev,\nbut real repositories grow past it.\n\nFixes: #31\n"),
 "b3": ("sync main", "merge: main into feature/b", "merge: update feature/b with the parser from main",
        "Color parsing needs the typed node list that landed on main.\n"),
 "D":  ("tidy", "refactor(core): extract the renderer", "refactor(core): extract the renderer from the evaluation loop",
        "Rendering and evaluation were interleaved, which made spans hard to\nattribute. They are now separate passes over the same nodes.\n"),
 "M2": ("release", "merge: release 2.0", "merge: integrate color, docs and the hotfix for release 2.0",
        "Octopus merge of three ready branches. None of them touch the same\nfiles, so no resolution was needed.\n\nSigned-off-by: Ada Lovelace <ada@example.org>\n"),
 "E":  ("bump", "chore(release): bump version to 2.0.0", "chore(release): bump the version to 2.0.0 and update the changelog",
        "Changelog entries are generated from conventional commit subjects.\n"),
 "w1": ("wip", "feat(graph): sketch the column model", "feat(graph): sketch the column model for graph rendering",
        "Unfinished. Columns map to commits; mapping tracks where each\nedge is heading on the next row.\n"),
 "g1": ("pages", "docs(site): start the project site", "docs(site): start the project site on an orphan branch",
        "The site shares no history with the code.\n"),
 "g2": ("pages 2", "docs(site): add the gallery page", "docs(site): add a gallery page of example formats",
        "Each example links to the template that produced it.\n"),
}
# (role, author, committer-seconds offset, author-seconds offset)
# Author skews: c1 and h1 are authored before commits they follow in commit order.
SCHEDULE = {"A": ("ada", 0, 0), "B": ("ada", 3600, 3600), "a1": ("alan", 7200, 7200),
            "C": ("grace", 10800, 10800), "a2": ("alan", 14400, 14400), "b1": ("ada", 18000, 18000),
            "c1": ("grace", 21600, 9000), "M1": ("ada", 25200, 25200), "b2": ("ada", 28800, 28800),
            "c2": ("grace", 32400, 32400), "h1": ("alan", 36000, 12000), "b3": ("ada", 39600, 39600),
            "D": ("grace", 43200, 43200), "M2": ("ada", 46800, 46800), "E": ("ada", 50400, 50400),
            "w1": ("alan", 54000, 54000), "g1": ("grace", 57600, 57600), "g2": ("grace", 61200, 61200)}


def message(role):
    t, c, vs, vb = MSG[role]
    return {"terse": t + "\n", "conventional": c + "\n", "verbose": f"{vs}\n\n{vb}"}[STYLE]


def git(*args, role=None, check=True):
    env = dict(os.environ, GIT_CONFIG_GLOBAL="/dev/null", GIT_CONFIG_SYSTEM="/dev/null")
    if role:
        who, c_off, a_off = SCHEDULE[role]
        an, ae = AUTHORS[who]
        env.update(GIT_AUTHOR_NAME=an, GIT_AUTHOR_EMAIL=ae, GIT_COMMITTER_NAME="Grace Hopper",
                   GIT_COMMITTER_EMAIL="grace@example.org",
                   GIT_AUTHOR_DATE=f"{T0 + a_off} +0000", GIT_COMMITTER_DATE=f"{T0 + c_off} +0000")
    return subprocess.run(["git", "-C", str(DEST), *args], env=env, capture_output=True, text=True, check=check)


def commit(role, path):
    (DEST / path).parent.mkdir(parents=True, exist_ok=True)
    # newline="": byte-identical files on every platform (Windows text mode
    # would write CRLF and change every blob and commit id)
    with open(DEST / path, "a", newline="") as f: f.write(role + "\n")
    git("add", path)
    (DEST / ".msg").write_bytes(message(role).encode("utf-8"))
    git("commit", "-q", "--file=.msg", "--cleanup=verbatim", role=role)


def merge(role, *branches):
    (DEST / ".msg").write_bytes(message(role).encode("utf-8"))
    git("merge", "-q", "--no-ff", "--file=.msg", "--cleanup=verbatim", *branches, role=role)


def main():
    if DEST.exists(): shutil.rmtree(DEST)
    DEST.mkdir(parents=True)
    git("init", "-q", "-b", "main")
    for k, v in (("core.abbrev", "7"), ("gc.auto", "0"), ("user.name", "Grace Hopper"),
                 ("user.email", "grace@example.org"), ("merge.ff", "false")):
        git("config", k, v)
    (DEST / ".git" / "info" / "exclude").write_text(".msg\n")
    commit("A", "README"); commit("B", "core/loop")
    git("branch", "feature/a"); git("checkout", "-q", "feature/a"); commit("a1", "parser/tok")
    git("checkout", "-q", "main"); commit("C", "core/guard")
    git("checkout", "-q", "feature/a"); commit("a2", "parser/opts")
    git("checkout", "-q", "main")
    git("branch", "feature/b"); git("branch", "feature/c")
    git("checkout", "-q", "feature/b"); commit("b1", "color/parse")
    git("checkout", "-q", "feature/c"); commit("c1", "docs/padding")
    git("checkout", "-q", "main"); merge("M1", "feature/a")
    git("tag", "-a", "v1.0", "-m", "release 1.0", role="M1")
    git("checkout", "-q", "feature/b"); commit("b2", "color/bg")
    git("checkout", "-q", "feature/c"); commit("c2", "docs/wrapping")
    git("checkout", "-q", "-b", "hotfix", "main"); commit("h1", "export/abbrev")
    git("checkout", "-q", "feature/b"); merge("b3", "main")
    git("checkout", "-q", "main"); commit("D", "core/render")
    merge("M2", "feature/b", "feature/c", "hotfix")
    git("tag", "v2.0")
    git("update-ref", "refs/remotes/origin/main", "HEAD")
    commit("E", "VERSION")
    git("checkout", "-q", "-b", "feature/wip", "main~1"); commit("w1", "graph/columns")
    git("checkout", "-q", "--orphan", "gh-pages"); git("rm", "-rqf", "."); commit("g1", "site/index")
    commit("g2", "site/gallery")
    git("checkout", "-q", "main")
    roles = {}
    for line in git("log", "--all", "--format=%H %s").stdout.splitlines():
        h, _, subj = line.partition(" ")
        roles[h] = next(r for r in MSG if message(r).split("\n")[0] == subj)
    (DEST / ".git" / "roles.txt").write_text("".join(f"{h} {r}\n" for h, r in roles.items()))
    print(f"{STYLE}: {len(roles)} commits")
    print(git("log", "--graph", "--all", "--format=%h %s", "--color=never").stdout)


if __name__ == "__main__":
    main()
