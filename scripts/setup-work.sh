#!/usr/bin/env bash
# Builds the sample repositories the app gates run against, into .work/
# (or $LK_WORK), and checks they are the ones the evidence was recorded from:
# every builder is deterministic, so a commit id that differs means the
# environment differs (git version, config leaking in), and the gates would
# be comparing against the wrong repository. That is a halt, not a warning.
set -euo pipefail
cd "$(dirname "$0")/.."
W="${LK_WORK:-$PWD/.work}"; mkdir -p "$W"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
bash probe/scripts/build_fixture.sh "$W/fixture" >/dev/null
for s in terse conventional verbose; do python3 probe/scripts/build_topology.py "$W/topo-$s" "$s" >/dev/null; done
python3 - "$W" <<'PY'
import json, subprocess, sys, pathlib
W = pathlib.Path(sys.argv[1]); bad = 0
recs = json.load(open("probe/evidence/records.json"))["records"]
samples = [h for h, r in recs.items() if any(k in r["message"] for k in ("fix typo", "feat(parser)", "refactor(core)"))]
for h in samples:
    ok = subprocess.run(["git", "-C", str(W / "fixture"), "cat-file", "-e", h + "^{commit}"]).returncode == 0
    print(f"  fixture sample {h[:10]}: {'ok' if ok else 'MISSING'}"); bad += not ok
for s in ["terse", "conventional", "verbose"]:
    want = json.load(open(f"probe/evidence/topology/records-{s}.json"))["head"]
    got = subprocess.run(["git", "-C", str(W / f"topo-{s}"), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    print(f"  topo-{s} HEAD {got[:10]}: {'ok' if got == want else 'DIFFERS from ' + want[:10]}"); bad += got != want
sys.exit(1 if bad else 0)
PY
echo "setup-work: PASS ($W)"
