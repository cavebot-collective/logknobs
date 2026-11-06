#!/usr/bin/env python3
"""
Annotation source for the git-log format registry.

The probe emits *instances* -- concrete parameterizations it executed
(`%C(bold)`, `%C(226)`). This module declares *directives* -- distinct
syntactic forms with parameter schemas -- and assigns each to exactly one UI
control. Coverage is defined over directives x parameter space, never over
probe instances, because an instance count silently overstates coverage: one
green `%C(bold)` vector says nothing about `%C(#ff8800)`.

Conventions enforced here (see spec sec.7 glossary):
  - Every `mode` parameter is an enumeration, never a boolean, even when the
    enumeration is currently a singleton.
  - Every control declares an explicit setter contract. Toggles in the UI are
    defined on top of setters, never the reverse.
  - Every tunable numeric bound is a config key, not a literal.
  - Documentation prose describes *observed* behavior. Where git's rule is not
    statable (see F-6), the prose says so rather than inventing one.
"""
from __future__ import annotations

# --------------------------------------------------------------------------
# Tunable bounds. Config keys, not code constants -- "it's never by the first
# time." Consumed by control parameter schemas below.
# --------------------------------------------------------------------------
CONFIG = {
    "pad.width.min": 1,
    "pad.width.max": 200,
    "pad.width.default": 20,
    "wrap.width.max": 500,
    "wrap.indent.max": 64,
    "abbrev.min": 4,
    "abbrev.max": 40,
    "describe.abbrev.max": 40,
    "preview.commit.count": 4,
}

VALUE, OPERATOR, MODIFIER = "value", "operator", "modifier"


def d(token, control, arity, summary, detail, gotchas=(), params=None, alt=None):
    return {
        "directive": token, "control": control, "arity": arity,
        "summary": summary, "detail": detail,
        "gotchas": list(gotchas), "params": params or {},
        "alternates": list(alt or []),
    }


DIRECTIVES: list[dict] = []
A = DIRECTIVES.append

# ---------------------------------------------------------------- identity --
A(d("%H", "commit-hash", VALUE, "Full commit hash",
    "The complete 40-character SHA-1 object name of the commit.",
    ["Unaffected by --abbrev; use %h for the shortened form."]))
A(d("%h", "commit-hash", VALUE, "Abbreviated commit hash",
    "The commit hash shortened to the minimum unambiguous length.",
    ["Length is not fixed. It varies with repository size, the core.abbrev "
     "config value, and the --abbrev=<n> flag. The fixture pins core.abbrev=7 "
     "so golden vectors stay stable; a user's own repo will differ.",
     "Because the length is environment-dependent, a template that aligns "
     "columns against %h will misalign on a different repository."]))
A(d("%T", "tree-hash", VALUE, "Full tree hash",
    "SHA-1 of the tree object this commit points at.", []))
A(d("%t", "tree-hash", VALUE, "Abbreviated tree hash",
    "Shortened tree object name.", ["Same length caveat as %h."]))
A(d("%P", "parent-hashes", VALUE, "Full parent hashes",
    "Space-separated SHA-1s of every parent.",
    ["Empty for a root commit; two or more entries for a merge. A template "
     "assuming exactly one parent will render inconsistently across history."]))
A(d("%p", "parent-hashes", VALUE, "Abbreviated parent hashes",
    "Shortened parent object names, space separated.", []))

# ------------------------------------------------------ author / committer --
for who, pfx, label in (("author", "a", "Author"), ("committer", "c", "Committer")):
    A(d(f"%{pfx}n", f"{who}-name", VALUE, f"{label} name",
        f"The {who}'s name exactly as recorded in the commit object.", []))
    A(d(f"%{pfx}N", f"{who}-name", VALUE, f"{label} name (mailmap)",
        "The name after .mailmap substitution.",
        ["Resolves to the raw name when no .mailmap entry matches, so the two "
         "forms are indistinguishable in a repo without a mailmap."]))
    A(d(f"%{pfx}e", f"{who}-email", VALUE, f"{label} email",
        f"The {who}'s full email address.", []))
    A(d(f"%{pfx}E", f"{who}-email", VALUE, f"{label} email (mailmap)",
        "Full email after .mailmap substitution.", []))
    A(d(f"%{pfx}l", f"{who}-email", VALUE, f"{label} email local-part",
        "The portion before the @.",
        ["Observed: ada@example.org renders as 'ada'."]))
    A(d(f"%{pfx}L", f"{who}-email", VALUE, f"{label} email local-part (mailmap)",
        "Local-part after .mailmap substitution.", []))
    A(d(f"%{pfx}d", f"{who}-date", VALUE, f"{label} date",
        "Date rendered in whatever format --date= selects.",
        ["This is the only date placeholder that honors --date=. The others "
         "below are fixed formats and ignore it entirely.",
         "Because its output depends on a flag rather than the template, two "
         "identical templates can render differently. The configurator must "
         "surface --date= alongside this control, not in a separate panel."],
        params={"date_format": {"kind": "enum", "source": "date-format-registry",
                                "default": "default"}}))
    A(d(f"%{pfx}D", f"{who}-date", VALUE, f"{label} date, RFC 2822", "", []))
    A(d(f"%{pfx}r", f"{who}-date", VALUE, f"{label} date, relative",
        "Human phrasing such as '2 years ago'.",
        ["Output changes with wall-clock time, so it can never be pinned by a "
         "golden vector. Oracle A must exclude it or freeze the clock."]))
    A(d(f"%{pfx}t", f"{who}-date", VALUE, f"{label} date, UNIX timestamp", "", []))
    A(d(f"%{pfx}i", f"{who}-date", VALUE, f"{label} date, ISO 8601-like",
        "Space-separated, close to but not exactly ISO 8601.",
        ["Not strict ISO 8601 -- use the strict form if a machine parses it."]))
    A(d(f"%{pfx}I", f"{who}-date", VALUE, f"{label} date, strict ISO 8601", "", []))
    A(d(f"%{pfx}s", f"{who}-date", VALUE, f"{label} date, short",
        "YYYY-MM-DD.", ["Observed: '2023-11-16'."]))
    A(d(f"%{pfx}h", f"{who}-date", VALUE, f"{label} date, human",
        "Abbreviated, context-dependent phrasing.",
        ["Observed: 'Nov 16 2023'. Omits parts that are obvious relative to "
         "now, so its output is clock-dependent like %ar."]))

# ----------------------------------------------------------------- message --
A(d("%s", "subject", VALUE, "Subject line",
    "The first line of the commit message.", []))
A(d("%f", "subject", VALUE, "Sanitized subject",
    "Subject reduced to a filename-safe slug.",
    ["Observed: 'feat(parser): support nested placeholder groups' becomes "
     "'feat-parser-support-nested-placeholder-groups'."]))
A(d("%b", "body", VALUE, "Body",
    "The message after the subject and its blank separator line.",
    ["Includes trailers. Use the trailers control to separate them.",
     "Observed to end with a trailing newline."]))
A(d("%B", "body", VALUE, "Raw body",
    "The entire message, subject included, unmodified.", []))
A(d("%e", "encoding", VALUE, "Encoding",
    "The commit's encoding header.",
    ["Empty whenever no explicit encoding header is present, which is the "
     "common case. Observed empty across the whole fixture."]))
A(d("%N", "notes", VALUE, "Commit notes",
    "Notes attached to the commit.",
    ["Empty unless a note exists and notes are being shown. Interacts with "
     "--notes / --no-notes."]))

# -------------------------------------------------------------- decoration --
A(d("%d", "decoration", VALUE, "Ref names, parenthesised",
    "Branch, tag and HEAD names, wrapped in parentheses with a leading space.",
    ["Renders empty on an undecorated commit -- including the leading space, "
     "so no stray whitespace is left behind."]))
A(d("%D", "decoration", VALUE, "Ref names, bare",
    "The same names without the surrounding parentheses.", []))
A(d("%(decorate)", "decoration", VALUE, "Ref names, configurable",
    "Decoration with caller-supplied punctuation.",
    ["Every option is optional and order-independent."],
    params={
        "prefix": {"kind": "text", "default": " ("},
        "suffix": {"kind": "text", "default": ")"},
        "separator": {"kind": "text", "default": ", "},
        "pointer": {"kind": "text", "default": " -> "},
        "tag": {"kind": "text", "default": "tag: "},
    },
    alt=["%(decorate:prefix=,suffix=,separator=,pointer=,tag=)"]))
A(d("%S", "ref-name", VALUE, "Ref name reached by",
    "The ref named on the command line through which this commit was reached.",
    ["Observed to echo a raw object name verbatim when the commit was "
     "requested by OID rather than by ref, so it is only meaningful when the "
     "walk started from named refs."]))

# ---------------------------------------------------------------- describe --
A(d("%(describe)", "describe", VALUE, "git describe output",
    "The describe string for this commit.",
    ["Empty when no matching tag is reachable from the commit. Reachability is "
     "backwards-looking: a tag on a later commit does not describe an earlier "
     "one. Observed empty on fixture commits preceding the v0.1.0 tag."],
    params={
        "tags": {"kind": "enum", "values": ["annotated-only", "tags"],
                 "default": "annotated-only"},
        "abbrev": {"kind": "int", "min": 0, "max": CONFIG["describe.abbrev.max"],
                   "optional": True},
        "match": {"kind": "text", "optional": True, "hint": "glob"},
        "exclude": {"kind": "text", "optional": True, "hint": "glob"},
    },
    alt=["%(describe:tags)", "%(describe:abbrev=<n>)",
         "%(describe:match=<glob>)", "%(describe:exclude=<glob>)"]))

# ---------------------------------------------------------------- trailers --
A(d("%(trailers)", "trailers", VALUE, "Message trailers",
    "Trailer lines from the end of the commit message.",
    ["Default output ends with a trailing newline. Supplying separator= "
     "removes it -- observed, and a common source of an unexpected blank line.",
     "key= filters and is repeatable; valueonly and keyonly are mutually "
     "exclusive in practice though git accepts both."],
    params={
        "key": {"kind": "text", "repeatable": True, "optional": True},
        "only": {"kind": "bool", "default": False},
        "unfold": {"kind": "bool", "default": False},
        "keyonly": {"kind": "bool", "default": False},
        "valueonly": {"kind": "bool", "default": False},
        "separator": {"kind": "text", "optional": True,
                      "hint": "accepts %x-escapes, e.g. %x2C"},
        "key_value_separator": {"kind": "text", "optional": True},
    },
    alt=["%(trailers:only)", "%(trailers:unfold)", "%(trailers:keyonly)",
         "%(trailers:valueonly)", "%(trailers:key=<k>)",
         "%(trailers:separator=<s>)", "%(trailers:key_value_separator=<s>)"]))

# --------------------------------------------------------------- signature --
for tok, name, doc in [
    ("%GG", "raw verification message", "Full raw output from the signature check."),
    ("%G?", "validity code", "One letter: G good, B bad, U untrusted, X expired, "
                             "Y expired key, R revoked, E cannot check, N unsigned."),
    ("%GS", "signer name", "Name of the signer."),
    ("%GK", "signing key", "Key used to sign."),
    ("%GF", "key fingerprint", "Fingerprint of the signing key."),
    ("%GP", "primary key fingerprint", "Fingerprint of the signer's primary key."),
    ("%GT", "trust level", "Trust level of the signing key."),
]:
    A(d(tok, "signature", VALUE, f"Signature: {name}", doc,
        ["Unsigned commits render N for %G? and empty for the rest -- the state "
         "observed across the entire fixture, since it has no signing key. This "
         "is a declared coverage gap (spec D-5), not verified behavior."]))

# ------------------------------------------------------------------ reflog --
for tok, name in [("%gD", "full reflog selector"), ("%gd", "short reflog selector"),
                  ("%gn", "reflog identity name"),
                  ("%gN", "reflog identity name (mailmap)"),
                  ("%ge", "reflog identity email"),
                  ("%gE", "reflog identity email (mailmap)"),
                  ("%gs", "reflog subject")]:
    A(d(tok, "reflog", VALUE, f"Reflog: {name}",
        "Reflog information for the entry being walked.",
        ["Meaningless without --walk-reflogs / -g. The configurator must enable "
         "that flag when any reflog control is active, or the whole family "
         "renders empty and the user cannot tell why.",
         "Observed under -g: %gd renders 'HEAD@{0}'."]))

# ------------------------------------------------------------------- marks --
A(d("%m", "mark", VALUE, "Left/right/boundary mark",
    "A single character marking which side of a range the commit came from.",
    ["Observed to render '>' even without --left-right, so its presence does "
     "not imply a range walk is active."]))

# ---------------------------------------------------------------- escapes ---
A(d("%n", "escape", VALUE, "Newline", "Emits a line feed.", []))
A(d("%%", "escape", VALUE, "Literal percent", "Emits one % character.", []))
A(d("%xNN", "escape", VALUE, "Literal byte from hex",
    "Emits the single byte given by two hex digits.",
    ["Operates on bytes, not characters. %x41 is 'A'; multi-byte characters "
     "require one escape per byte and an invalid partial sequence is emitted "
     "verbatim."],
    params={"hex": {"kind": "text", "pattern": "^[0-9a-fA-F]{2}$"}},
    alt=["%x41", "%x0a"]))

# ----------------------------------------------------------------- color ---
for tok, name in [("%Cred", "red"), ("%Cgreen", "green"), ("%Cblue", "blue")]:
    A(d(tok, "color", OPERATOR, f"Color: {name} (shorthand)",
        f"Switches subsequent output to {name}.",
        ["Emits nothing at all unless color is enabled. Under the non-TTY "
         "default (--color=never) this is silently a no-op -- verified: %Cred "
         "produced empty output, while --color=always produced ESC[31m."]))
A(d("%Creset", "color", OPERATOR, "Color: reset",
    "Returns to default rendering.", []))
A(d("%C(<spec>)", "color", OPERATOR, "Color: full specification",
    "Color and attributes for subsequent output.",
    ["Accepts named colors, 256-color indices (%C(226)), 24-bit hex "
     "(%C(#ff8800)), and space-separated attributes (%C(bold ul italic)).",
     "The leading auto/always token is a mode, not an attribute: auto defers "
     "to the --color setting, always forces emission regardless.",
     "%C(auto) alone was observed to emit the default attribute for whatever "
     "placeholder follows, not a no-op."],
    params={
        "mode": {"kind": "enum", "values": ["auto", "always"], "default": "auto",
                 "note": "enumeration by convention; never a boolean"},
        "color": {"kind": "color", "optional": True,
                  "accepts": ["named", "index-0-255", "hex-rrggbb", "normal"]},
        "attributes": {"kind": "multi", "optional": True,
                       "values": ["bold", "dim", "ul", "blink", "reverse",
                                  "italic", "strike"]},
    },
    alt=["%C(bold)", "%C(auto,blue)", "%C(always,red)", "%C(226)",
         "%C(#ff8800)", "%C(bold ul italic)", "%C(reverse)", "%C(dim)",
         "%C(strike)", "%C(blink)", "%C(normal)", "%C(brightred)"]))

# ---------------------------------------------------------------- padding ---
PAD_GOTCHAS = [
    "Padding counts terminal display columns, not bytes and not characters. "
    "SGR escape sequences contribute zero columns -- verified: a pad of 20 over "
    "a colored 8-character subject produced exactly 12 spaces.",
    "Without a truncation option, padding never shortens: an over-long value "
    "is emitted in full and the column budget is simply exceeded.",
    "Truncation is character-aligned and can OVERSHOOT the requested width on "
    "wide glyphs. Verified across N=1..40: a 14-column request on a CJK "
    "subject yields 15 columns, and 16 yields 17. git never splits a UTF-8 "
    "sequence. No simple rule is stated here because none was found; the "
    "behavior is pinned by golden vectors instead (spec F-6).",
    "Minimum output is the ellipsis itself -- N of 1 or 2 both render '..'.",
]
PAD_PARAMS = {
    "width": {"kind": "int", "min": CONFIG["pad.width.min"],
              "max": CONFIG["pad.width.max"], "default": CONFIG["pad.width.default"]},
    "truncate": {"kind": "enum", "values": ["none", "trunc", "ltrunc", "mtrunc"],
                 "default": "none",
                 "note": "enumeration by convention; 'none' is a member, not an absence"},
}
for tok, name, doc in [
    ("%<(<n>)", "left-align", "Pads on the right so the next value occupies n columns."),
    ("%>(<n>)", "right-align", "Pads on the left."),
    ("%>>(<n>)", "right-align, steal", "Pads on the left, consuming adjacent spaces."),
    ("%><(<n>)", "center", "Pads on both sides."),
    ("%<|(<n>)", "left-align to column", "Pads until the output reaches absolute column n."),
    ("%>|(<n>)", "right-align to column", "Right-aligns against absolute column n."),
    ("%><|(<n>)", "center to column", "Centers against absolute column n."),
]:
    col = "|" in tok
    A(d(tok, "padding", OPERATOR, f"Pad: {name}", doc,
        PAD_GOTCHAS + (["Column-relative: the result depends on everything "
                        "rendered earlier on the line, so this directive is not "
                        "independently previewable."] if col else []),
        params=PAD_PARAMS))

# --------------------------------------------------------------- wrapping ---
A(d("%w(<w>,<i1>,<i2>)", "wrapping", OPERATOR, "Line wrapping",
    "Re-wraps subsequent output to width w, indenting the first line of each "
    "paragraph by i1 and continuation lines by i2.",
    ["Width 0 disables wrapping.",
     "Re-flows paragraphs, which destroys the line structure of trailers -- "
     "verified: 'Refs: #500, #501' and 'Reviewed-by: ...' were merged onto one "
     "line. Wrap the body and render trailers separately if that matters.",
     "Trailing spaces before a wrap point were observed to survive into the "
     "output, so wrapped text is not whitespace-clean."],
    params={
        "width": {"kind": "int", "min": 0, "max": CONFIG["wrap.width.max"], "default": 0},
        "indent1": {"kind": "int", "min": 0, "max": CONFIG["wrap.indent.max"], "default": 0},
        "indent2": {"kind": "int", "min": 0, "max": CONFIG["wrap.indent.max"], "default": 0},
    },
    alt=["%w(60)", "%w(60,2,4)", "%w(0,0,0)"]))

# ------------------------------------------------------- line-feed modifier --
A(d("%+<X>", "spacing-modifier", MODIFIER, "Prefix newline if non-empty",
    "Inserts a line feed before the placeholder, but only when it expands to "
    "something.",
    ["The point is empty-value suppression: a plain %n would leave a blank line "
     "on commits with no body. Verified: %+s emitted a leading newline."]))
A(d("%-<X>", "spacing-modifier", MODIFIER, "Strip preceding blank lines if empty",
    "Deletes preceding line feeds when the placeholder expands to nothing.", []))
A(d("% <X>", "spacing-modifier", MODIFIER, "Prefix space if non-empty",
    "Inserts one space before a non-empty expansion.",
    ["Verified: '% s' produced a leading space."]))

# --------------------------------------------------------------------------
# Controls: the UI grouping. Each control owns >=1 directive and declares an
# explicit setter contract. Toggles are defined atop setters, never the reverse.
# --------------------------------------------------------------------------
CONTROLS = {
    "commit-hash":       ("Commit hash", "enum", "setCommitHashForm(form: 'none'|'full'|'abbrev')"),
    "tree-hash":         ("Tree hash", "enum", "setTreeHashForm(form: 'none'|'full'|'abbrev')"),
    "parent-hashes":     ("Parent hashes", "enum", "setParentHashForm(form: 'none'|'full'|'abbrev')"),
    "author-name":       ("Author name", "enum", "setAuthorNameForm(form: 'none'|'raw'|'mailmap')"),
    "author-email":      ("Author email", "enum", "setAuthorEmailForm(form: 'none'|'full'|'full-mailmap'|'local'|'local-mailmap')"),
    "author-date":       ("Author date", "enum", "setAuthorDateForm(form: DateForm)"),
    "committer-name":    ("Committer name", "enum", "setCommitterNameForm(form: 'none'|'raw'|'mailmap')"),
    "committer-email":   ("Committer email", "enum", "setCommitterEmailForm(form: 'none'|'full'|'full-mailmap'|'local'|'local-mailmap')"),
    "committer-date":    ("Committer date", "enum", "setCommitterDateForm(form: DateForm)"),
    "subject":           ("Subject", "enum", "setSubjectForm(form: 'none'|'raw'|'sanitized')"),
    "body":              ("Body", "enum", "setBodyForm(form: 'none'|'body'|'raw')"),
    "encoding":          ("Encoding", "enum", "setEncodingIncluded(v: 'omit'|'include')"),
    "notes":             ("Notes", "enum", "setNotesIncluded(v: 'omit'|'include')"),
    "decoration":        ("Ref decoration", "composite", "setDecoration(cfg: DecorationConfig)"),
    "ref-name":          ("Ref reached by", "enum", "setRefNameIncluded(v: 'omit'|'include')"),
    "describe":          ("Describe", "composite", "setDescribe(cfg: DescribeConfig)"),
    "trailers":          ("Trailers", "composite", "setTrailers(cfg: TrailersConfig)"),
    "signature":         ("Signature fields", "multi", "setSignatureFields(fields: SigField[])"),
    "reflog":            ("Reflog fields", "multi", "setReflogFields(fields: ReflogField[])"),
    "mark":              ("Left/right mark", "enum", "setMarkIncluded(v: 'omit'|'include')"),
    "escape":            ("Literals and escapes", "composite", "setEscape(cfg: EscapeConfig)"),
    "color":             ("Color", "composite", "setColor(span: SpanRef, cfg: ColorConfig)"),
    "padding":           ("Padding", "composite", "setPadding(span: SpanRef, cfg: PadConfig)"),
    "wrapping":          ("Wrapping", "composite", "setWrapping(cfg: WrapConfig)"),
    "spacing-modifier":  ("Spacing modifier", "enum", "setSpacingModifier(span: SpanRef, m: 'none'|'newline'|'space'|'strip')"),
}

# --------------------------------------------------------------------------
# OPTIONS: the second axis. Non-format flags that change how a template (or a
# built-in) renders. Selection flags (--merges, --reverse, --all) and diff
# output (--stat, --patch) are out of scope by declaration: they change WHICH
# commits appear or append non-format output, not how a commit is formatted.
# --------------------------------------------------------------------------
OPTIONS = {
    "pretty": {
        "label": "Output format", "kind": "enum", "setter": "setPretty(mode: PrettyMode)",
        "values": ["tformat", "format", "oneline", "short", "medium", "full", "fuller",
                   "reference", "email", "mboxrd", "raw"],
        "default": "tformat",
        "summary": "Custom template (tformat:/format:) or a built-in pretty format",
        "detail": "tformat: and format: both take the template; they differ only in how "
                  "entries are joined. The built-ins are NOT expressible as templates and "
                  "are rendered by their own verified renderer.",
        "gotchas": [
            "tformat: is terminator semantics (every entry ends with a newline); format: "
            "is separator semantics (newline between entries, none after the last). "
            "--format= means tformat:. Verified on the separator corpus family.",
            "medium emits a 'Merge: a b' line on merge commits; raw emits one 'parent' "
            "line per parent and the gpgsig header verbatim. No template can do either.",
            "raw does NOT emit the encoding header: git re-encodes for output and drops "
            "it. Verified on the explicit-encoding fixture commit.",
            "email folds ASCII subjects at 78 columns and RFC 2047 Q-encodes non-ASCII "
            "ones into =?UTF-8?q?...?= words, breaking when a line would exceed 76. "
            "MIME headers appear when the message contains non-ASCII.",
            "With a built-in, decoration defaults to auto, which is OFF unless stdout is a "
            "terminal. %d in a custom template always shows. Two different mechanisms.",
        ],
    },
    "abbrev": {
        "label": "--abbrev", "kind": "int", "setter": "setAbbrev(n: int)",
        "min": 4, "max": 40, "default": 7,
        "summary": "Length of abbreviated object names",
        "detail": "Applies uniformly to %h, %t and %p, and to the Merge: line of the built-ins.",
        "gotchas": ["The fixture pins core.abbrev=7 so golden vectors are stable. On a real "
                    "repository the default grows with object count, so a column layout "
                    "aligned against %h will drift between repositories.",
                    "Verified: --abbrev=4 renders %h %t %p as 4 characters each; =16 as 16."],
    },
    "decorate": {
        "label": "--decorate", "kind": "enum", "setter": "setDecorate(mode: DecorateMode)",
        "values": ["auto", "short", "full", "no"], "default": "auto",
        "summary": "Ref name style for decoration",
        "detail": "full uses complete ref names (refs/tags/v0.1.0); short strips the prefix.",
        "gotchas": ["--decorate=no does NOT suppress %d in a custom template -- verified. It "
                    "only removes decoration from the built-in formats. Only 'full' changes "
                    "what %d renders.",
                    "auto is the default and is off when stdout is not a terminal, which is "
                    "why the built-ins show no decoration in the corpus."],
    },
    "date": {
        "label": "--date", "kind": "enum", "setter": "setDateStyle(style: DateStyle)",
        "values": ["default", "rfc2822", "iso", "iso-strict", "short", "unix", "raw"],
        "default": "default",
        "summary": "Format for %ad and %cd (and the Date: lines of the built-ins)",
        "detail": "Only %ad and %cd honor this. %aD, %ai, %as and the rest are fixed formats.",
        "gotchas": ["relative and human styles are clock-dependent and cannot be pinned by a "
                    "golden vector; they are host-supplied in the simulator."],
    },
    "color": {
        "label": "--color", "kind": "enum", "setter": "setColorMode(mode: ColorMode)",
        "values": ["never", "always"], "default": "never",
        "summary": "Whether color directives emit anything",
        "detail": "never is the non-TTY default. always forces emission.",
        "gotchas": ["Under never, %Cred, %C(...) AND %Creset emit nothing at all. "
                    "%C(always,...) forces emission regardless. Verified on 54 color vectors."],
    },
}
