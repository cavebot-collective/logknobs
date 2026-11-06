#!/usr/bin/env python3
"""
Empirical probe of git's pretty-format placeholder language.

Rationale: the placeholder table is large, version-bound, and partially shared
with `git for-each-ref` (which has directives `git log` does NOT accept).
Reconstructing it from memory or from prose documentation risks importing
placeholders that do not exist in the target binary. This probe instead
*derives* the registry by execution, so every entry is evidence-backed and
carries the git version it was observed under.

Classification is total -- every candidate lands in exactly one class, and an
unrecognised outcome raises rather than falling into a catch-all:

  EXPANDS     rc == 0 and output differs from the literal token
              (includes placeholders that legitimately expand to empty)
  PASSTHROUGH rc == 0 and output is byte-identical to the literal token
              (git does not recognize it; emits it verbatim)
  ERROR       rc != 0 (git rejects the directive outright)
"""
from __future__ import annotations
import json, subprocess, sys, pathlib, collections

REPO = sys.argv[1] if len(sys.argv) > 1 else str(pathlib.Path(__file__).resolve().parents[2] / ".work/fixture")
OUT = pathlib.Path(sys.argv[2])   # required: never default onto delivered evidence

# Commits chosen so that every placeholder family has at least one commit on
# which it is meaningful. Placeholders are probed against all of them.
TARGETS = {
    "terse":        "3b69fe8c7f5b7190dbb6db47de4c2c4da7d1b910",
    "conventional": "c9e77e7fc50f6bb51bf8c72c3c27589bafa1c278",
    "verbose":      "2bd351db33f7b82f3ac16dd81f1d79b3fdf19541",
    "tagged":       "f34a4a38ac4c84e376771e4888e6c2c09456cd82",
    "merge_notes":  "HEAD",
}

CANDIDATES: list[tuple[str, str]] = []
def add(group: str, *toks: str) -> None:
    CANDIDATES.extend((group, t) for t in toks)

add("identity",   "%H", "%h", "%T", "%t", "%P", "%p")
add("author",     "%an", "%aN", "%ae", "%aE", "%al", "%aL",
                  "%ad", "%aD", "%ar", "%at", "%ai", "%aI", "%as", "%ah")
add("committer",  "%cn", "%cN", "%ce", "%cE", "%cl", "%cL",
                  "%cd", "%cD", "%cr", "%ct", "%ci", "%cI", "%cs", "%ch")
add("decoration", "%d", "%D", "%S", "%(decorate)",
                  "%(decorate:prefix=[,suffix=],separator=|,pointer=->,tag=#)")
add("message",    "%e", "%s", "%f", "%b", "%B", "%N")
add("signature",  "%GG", "%G?", "%GS", "%GK", "%GF", "%GP", "%GT")
add("reflog",     "%gD", "%gd", "%gn", "%gN", "%ge", "%gE", "%gs")
add("trailers",   "%(trailers)", "%(trailers:only)", "%(trailers:unfold)",
                  "%(trailers:keyonly)", "%(trailers:valueonly)",
                  "%(trailers:key=Signed-off-by)",
                  "%(trailers:key=Signed-off-by,valueonly)",
                  "%(trailers:separator=%x2C)",
                  "%(trailers:key_value_separator==)")
add("describe",   "%(describe)", "%(describe:tags)", "%(describe:abbrev=8)",
                  "%(describe:match=v*)", "%(describe:exclude=v0*)")
add("relation",   "%(ahead-behind:HEAD)")
add("color",      "%Cred", "%Cgreen", "%Cblue", "%Creset", "%C(bold)",
                  "%C(auto)", "%C(always,red)", "%C(auto,blue)", "%C(#ff8800)",
                  "%C(bold ul italic)", "%C(reverse)", "%C(strike)",
                  "%C(dim)", "%C(blink)", "%C(226)", "%C(normal)")
add("mark",       "%m")
add("escape",     "%n", "%%", "%x41", "%x0a")
add("wrap",       "%w(60,2,4)", "%w(0,0,0)", "%w(60)")
add("pad",        "%<(20)", "%<(20,trunc)", "%<(20,ltrunc)", "%<(20,mtrunc)",
                  "%>(20)", "%>>(20)", "%><(20)", "%<|(40)", "%>|(40)", "%><|(40)")
add("conditional", "%+s", "%-b", "% s", "%+b")
# Negative controls: believed to be for-each-ref directives or newer than 2.43.
add("negative-control", "%q", "%z", "%(if)", "%(then)", "%(else)", "%(end)",
                        "%(objectname)", "%(refname)", "%(upstream)",
                        "%(contents:subject)", "%(is-base:HEAD)", "%(HEAD)")


def run(args: list[str]) -> tuple[int, str, str]:
    p = subprocess.run(["git", "-C", REPO] + args,
                       capture_output=True, text=True, errors="surrogateescape")
    return p.returncode, p.stdout, p.stderr


def classify(token: str, rc: int, out: str, extra_args: list[str]) -> str:
    if rc != 0:
        return "ERROR"
    body = out[:-1] if out.endswith("\n") else out
    if body == token:
        return "PASSTHROUGH"
    return "EXPANDS"


def probe_token(group: str, token: str) -> dict:
    per_commit, classes = {}, set()
    extra = ["--walk-reflogs"] if group == "reflog" else []
    for name, rev in TARGETS.items():
        if extra:  # reflog walk cannot take an arbitrary rev
            args = ["log", "-1", "--walk-reflogs", "--format=" + token]
        else:
            args = ["log", "-1", "--format=" + token, rev]
        rc, out, err = run(args)
        cls = classify(token, rc, out, extra)
        classes.add(cls)
        per_commit[name] = {
            "class": cls,
            "stdout": out[:-1] if out.endswith("\n") else out,
            "stderr": err.strip()[:300],
        }
        if extra:
            break  # reflog result is not per-commit
    if classes == {"ERROR"}:
        overall = "ERROR"
    elif "EXPANDS" in classes:
        overall = "EXPANDS"
    elif classes == {"PASSTHROUGH"}:
        overall = "PASSTHROUGH"
    else:
        raise AssertionError(f"unclassifiable outcome for {token}: {classes}")
    return {"group": group, "token": token, "class": overall, "observations": per_commit}


def probe_named_formats() -> list[dict]:
    names = ["oneline", "short", "medium", "full", "fuller", "reference",
             "email", "mboxrd", "raw", "tformat:%h", "format:%h"]
    rows = []
    for n in names:
        rc, out, err = run(["log", "-1", "--pretty=" + n, "HEAD"])
        rows.append({"name": n, "class": "ACCEPTED" if rc == 0 else "ERROR",
                     "sample": out.rstrip("\n")[:400], "stderr": err.strip()[:200]})
    return rows


def probe_date_formats() -> list[dict]:
    names = ["default", "relative", "local", "iso", "iso-strict", "rfc", "short",
             "raw", "human", "unix", "iso-local", "iso-strict-local", "rfc-local",
             "default-local", "short-local", "format:%Y-%m-%d %H:%M",
             "format-local:%Y-%m-%dT%H", "auto:human"]
    rows = []
    for n in names:
        rc, out, err = run(["log", "-1", "--date=" + n, "--format=%ad", "HEAD"])
        rows.append({"name": n, "class": "ACCEPTED" if rc == 0 else "ERROR",
                     "sample": out.rstrip("\n"), "stderr": err.strip()[:200]})
    return rows


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    version = subprocess.run(["git", "--version"], capture_output=True,
                             text=True).stdout.strip()
    results = [probe_token(g, t) for g, t in CANDIDATES]
    registry = {
        "git_version": version,
        "fixture": REPO,
        "placeholders": results,
        "named_formats": probe_named_formats(),
        "date_formats": probe_date_formats(),
    }
    (OUT / "registry.json").write_text(json.dumps(registry, indent=2, ensure_ascii=False))

    tally = collections.Counter(r["class"] for r in results)
    print(f"{version}   probed {len(results)} placeholder candidates")
    print("  " + "  ".join(f"{k}={v}" for k, v in sorted(tally.items())))
    print("\nNON-EXPANDING (not part of git log's pretty language on this binary):")
    for r in results:
        if r["class"] != "EXPANDS":
            note = ""
            for obs in r["observations"].values():
                if obs["stderr"]:
                    note = " :: " + obs["stderr"].splitlines()[0]
                    break
            print(f"  {r['class']:<12} {r['token']:<34} [{r['group']}]{note}")
    bad = [f["name"] for f in registry["named_formats"] if f["class"] == "ERROR"]
    badd = [d["name"] for d in registry["date_formats"] if d["class"] == "ERROR"]
    print(f"\nnamed formats rejected: {bad or 'none'}")
    print(f"date formats rejected:  {badd or 'none'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
