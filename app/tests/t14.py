#!/usr/bin/env python3
"""
T14 -- American spelling, enforced. Scans the built app, its sources, tests,
host code, brand scripts, the simulator and probe scripts, and the spec.
The lint is an explicit table (gitlog-probe/scripts/spelling.py), not a rule:
"-our -> -or" would also rewrite "four", "hour" and "our". URLs and `code`
spans are exempt. Declared exemption: recorded evidence (evidence/*.json)
keeps the labels it was generated with; it is data, never rewritten.
Legacy tests (tests/legacy) are the v0.3.0 gates kept for reference, exempt.
"""
import pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parents[2]          # the repository root
sys.path.insert(0, str(ROOT / "probe/scripts"))
import spelling  # noqa: E402

APP = ROOT / "app"
targets = [APP / "src/app.html", APP / "build.mjs", APP / "package.json"] + sorted((APP / "src").glob("*.mjs"))
if (APP / "dist/index.html").exists(): targets.append(APP / "dist/index.html")
targets += sorted((APP / "tests").glob("*.js")) + sorted((APP / "tests").glob("*.py")) + sorted((APP / "tests").glob("*.mjs"))
targets += sorted((APP / "electron").glob("*.js"))
targets += sorted((APP / "brand").glob("*.py")) + sorted((APP / "brand/assets").glob("*.json"))
targets += sorted((ROOT / "probe/sim").glob("*.mjs"))
targets += [f for f in sorted((ROOT / "probe/scripts").glob("*.py")) if f.name != "spelling.py"]
targets += sorted((ROOT / "probe").glob("*.sh")) + sorted((ROOT / "scripts").glob("*"))
targets += sorted((ROOT / ".github/workflows").glob("*.yml"))
# specs from v0.9.0 on; earlier versions are history files and keep their text (spec section 46)
targets += [f for f in sorted((ROOT / "docs/spec").glob("*.md")) if f.name >= "gitlog-format-spec-v0.9.0.md" or "v0." not in f.name]
targets += sorted(ROOT.glob("README*")) + sorted(APP.glob("README*")) + sorted((ROOT / "probe").glob("README*"))
targets += [ROOT / "probe/evidence/registry-v0.3.0.json"]   # generated this version: must be clean
bad = 0
for f in targets:
    if not f.exists(): print(f"  MISSING {f}"); bad += 1; continue
    hits = spelling.find(f.read_text(encoding="utf-8"))
    for line, word, fix in hits[:5]: print(f"  {f.relative_to(ROOT)}:{line}  {word} -> {fix}")
    bad += len(hits)
print(f"T14 — American spelling: {len(targets)} files scanned, {bad} British spellings")
print(f"\nT14 GATE: {'PASS' if not bad else 'FAIL'}")
sys.exit(1 if bad else 0)
