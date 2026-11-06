#!/usr/bin/env python3
"""
Extract commit records for the simulator.

Records are parsed from raw commit objects via `git cat-file`, deliberately NOT
via `git log --format=...`. Using the format language to build the input for a
differential test of the format language would make the oracle circular: a
shared misunderstanding of, say, author-line parsing would cancel out and the
test would pass green while both sides were wrong.

Some fields genuinely cannot be derived from the commit object alone --
decoration depends on the ref graph, notes on the notes tree, signature status
on a keyring, relative dates on the wall clock. Those are marked host_supplied
and reported separately by Oracle A, because a vector that only exercises a
host-supplied field tests placement, not computation, and counting it as engine
coverage would overstate what has been verified.
"""
from __future__ import annotations
import json, os, re, subprocess, sys, pathlib

REPO = sys.argv[1]
OUT = pathlib.Path(sys.argv[2])
ENV = dict(os.environ, GNUPGHOME=REPO.rstrip("/") + "-gnupg")

HOST_SUPPLIED = ["decoration_short", "decoration_full", "describe", "notes",
                 "sig_status", "sig_signer", "sig_key", "sig_fingerprint",
                 "sig_primary_fingerprint", "sig_trust", "sig_raw",
                 "date_relative_author", "date_relative_committer",
                 "date_human_author", "date_human_committer", "ref_name"]


def git(*args, binary=False):
    p = subprocess.run(["git", "-C", REPO, *args], capture_output=True, env=ENV)
    if p.returncode != 0:
        return None
    return p.stdout if binary else p.stdout.decode("utf-8", "surrogateescape")


IDENT = re.compile(r"^(?P<name>.*?) <(?P<email>[^>]*)> (?P<ts>\d+) (?P<tz>[+-]\d{4})$")


def parse_ident(line: str) -> dict:
    m = IDENT.match(line)
    if not m:
        raise ValueError(f"unparseable identity line: {line!r}")
    return {"name": m["name"], "email": m["email"],
            "ts": int(m["ts"]), "tz": m["tz"]}


def parse_commit(oid: str) -> dict:
    raw = git("cat-file", "commit", oid, binary=True).decode("utf-8", "surrogateescape")
    head, _, message = raw.partition("\n\n")
    rec = {"H": oid, "P": [], "encoding": "", "signed": False}
    lines, i = head.split("\n"), 0
    while i < len(lines):
        line = lines[i]
        if line.startswith(" "):          # continuation of a folded header
            i += 1
            continue
        key, _, val = line.partition(" ")
        if key == "tree":
            rec["T"] = val
        elif key == "parent":
            rec["P"].append(val)
        elif key == "author":
            rec["author"] = parse_ident(val)
        elif key == "committer":
            rec["committer"] = parse_ident(val)
        elif key == "encoding":
            rec["encoding"] = val
        elif key == "gpgsig":
            rec["signed"] = True
            # raw header value, folded continuation lines included -- --pretty=raw
            # emits it verbatim
            sig = [val]
            while i + 1 < len(lines) and lines[i + 1].startswith(" "):
                i += 1; sig.append(lines[i])
            rec["gpgsig"] = "\n".join(sig)
        i += 1
    rec["message"] = message
    return rec


def abbrev(oid: str, n: int) -> str:
    return oid[:n]


def main() -> int:
    oids = git("rev-list", "--all").split()
    core_abbrev = int((git("config", "core.abbrev") or "7").strip())

    # Host-supplied fields, fetched once per commit. These use the format
    # language, which is acceptable only because Oracle A reports vectors that
    # depend on them separately rather than as engine coverage.
    def hostfield(oid, fmt):
        out = git("log", "-1", "--color=never", f"--format={fmt}", oid)
        return (out or "").rstrip("\n")

    records = {}
    for oid in oids:
        rec = parse_commit(oid)
        rec["abbrev"] = core_abbrev
        rec["h"] = abbrev(oid, core_abbrev)
        rec["t"] = abbrev(rec["T"], core_abbrev)
        rec["p"] = [abbrev(x, core_abbrev) for x in rec["P"]]
        rec["host"] = {
            "decoration_short": hostfield(oid, "%d"),
            "decoration_bare": hostfield(oid, "%D"),
            "decoration_full_bare": (git("log", "-1", "--color=never", "--decorate=full",
                                          "--format=%D", oid) or "").rstrip("\n"),
            "describe": hostfield(oid, "%(describe)"),
            "describe_tags": hostfield(oid, "%(describe:tags)"),
            "describe_abbrev8": hostfield(oid, "%(describe:abbrev=8)"),
            "describe_match": hostfield(oid, "%(describe:match=v*)"),
            "describe_exclude": hostfield(oid, "%(describe:exclude=v0*)"),
            "notes": hostfield(oid, "%N"),
            "sig_status": hostfield(oid, "%G?"),
            "sig_signer": hostfield(oid, "%GS"),
            "sig_key": hostfield(oid, "%GK"),
            "sig_fingerprint": hostfield(oid, "%GF"),
            "sig_primary_fingerprint": hostfield(oid, "%GP"),
            "sig_trust": hostfield(oid, "%GT"),
            "sig_raw": hostfield(oid, "%GG"),
            "ar": hostfield(oid, "%ar"), "cr": hostfield(oid, "%cr"),
            "ah": hostfield(oid, "%ah"), "ch": hostfield(oid, "%ch"),
            "ref_name": hostfield(oid, "%S"),
            "mark": hostfield(oid, "%m"),
        }
        records[oid] = rec

    # Ref tips and HEAD, for the rev walk. Tags are peeled to the commit they
    # point at, since the walk starts from commits.
    refs = []
    for line in (git("for-each-ref", "--format=%(refname) %(objecttype) %(*objectname) %(objectname)") or "").splitlines():
        name, otype, peeled, direct = (line.split(" ") + ["", "", "", ""])[:4]
        target = peeled if otype == "tag" and peeled else direct
        if target in records:
            refs.append({"name": name, "oid": target})
    head = (git("rev-parse", "HEAD") or "").strip()
    OUT.write_text(json.dumps(
        {"repo": REPO, "core_abbrev": core_abbrev, "head": head, "refs": refs,
         "host_supplied_fields": HOST_SUPPLIED, "records": records},
        indent=1, ensure_ascii=False))
    signed = sum(1 for r in records.values() if r["signed"])
    print(f"extracted {len(records)} commit records from raw objects "
          f"({signed} signed, core.abbrev={core_abbrev})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
