#!/usr/bin/env bash
# logknobs evidence verifier, v0.9.0 checkpoint 2.
# Requires git 2.43.0 (pinned; other versions differ) and node >= 20.
# Clock note: the preset corpus and the topology records carry git's relative
# dates (%ar, --date=relative/human), captured together. If a regeneration lands
# across a boundary ("2 years ago" -> "3 years ago") the preset comparison
# reports DIFFERS; re-extract records and corpus together and it agrees again.
# Usage: ./VERIFY.sh [workdir]   -- rebuilds every fixture from scratch, regenerates
# every corpus, byte-compares against the shipped evidence, then runs every oracle.
set -euo pipefail
cd "$(dirname "$0")"; W="${1:-$(mktemp -d)}"; mkdir -p "$W"
[ "$(git --version)" = "git version 2.43.0" ] || { echo "HALT: need git 2.43.0, have $(git --version)"; exit 2; }
same() { python3 -c "import json,sys;a,b=[[v['stdout_hex'] for v in json.load(open(f))['vectors']] for f in sys.argv[1:]];sys.exit(a!=b)" "$1" "$2" && echo "  regen $3: identical" || { echo "  regen $3: DIFFERS"; exit 1; }; }
for s in terse conventional verbose; do python3 scripts/build_topology.py "$W/topo-$s" "$s" >/dev/null; done
python3 scripts/gen_graph_corpus.py "$W" "$W/graph-corpus.json" >/dev/null;           same "$W/graph-corpus.json" evidence/topology/graph-corpus.json graph
python3 scripts/gen_decoration_corpus.py "$W" "$W/decoration-corpus.json" >/dev/null; same "$W/decoration-corpus.json" evidence/topology/decoration-corpus.json decoration
mkdir -p "$W/held"; python3 scripts/gen_random_topology.py "$W/rand" "$W/held/graph-heldout.json" 7 11 23 42 101 2026 >/dev/null
same "$W/held/graph-heldout.json" evidence/topology/graph-heldout.json held-out
python3 scripts/gen_token_sweep.py "$W" "$W/token-sweep.json" >/dev/null;               same "$W/token-sweep.json" evidence/topology/token-sweep.json tokenize
python3 scripts/gen_preset_corpus.py "$W" evidence/registry-v0.3.0.json "$W/preset-corpus.json" >/dev/null; same "$W/preset-corpus.json" evidence/topology/preset-corpus.json presets
node sim/oracle_a.mjs evidence | grep -E "ENGINE|host-supplied \(|T8a |named-format|options \("
node sim/color_diff.mjs evidence | tail -1 | sed 's/^/  color grammar /'
for c in graph-corpus.json graph-heldout.json decoration-corpus.json token-sweep.json preset-corpus.json; do node sim/graph_diff.mjs evidence $c | tail -1 | sed "s/^/  $c /"; done
node sim/wrap_diff.mjs evidence/wrap-sweep.json; node sim/trunc_diff.mjs evidence/trunc-sweep.json
python3 - <<'P'
import pathlib,sys; sys.path.insert(0,'scripts'); import spelling
bad=[(str(f),h) for f in list(pathlib.Path('sim').glob('*.mjs'))+list(pathlib.Path('scripts').glob('*.py')) if f.name!='spelling.py' for h in spelling.find(f.read_text())]
print("  T14 (sim+scripts):", "PASS" if not bad else f"FAIL {bad[:5]}"); sys.exit(1 if bad else 0)
P
echo "VERIFY: PASS"
