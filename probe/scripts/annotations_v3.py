"""
Registry v0.3.0 additions (logknobs v0.9.0). Kept apart from annotations.py so
the v0.2.0 declarations stay readable as they were delivered.

  SCOPES / SCOPE_BY_CONTROL   what each operator applies to (gate T15)
  OPTIONS_V3                  the output-option axis, widened: --graph, order,
                              --first-parent, --reverse, refs, relative dates
  MICRO_TEMPLATES             named option sets for the composite directives
  presets()                   the preset library, from research/provenance.json
  themes()                    terminal color schemes, from Windows Terminal's
                              own defaults.json (sha256 recorded in provenance)
  CONFIG_V3                   new tunable dials -- config keys, never constants
"""
from __future__ import annotations
import json, pathlib

# ---------------------------------------------------------------- scope ----
# Closed set. A directive or option whose scope is not one of these fails T15.
SCOPES = {
    "self": "renders its own text only",
    # Padding buffers everything after it -- literals and colors included --
    # through the next value placeholder, and pads that buffer as one unit
    # (simulator render(); corpus families pad, pad-trunc, pad-col).
    "next-placeholder": "pads everything from here through the next value placeholder, as one unit",
    "until-reset": "applies to everything after it, until a color reset or another color",
    "until-next-wrap": "applies to everything after it, until the next %w",
    "entry": "applies to every entry as a whole",
    "output": "applies to the whole output",
}
# Spacing modifiers (%+x, %-x, % x) are part of the placeholder's own token, so
# they are "self". The v0.9.0 spec draft listed them as next-placeholder; that
# was wrong and is corrected in the spec (section 38).
SCOPE_BY_CONTROL = {"color": "until-reset", "padding": "next-placeholder", "wrapping": "until-next-wrap"}
SCOPE_BY_DIRECTIVE = {"%Creset": "self"}   # a reset ends a color scope; it opens none

# --------------------------------------------------------- options axis ----
# Every option is an enumeration or a bounded integer with a setter. Toggles in
# the UI are drawn atop these setters (determinism doctrine).
OPTIONS_V3 = {
    "graph": {
        "label": "--graph", "kind": "enum", "setter": "setGraph(mode: 'off'|'on')",
        "values": ["off", "on"], "default": "off", "scope": "output",
        "summary": "Draw the commit graph to the left of each entry",
        "detail": "Each entry's first line is prefixed by the commit row; every further line of "
                  "the entry consumes one graph row. Implies topological order unless a date order "
                  "is chosen.",
        "gotchas": ["--graph with --reverse is fatal in git; turning one on turns the other off.",
                    "The '*' commit marker is never colored; only edges take column colors "
                    "(log.graphColors). Verified on the graph-colors family.",
                    "A template ending in %n makes git print a padding row before the "
                    "terminator, so the graph shows no gap."],
        "exclusive_with": ["reverse"],
    },
    "order": {
        "label": "order", "kind": "enum", "setter": "setOrder(mode: 'default'|'topo'|'date'|'author-date')",
        "values": ["default", "topo", "date", "author-date"], "default": "default", "scope": "output",
        "summary": "Commit order: --topo-order, --date-order, --author-date-order",
        "detail": "default is reverse committer-date walk order; with --graph it becomes topo.",
        "flags": {"default": [], "topo": ["--topo-order"], "date": ["--date-order"],
                  "author-date": ["--author-date-order"]},
        "gotchas": ["--date-order still never shows a parent before all of its children."],
    },
    "first_parent": {
        "label": "--first-parent", "kind": "enum", "setter": "setFirstParent(mode: 'off'|'on')",
        "values": ["off", "on"], "default": "off", "scope": "output",
        "summary": "Follow only the first parent of merge commits",
        "detail": "Hides the commits merged in; the graph draws one edge per merge.",
        "gotchas": ["Ordering still counts every parent: under --all, a branch tip that is a "
                    "merge's second parent stays ordered as that merge's parent. Found by the "
                    "graph corpus, not by reading."],
    },
    "reverse": {
        "label": "--reverse", "kind": "enum", "setter": "setReverse(mode: 'off'|'on')",
        "values": ["off", "on"], "default": "off", "scope": "output",
        "summary": "Show the oldest commit first",
        "detail": "Reverses the order of the walk.",
        "gotchas": ["Cannot be combined with --graph: git exits with a fatal error."],
        "exclusive_with": ["graph"],
    },
    "abbrev_commit": {
        "label": "--abbrev-commit", "kind": "enum", "setter": "setAbbrevCommit(mode: 'off'|'on')",
        "values": ["off", "on"], "default": "off", "scope": "entry",
        "summary": "Abbreviate the hash in the built-in formats' header",
        "detail": "Changes only the built-ins (commit <hash>, the oneline hash). A template's %H stays full.",
        "gotchas": ["--oneline is --pretty=oneline --abbrev-commit. --pretty=oneline alone shows the FULL "
                    "hash; the simulator once conflated them, and the corpus caught it."],
    },
    "refs": {
        "label": "refs", "kind": "enum", "setter": "setRefs(mode: 'head'|'all')",
        "values": ["head", "all"], "default": "head", "scope": "output",
        "summary": "Start from HEAD only, or from every ref (--all)",
        "detail": "Applies to the history preview and to the copied command.",
        "flags": {"head": [], "all": ["--all"]},
        "gotchas": [],
    },
}
# Option scopes for the v0.2.0 options
SCOPE_BY_OPTION = {"pretty": "entry", "abbrev": "entry", "decorate": "entry", "date": "entry", "color": "output"}
# --color, widened to git's real default. "auto" colors when output is a
# terminal; the preview IS a terminal, so it shows color under auto, and the
# copied command omits --color, so it runs exactly as the user would type it.
COLOR_OPTION = {
    "values": ["auto", "always", "never"], "default": "auto",
    "summary": "Whether color directives emit anything",
    "detail": "auto (git's default) colors when output is a terminal and not when piped. The preview is "
              "a terminal, so under auto it shows color. always forces color into pipes; never removes it.",
    "gotchas": ["Under never, %Cred, %C(...) AND %Creset emit nothing at all. %C(always,...) forces "
                "emission regardless. Verified on 54 color vectors.",
                "An invalid color spec is fatal in git: the whole git log aborts. Only specs that are "
                "emitted are checked, so under never an invalid spec goes unnoticed."],
}
# Clock-dependent date styles, host-supplied like %ar and %ah
DATE_VALUES_ADDED = ["relative", "human"]

# ----------------------------------------------------- micro-templates ----
# Each is a complete directive token; T13 runs every one on real git and the
# simulator must reproduce git's bytes (Oracle A presets family).
MICRO_TEMPLATES = {
    "decoration": [
        {"id": "parens", "label": "in parentheses (default)", "token": "%d"},
        {"id": "bare", "label": "bare list", "token": "%D"},
        {"id": "brackets", "label": "in brackets", "token": "%(decorate:prefix= [,suffix=])"},
        {"id": "pipes", "label": "pipe-separated", "token": "%(decorate:prefix= ,suffix=,separator=%x20%x7C%x20)"},
        {"id": "no-tag-label", "label": "without the 'tag: ' label", "token": "%(decorate:tag=)"},
        {"id": "fat-arrow", "label": "HEAD => branch", "token": "%(decorate:pointer=%x20%x3D%x3E%x20)"},
    ],
    "describe": [
        {"id": "default", "label": "nearest annotated tag", "token": "%(describe)"},
        {"id": "tags", "label": "nearest tag, lightweight too", "token": "%(describe:tags)"},
        {"id": "abbrev8", "label": "8-character hash suffix", "token": "%(describe:abbrev=8)"},
        {"id": "match", "label": "only tags matching v*", "token": "%(describe:match=v*)"},
    ],
    "trailers": [
        {"id": "all", "label": "all trailers, one per line", "token": "%(trailers)"},
        {"id": "signoffs", "label": "sign-off values only", "token": "%(trailers:key=Signed-off-by,valueonly)"},
        {"id": "inline", "label": "all, comma-separated on one line", "token": "%(trailers:separator=%x2C%x20)"},
        {"id": "keys", "label": "keys only", "token": "%(trailers:keyonly,separator=%x2C%x20)"},
        {"id": "unfold", "label": "unfolded", "token": "%(trailers:unfold)"},
    ],
}

# ---------------------------------------------------------------- presets ----
# lg1/lg2/lg3: the source (Stack Overflow answer 34467298) is unreachable from
# this workspace. The formats below are written after the structure that answer
# is known for; they are labeled after-source and are NOT claimed as its bytes.
AFTER_SOURCE_FORMATS = {
    "lg1": "%C(bold blue)%h%C(reset) - %C(bold green)(%ar)%C(reset) %C(white)%s%C(reset) %C(dim white)- %an%C(reset)%C(auto)%d%C(reset)",
    "lg2": "%C(bold blue)%h%C(reset) - %C(bold cyan)%aD%C(reset) %C(bold green)(%ar)%C(reset)%C(auto)%d%C(reset)%n          %C(white)%s%C(reset) %C(dim white)- %an%C(reset)",
    "lg3": "%C(bold blue)%h%C(reset) - %C(bold cyan)%aD%C(reset) %C(bold green)(%ar)%C(reset) %C(bold cyan)(committed: %cD)%C(reset) %C(auto)%d%C(reset)%n          %C(white)%s%C(reset)%n          %C(dim white)- %an <%ae> %C(reset) %C(dim white)(committer: %cn <%ce>)%C(reset)",
}
PRESET_LABELS = {
    "lg": "lg: one line, colored, relative date", "hist": "hist: short date, author in brackets",
    "lp": "lp: one line, every ref", "ld": "ld: short date, decorated", "ls": "ls: relative date, no graph",
    "smartlog": "smartlog: four-line labeled entries", "lg1": "lg1: one line, every ref",
    "lg2": "lg2: two lines, full date", "lg3": "lg3: three lines, author and committer",
}
# git's own built-ins, as presets of class built-in
BUILTIN_PRESETS = [
    {"id": "oneline", "label": "--oneline", "class": "built-in", "args": ["--oneline"], "format": None},
    {"id": "oneline-graph", "label": "--oneline --graph --all", "class": "built-in",
     "args": ["--oneline", "--graph", "--all"], "format": None},
    {"id": "medium", "label": "git log (medium)", "class": "built-in", "args": [], "format": None},
]
# original: written here, marked so
ORIGINAL_PRESETS = [
    {"id": "columns", "label": "aligned columns", "class": "original",
     "args": [], "format": "%C(auto)%h %C(blue)%<(12,trunc)%an%Creset %C(green)%as%Creset %s%C(auto)%d"},
    {"id": "conventional", "label": "conventional-commit focus", "class": "original",
     "args": ["--graph"], "format": "%C(auto)%h%Creset %C(bold)%<(60,trunc)%s%Creset %C(dim)%ar%Creset"},
]


def presets(provenance_path: pathlib.Path) -> list[dict]:
    prov = json.loads(provenance_path.read_text())
    out = []
    for p in prov["presets"]:
        fmt = p.get("format") or AFTER_SOURCE_FORMATS.get(p["id"])
        if fmt is None:
            raise SystemExit(f"preset {p['id']} has no format")       # totality
        out.append({"id": p["id"], "label": PRESET_LABELS[p["id"]], "class": p["class"],
                    "args": p["args"], "format": fmt, "sources": p.get("sources", []),
                    "license": p.get("license"), "structure": p.get("structure")})
    return out + ORIGINAL_PRESETS + BUILTIN_PRESETS


PRESET_CLASSES = {"verbatim", "verbatim-reassembled", "after-source", "built-in", "original"}

# ---------------------------------------------------------------- themes ----
ANSI_KEYS = ["black", "red", "green", "yellow", "blue", "purple", "cyan", "white"]


def themes(schemes_path: pathlib.Path) -> dict:
    schemes = json.loads(schemes_path.read_text())
    out = {}
    for name, s in schemes.items():
        out[name] = {"source": "windows-terminal", "background": s["background"], "foreground": s["foreground"],
                     "ansi": [s[k] for k in ANSI_KEYS],
                     "bright": [s["bright" + k[0].upper() + k[1:]] for k in ANSI_KEYS]}
    # The house theme: the logknobs UI palette, original. Not a terminal default.
    out["logknobs"] = {"source": "original", "background": "#121821", "foreground": "#D5DBE3",
                       "ansi": ["#5C6773", "#E06C75", "#98C379", "#E8B04A", "#61AFEF", "#C678DD", "#56B6C2", "#D5DBE3"],
                       "bright": ["#7D8A9A", "#FF7B86", "#B5E890", "#FFC966", "#84C4FF", "#E09BF5", "#7FD6E0", "#FFFFFF"]}
    return out


# Windows Terminal's PowerShell and Command Prompt profiles both default to
# Campbell; it is the default here for that reason (spec section 45).
THEME_DEFAULT = "Campbell"

# ---------------------------------------------------------------- config ----
CONFIG_V3 = {
    "history.coalesce_ms": 600,      # consecutive template keystrokes within this window are one undo step
    "history.limit": 200,            # bound on the undo stack
    "preview.color.default": "always",   # the preview shows color; the copied command still omits --color unless changed
    "preview.history.max_commits": 40,
    "templates.storage_key": "logknobs.templates.v1",
    "insert.color.spec": "yellow",   # the spec a freshly inserted %C(...) starts with
}
