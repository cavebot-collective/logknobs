#!/usr/bin/env python3
"""
Builds the annotated registry and enforces the D-2 totality gate.

D-2 ruled that coverage is bounded by verifiability rather than by placeholder
headcount. That makes this check the release gate, not build hygiene. It
asserts, and fails the build on violation:

  T1  Every probe instance maps to exactly one directive. Zero matches means an
      observed behavior nothing documents; two matches means an ambiguous
      grammar where the UI cannot know which control owns an edit.
  T2  Every directive carries a summary and belongs to a declared control.
  T3  Every declared control is reachable from at least one directive
      (no orphan controls -- a control that edits nothing).
  T4  Every control declares an explicit setter contract, and that contract is
      a setter rather than a toggle (determinism doctrine).
  T5  Every parameter named `mode` is an enumeration, never a boolean
      (mode-parameter convention).
  T6  Every directive has at least one evidence example drawn from the corpus,
      or an explicit declared reason why it cannot.
  T7  Classification is total: no catch-all bucket, no unclassified residue.

T8 (every control has a propagation test) activates when the UI exists; it is
declared PENDING here rather than silently omitted, so the gate does not report
a coverage level it has not verified.
"""
from __future__ import annotations
import json, re, sys, pathlib, collections
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from annotations import DIRECTIVES, CONTROLS, CONFIG, OPTIONS  # noqa: E402
import annotations_v3 as V3  # noqa: E402
import spelling  # noqa: E402
RESEARCH = pathlib.Path(sys.argv[3] if len(sys.argv) > 3 else pathlib.Path(__file__).resolve().parents[2] / "research")

EV = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else pathlib.Path(__file__).resolve().parents[1] / "evidence")
OUTP = pathlib.Path(sys.argv[2])   # required: never default onto a delivered registry

# Instance -> directive matchers. Order is irrelevant: T1 requires exactly one
# match, so an overlapping pattern is a build failure rather than a silent
# first-wins.
MATCH = {
    "%xNN":               r"^%x[0-9a-fA-F]{2}$",
    "%C(<spec>)":         r"^%C\(.*\)$",
    "%<(<n>)":            r"^%<\((?!\|)[^|].*\)$",
    "%>(<n>)":            r"^%>\([^|].*\)$",
    "%>>(<n>)":           r"^%>>\(.*\)$",
    "%><(<n>)":           r"^%><\([^|].*\)$",
    "%<|(<n>)":           r"^%<\|\(.*\)$",
    "%>|(<n>)":           r"^%>\|\(.*\)$",
    "%><|(<n>)":          r"^%><\|\(.*\)$",
    "%w(<w>,<i1>,<i2>)":  r"^%w\(.*\)$",
    "%(trailers)":        r"^%\(trailers(:.*)?\)$",
    "%(describe)":        r"^%\(describe(:.*)?\)$",
    "%(decorate)":        r"^%\(decorate(:.*)?\)$",
    "%+<X>":              r"^%\+.$",
    "%-<X>":              r"^%-.$",
    "% <X>":              r"^% .$",
}
LITERAL = {d["directive"] for d in DIRECTIVES} - set(MATCH)


# Format-string tokenizer. Longest-alternative-first ordering matters:
# %>>( must be tried before %>(, and %><|( before %><(, or a shorter
# alternative wins and the directive is misattributed.
TOKEN_RE = re.compile(r"""
      %C\([^)]*\)
    | %C[a-zA-Z]+
    | %\([a-z][a-z-]*(?::[^)]*)?\)
    | %><\|\([^)]*\)
    | %<\|\([^)]*\)
    | %>\|\([^)]*\)
    | %>>\([^)]*\)
    | %><\([^)]*\)
    | %<\([^)]*\)
    | %>\([^)]*\)
    | %w\([^)]*\)
    | %x[0-9a-fA-F]{2}
    | %[+\- ][a-zA-Z]
    | %%
    | %[a-zA-Z][a-zA-Z]?[?]?
""", re.X)


def tokenize(fmt: str) -> list[str]:
    return TOKEN_RE.findall(fmt)


def directives_in(fmt: str) -> set[str]:
    out = set()
    for tok in tokenize(fmt):
        for d in match_directive(tok):
            out.add(d)
    return out


def match_directive(tok: str) -> list[str]:
    hits = [d for d in LITERAL if d == tok]
    hits += [d for d, pat in MATCH.items() if re.match(pat, tok)]
    return hits


def main() -> int:
    probe = json.loads((EV / "registry.json").read_text())
    corpus = json.loads((EV / "corpus.json").read_text())
    instances = [p["token"] for p in probe["placeholders"] if p["class"] == "EXPANDS"]
    by_dir = {d["directive"]: d for d in DIRECTIVES}

    failures: list[str] = []
    def fail(code, msg): failures.append(f"{code}: {msg}")

    # ---- T1 exactly-one mapping ------------------------------------------
    mapping, unmatched, ambiguous = {}, [], []
    for tok in instances:
        hits = match_directive(tok)
        if len(hits) == 0:
            unmatched.append(tok)
        elif len(hits) > 1:
            ambiguous.append((tok, hits))
        else:
            mapping.setdefault(hits[0], []).append(tok)
    for t in unmatched:
        fail("T1", f"probe instance {t!r} maps to no directive")
    for t, h in ambiguous:
        fail("T1", f"probe instance {t!r} maps to {len(h)} directives: {h}")

    # ---- T2 directive completeness ---------------------------------------
    for d in DIRECTIVES:
        if not d["summary"]:
            fail("T2", f"directive {d['directive']} has no summary")
        if d["control"] not in CONTROLS:
            fail("T2", f"directive {d['directive']} names undeclared control {d['control']!r}")

    # ---- T3 no orphan controls -------------------------------------------
    used = {d["control"] for d in DIRECTIVES}
    for c in CONTROLS:
        if c not in used:
            fail("T3", f"control {c!r} owns no directive")

    # ---- T4 setter contracts ---------------------------------------------
    for c, (label, kind, setter) in CONTROLS.items():
        if not re.match(r"^set[A-Z]", setter):
            fail("T4", f"control {c!r} contract {setter!r} is not a setter")
        if "toggle" in setter.lower():
            fail("T4", f"control {c!r} exposes a toggle as its contract")

    # ---- T5 mode parameters are enumerations ------------------------------
    for d in DIRECTIVES:
        for pname, p in d["params"].items():
            if pname == "mode" and p.get("kind") != "enum":
                fail("T5", f"{d['directive']} param 'mode' is {p.get('kind')!r}, not enum")
            if pname.endswith("mode") and p.get("kind") == "bool":
                fail("T5", f"{d['directive']} param {pname!r} is boolean")

    # ---- T6 evidence examples --------------------------------------------
    vec_by_name = collections.defaultdict(list)
    for v in corpus["vectors"]:
        vec_by_name[v["family"]].append(v)
    examples = {}
    CLOCK_DEPENDENT = {"%ar", "%cr", "%ah", "%ch"}
    # Directives with no non-empty output anywhere in the corpus, each with a
    # stated reason. An undeclared member fails T6 -- a silent empty is exactly
    # the false-coverage mode this gate exists to catch.
    EVIDENCE_GAPS = {
        "%Creset": "emits a reset sequence only; no visible glyph to sample",
        "%n": "expands to a line feed, which the example extractor strips",
    }
    EVIDENCE_FAMILIES = ("placeholder", "pad", "pad-trunc", "pad-col",
                         "wrap", "color", "reflog")
    # Index every vector by the directives its *format string* exercises. Name
    # parsing cannot do this: the pad sweep encodes N in the name, not the
    # token, so 8 of 80 directives read as uncovered when they are not.
    by_directive: dict[str, list] = collections.defaultdict(list)
    for v in corpus["vectors"]:
        if v["family"] not in EVIDENCE_FAMILIES:
            continue
        fmt = next((a[len("--format="):] for a in v["argv"]
                    if a.startswith("--format=")), None)
        if not fmt:
            continue
        for dname in directives_in(fmt):
            by_directive[dname].append(v)

    for d in DIRECTIVES:
        ex = []
        for v in by_directive.get(d["directive"], []):
            out = bytes.fromhex(v["stdout_hex"]).decode("utf-8", "replace").rstrip("\n")
            if out and out != "|":
                case = v["name"].rsplit("@", 1)[1] if "@" in v["name"] else v["name"]
                # vector names are recorded evidence and keep their original
                # labels; the label shown in the app is normalized (gate T14)
                case = spelling.fix(case)
                ex.append({"case": case, "output": out[:160]})
            if len(ex) >= 3:
                break
        if not ex and d["directive"] not in EVIDENCE_GAPS:
            fail("T6", f"directive {d['directive']} has no non-empty evidence "
                       f"and no declared gap reason")
        examples[d["directive"]] = ex

    # ---- T7 totality ------------------------------------------------------
    classes = {p["class"] for p in probe["placeholders"]}
    if not classes <= {"EXPANDS", "PASSTHROUGH", "ERROR"}:
        fail("T7", f"probe classification leaked a category: {sorted(classes)}")
    covered = sum(len(v) for v in mapping.values())
    if covered != len(instances):
        fail("T7", f"coverage residue: {covered} mapped of {len(instances)} instances")

    # ---- emit -------------------------------------------------------------
    # ---- T9 options axis: every option has a setter and full docs -----------
    for k, o in OPTIONS.items():
        if not re.match(r"^set[A-Z]", o["setter"]): fail("T9", f"option {k} contract is not a setter")
        if o["kind"] == "enum" and not o.get("values"): fail("T9", f"option {k} enum has no values")
        if not o.get("summary") or not o.get("detail"): fail("T9", f"option {k} lacks docs")
    # ---- v0.3.0: widened options axis, scope, micro-templates, presets, themes
    options = {k: dict(v) for k, v in OPTIONS.items()}
    options["date"]["values"] = options["date"]["values"] + V3.DATE_VALUES_ADDED
    options["date"]["gotchas"] = options["date"]["gotchas"] + [
        "relative and human are host-supplied here, like %ar and %ah: the sample records carry "
        "git's own rendering, captured when the record was extracted."]
    options["color"].update(V3.COLOR_OPTION)
    for k, s in V3.SCOPE_BY_OPTION.items(): options[k]["scope"] = s
    options.update(V3.OPTIONS_V3)
    # ---- T15 scope totality ------------------------------------------------
    scope_of = {}
    for dd in DIRECTIVES:
        s = V3.SCOPE_BY_DIRECTIVE.get(dd["directive"]) or V3.SCOPE_BY_CONTROL.get(dd["control"], "self")
        if s not in V3.SCOPES: fail("T15", f"directive {dd['directive']} scope {s!r} not in the closed set")
        scope_of[dd["directive"]] = s
    for k, o in options.items():
        if o.get("scope") not in V3.SCOPES: fail("T15", f"option {k} has no scope from the closed set")
    for k, o in V3.OPTIONS_V3.items():
        if not re.match(r"^set[A-Z]", o["setter"]): fail("T9", f"option {k} contract is not a setter")
        for x in o.get("exclusive_with", []):
            if k not in options[x].get("exclusive_with", []): fail("T9", f"exclusivity {k}/{x} is not symmetric")
    presets = V3.presets(RESEARCH / "provenance.json")
    for pr in presets:
        if pr["class"] not in V3.PRESET_CLASSES: fail("T13", f"preset {pr['id']} class {pr['class']!r} not in the closed set")
    for ctl, mts in V3.MICRO_TEMPLATES.items():
        if ctl not in CONTROLS: fail("T13", f"micro-templates name unknown control {ctl}")
        for m in mts:
            if match_directive(m["token"]) == []: fail("T13", f"micro-template {m['token']} matches no directive")
    themes = V3.themes(RESEARCH / "sources" / "wt-schemes.json")
    if V3.THEME_DEFAULT not in themes: fail("T13", "default theme missing")
    registry = {
        "schema": "gitlog-format-registry/3",
        "scopes": V3.SCOPES,
        "micro_templates": V3.MICRO_TEMPLATES,
        "presets": presets,
        "themes": themes, "theme_default": V3.THEME_DEFAULT,
        "options": options,
        "git_version": probe["git_version"],
        "config": {**CONFIG, **V3.CONFIG_V3},
        "controls": {c: {"label": l, "kind": k, "setter": s,
                         "directives": sorted(d["directive"] for d in DIRECTIVES if d["control"] == c)}
                     for c, (l, k, s) in CONTROLS.items()},
        "directives": [
            {**d, "instances": sorted(mapping.get(d["directive"], [])),
             "examples": examples[d["directive"]],
             "clock_dependent": d["directive"] in CLOCK_DEPENDENT,
             "scope": scope_of[d["directive"]],
             "evidence_gap": EVIDENCE_GAPS.get(d["directive"])}
            for d in DIRECTIVES
        ],
        "gates": {
            "T1_instance_mapping": "PASS" if not (unmatched or ambiguous) else "FAIL",
            "T8_propagation_tests": "run by the app suite (tests/t8.js)",
        },
    }
    OUTP.write_text(json.dumps(registry, indent=1, ensure_ascii=False))

    # ---- report -----------------------------------------------------------
    print("D-2 TOTALITY GATE")
    print(f"  probe instances : {len(instances)}")
    print(f"  directives      : {len(DIRECTIVES)}")
    print(f"  controls        : {len(CONTROLS)}")
    print(f"  clock-dependent : {sorted(CLOCK_DEPENDENT)} (excluded from Oracle A)")
    per = collections.Counter(d["control"] for d in DIRECTIVES)
    print("\n  control -> directives owned")
    for c in sorted(CONTROLS):
        print(f"    {c:<20} {per[c]:>2}  {CONTROLS[c][2]}")
    print(f"  options         : {len(options)} (second axis)")
    for code in ("T1", "T2", "T3", "T4", "T5", "T6", "T7", "T9", "T13", "T15"):
        n = sum(1 for f in failures if f.startswith(code))
        print(f"  [{'PASS' if not n else 'FAIL'}] {code}  ({n} violations)")
    if failures:
        print(f"\nGATE: FAIL ({len(failures)})")
        for f in failures[:25]:
            print("  " + f)
        return 1
    print("\nGATE: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
