#!/usr/bin/env python3
"""
American-spelling lint (gate T14) and fixer.

The fix list said "don't be British". A one-time find-and-replace would
regress the next time prose is written, so this is a gate: it scans
user-facing text and fails on any entry in the table below.

The table is explicit rather than rule-based (no "-our -> -or" regex),
because a rule would also rewrite words that are correct in American
English: "four", "pour", "hour", "tour", "our", "flour", "contour".
Every entry is a whole-word match. Classification is total in the sense
that matters here: a word is either in the table (flagged) or it is not
(passes); there is no fuzzy middle.

Proper nouns and quoted source text are not linted -- an author's own
spelling in a cited title is theirs to keep. Callers exclude those
regions; see EXEMPT_PATTERNS.
"""
from __future__ import annotations
import re, sys, pathlib

BRITISH_TO_AMERICAN = {
    "colour": "color", "colours": "colors", "coloured": "colored", "colouring": "coloring",
    "colourful": "colorful", "colourise": "colorize", "colourised": "colorized",
    "centre": "center", "centres": "centers", "centred": "centered", "centring": "centering",
    "behaviour": "behavior", "behaviours": "behaviors", "behavioural": "behavioral",
    "honour": "honor", "honours": "honors", "honoured": "honored",
    "favour": "favor", "favours": "favors", "favoured": "favored", "favourite": "favorite",
    "neighbour": "neighbor", "neighbours": "neighbors", "harbour": "harbor",
    "labour": "labor", "rumour": "rumor", "humour": "humor", "vapour": "vapor",
    "organise": "organize", "organised": "organized", "organising": "organizing", "organisation": "organization",
    "recognise": "recognize", "recognised": "recognized", "recognising": "recognizing",
    "realise": "realize", "realised": "realized", "realising": "realizing",
    "analyse": "analyze", "analysed": "analyzed", "analysing": "analyzing",
    "normalise": "normalize", "normalised": "normalized", "normalising": "normalizing",
    "serialise": "serialize", "serialised": "serialized", "initialise": "initialize",
    "initialised": "initialized", "minimise": "minimize", "minimised": "minimized",
    "maximise": "maximize", "maximised": "maximized", "optimise": "optimize", "optimised": "optimized",
    "summarise": "summarize", "summarised": "summarized", "prioritise": "prioritize",
    "prioritised": "prioritized", "utilise": "utilize", "utilised": "utilized",
    "emphasise": "emphasize", "emphasised": "emphasized", "customise": "customize",
    "customised": "customized", "customisation": "customization", "visualise": "visualize",
    "visualised": "visualized", "visualisation": "visualization", "synchronise": "synchronize",
    "synchronised": "synchronized", "standardise": "standardize", "categorise": "categorize",
    "authorise": "authorize", "authorised": "authorized", "apologise": "apologize",
    "catalogue": "catalog", "catalogues": "catalogs", "dialogue": "dialog",
    "artefact": "artifact", "artefacts": "artifacts",
    "modelled": "modeled", "modelling": "modeling", "labelled": "labeled", "labelling": "labeling",
    "travelled": "traveled", "travelling": "traveling", "cancelled": "canceled", "cancelling": "canceling",
    "levelled": "leveled", "signalled": "signaled", "signalling": "signaling",
    "fuelled": "fueled", "totalled": "totaled", "tunnelling": "tunneling",
    "fulfil": "fulfill", "fulfils": "fulfills", "enrol": "enroll", "instil": "instill",
    "judgement": "judgment", "acknowledgement": "acknowledgment",
    "licence": "license", "licences": "licenses", "defence": "defense", "offence": "offense",
    "grey": "gray", "greys": "grays", "programme": "program", "programmes": "programs",
    "whilst": "while", "amongst": "among", "towards": "toward", "learnt": "learned",
    "spelt": "spelled", "dreamt": "dreamed", "burnt": "burned",
    "metre": "meter", "metres": "meters", "litre": "liter", "fibre": "fiber", "theatre": "theater",
    "ageing": "aging", "aluminium": "aluminum", "cheque": "check", "kerb": "curb",
    "tyre": "tire", "plough": "plow", "mould": "mold", "manoeuvre": "maneuver",
    "practise": "practice", "storey": "story", "jewellery": "jewelry",
}
WORD = re.compile(r"[A-Za-z]+")
# Regions not linted: quoted source titles and URLs (an author's own spelling
# is theirs), and code identifiers that must match a stable external name.
EXEMPT_PATTERNS = [re.compile(p) for p in (r"https?://\S+", r"`[^`]*`")]


def _mask(text: str) -> str:
    for pat in EXEMPT_PATTERNS:
        text = pat.sub(lambda m: " " * len(m.group(0)), text)
    return text


def find(text: str) -> list[tuple[int, str, str]]:
    """Return [(line_no, british, american)] for every flagged word."""
    hits = []
    for ln, line in enumerate(_mask(text).splitlines(), 1):
        for m in WORD.finditer(line):
            w = m.group(0); low = w.lower()
            if low in BRITISH_TO_AMERICAN:
                hits.append((ln, w, BRITISH_TO_AMERICAN[low]))
    return hits


def fix(text: str) -> str:
    """Rewrite flagged words outside exempt regions, preserving case shape."""
    spans = []
    for pat in EXEMPT_PATTERNS:
        spans += [(m.start(), m.end()) for m in pat.finditer(text)]
    def exempt(i): return any(a <= i < b for a, b in spans)
    def repl(m):
        w = m.group(0); low = w.lower()
        if low not in BRITISH_TO_AMERICAN or exempt(m.start()):
            return w
        a = BRITISH_TO_AMERICAN[low]
        if w.isupper(): return a.upper()
        if w[0].isupper(): return a[0].upper() + a[1:]
        return a
    return WORD.sub(repl, text)


if __name__ == "__main__":
    bad = 0
    for p in sys.argv[1:]:
        for ln, w, a in find(pathlib.Path(p).read_text(encoding="utf-8")):
            print(f"{p}:{ln}: {w} -> {a}"); bad += 1
    print(f"T14 spelling: {bad} British spelling(s) found")
    sys.exit(1 if bad else 0)
