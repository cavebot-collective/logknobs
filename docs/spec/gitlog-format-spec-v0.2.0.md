# git-log Format Tool — Specification v0.2.0

Status: **pre-implementation, decisions ratified, verification harness green**.
D-1/D-2/D-3 ruled on 2026-09-09 (see §9). Oracle B gate PASSED. No UI code has
been written; implementation is unblocked.

Supersedes v0.1.0, which is retained. v0.1.0 §8 stated these as open; §9 below
records the rulings and their consequences.

Binding: git 2.43.0. Every empirical claim below is derived from execution
against that binary, not from documentation or recollection. Evidence lives in
`evidence/` (registry.json, operators.json, bytes.json, corpus.json).

---

## 1. Charter

Purposes, as declared in the request. These are the axes against which every
design option is scored separately in §5.

| id | purpose |
|----|---------|
| P1 | Configurator view with controls for all customizations |
| P2 | Three-case preview, cyclable, with bidirectional live sync to controls |
| P3 | Runs in a browser context **and** a cross-platform desktop context |
| P4 | Full coverage of git log features and syntax |
| P5 | Full syntax documentation co-located with the controls that emit it |
| P6 | Simulation, per-modification tests, and E2E visual comparison of actual vs simulated output |

---

## 2. What the probe established

The placeholder language was derived by execution: 124 candidate tokens were
run against the binary and classified totally into `EXPANDS` / `PASSTHROUGH` /
`ERROR`. Findings that change the design:

**F-1 — Twelve candidate placeholders are not part of `git log`'s language.**
`%(if)`, `%(then)`, `%(else)`, `%(end)`, `%(objectname)`, `%(refname)`,
`%(upstream)`, `%(contents:subject)`, `%(HEAD)`, `%(is-base:…)`, `%q`, `%z` all
pass through verbatim. They belong to `git for-each-ref`, whose format language
is a near-neighbour but not a superset. A tool that offered `%(if)/%(then)`
conditionals would be shipping a feature git does not have.

**F-2 — `%(ahead-behind:…)` is also `for-each-ref`-only on 2.43.** I expected
this one to work. It does not. This is the concrete case for version-binding:
the registry is valid *for a git version*, and the tool must detect the host
git version and degrade the control set accordingly rather than assume.

**F-3 — Colour placeholders emit nothing without a TTY.** `%Cred` produces
empty output under `--color=never` (the non-TTY default) and `\x1b[31m` under
`--color=always`. Consequences: (a) every differential run must pin
`--color=always` or the oracle silently compares two colourless strings and
passes vacuously; (b) colour is a tri-state (`auto`/`always`/`never`) that the
tool must model as an enumeration, not a boolean.

**F-4 — Padding and wrapping are operators, not values.** `%<(20)` alone
expands to empty; it modifies the *next* placeholder's rendering. My first
probe tested them in isolation and misclassified them as inert. The template
grammar therefore has two node kinds with different arity, and the simulator
cannot be a flat token→string map.

**F-5 — Padding counts display columns and excludes SGR bytes.**
`%<(20)%C(always,red)%s%Creset` on subject `fix typo` yields
`ESC[31m` + `fix typo` + 12 spaces + `ESC[m`. The escape sequence contributes
zero columns, and the pad spans across the colour placeholder.

**F-6 — Truncation is character-aligned and may overshoot the column budget.**
Swept `N = 1..40 × {trunc, ltrunc, mtrunc} × {ascii, CJK+emoji}`:

| requested N | actual columns | output |
|---|---|---|
| 13 | 13 | `fix(i18n): ..` |
| 14 | **15** | `fix(i18n): 日..` |
| 15 | 15 | `fix(i18n): 日..` |
| 16 | **17** | `fix(i18n): 日本..` |

git never splits a UTF-8 sequence, but it will exceed the requested width by
one column when a wide character straddles the boundary. On pure ASCII the
result is exact for all N ≥ 2; at N ≤ 2 the output floors at the literal `..`.

This is the load-bearing consequence: **the tooltip text must not state the
naive rule** ("truncates to N columns"), and the simulator must not implement
it. §6 handles this by making agreement-on-corpus the contract rather than
agreement-on-rule.

**F-7 — Scale of "full coverage."** 111 expanding placeholders, 11 named
pretty formats, 18 date formats, 31 output-affecting flags, plus the parameter
spaces of the pad/wrap/colour operators. This is the denominator for P4 and it
is the subject of D-2.

---

## 3. Fixture and corpus

`scripts/build_fixture.sh` builds a repo whose commit OIDs are byte-reproducible
across machines (pinned identities, pinned author and committer timestamps,
`GIT_CONFIG_GLOBAL=/dev/null` to defeat host config leakage, `core.abbrev=7`).
Verified by triple rebuild and OID comparison.

It carries the three declared preview cases plus the structural commits that
placeholders need in order to be meaningful at all:

| commit | serves |
|---|---|
| `init`, `fix typo` | case 1 — terse |
| `feat(parser): …` with `Refs`/`Signed-off-by`/`Co-authored-by` | case 2 — conventional, `%(trailers…)` |
| `refactor(core)!: …` long subject, wrapped body, CJK + emoji, `BREAKING CHANGE` | case 3 — verbose, `%w`, truncation |
| `fix(i18n): 日本語の幅を正しく数える 🌍` | column-width divergence (F-6) |
| annotated tag `v0.1.0` | `%d`, `%D`, `%(decorate…)`, `%(describe…)` |
| merge commit | `%P` multi-parent, `%m`, `--graph`, `--left-right` |
| commit note | `%N` |

An encoding bug in an earlier revision of this fixture produced a
double-encoded CJK subject (92 bytes where 52 were correct). It was caught only
by byte-length accounting, not by reading the output — text-mode capture had
been silently mangling the evidence. **All probe and oracle capture is binary;
this is not negotiable.**

`scripts/gen_corpus.py` emits **1,771 golden vectors / 135,501 bytes**, each
recording the exact argv and the exact response bytes as hex. Zero failed
invocations. Breakdown: placeholder 666, pad 480, pad-trunc 360, named-format
66, color 54, pad-col 48, wrap 46, flag 31, date-format 18, separator 2.

Signed commits are **not** covered — no signing key in the fixture, so `%G?`
observes `N` and the other `%G*` placeholders observe empty. Closing this
requires generating a throwaway GPG key during fixture build. Tracked as a
declared coverage gap, not silently omitted.

---

## 4. D-1 (blocking): what "editable preview propagates back to controls" means

The request specifies that edits to the preview panel propagate back to the
controls. Taken literally — free-text editing of rendered output, from which
the template is inferred — this is ill-posed. Given rendered output `c9e77e7
Fix bug`, the string `c9e77e7` could be `%h`, or `%<(7,trunc)%H`, or a literal.
The preimage is infinite, and no amount of heuristics makes the inverse a
function. Committing to it would put a nondeterministic component at the centre
of the tool, which contradicts the determinism doctrine.

Four options:

**R1 — template string is editable; preview is read-only.**
Controls ↔ template-string field, both directions. Well-posed (parsing, not
inference). Does not satisfy P2 as written.

**R2 — free-text editable preview, template inferred.**
Satisfies P2 literally. Nondeterministic, untestable (no ground truth for the
inference), and will mis-attribute whenever literal text coincides with a field
value. I recommend against this and would want the recommendation overruled
explicitly rather than assumed.

**R3 — span-attributed structured preview.** *(recommended)*
The renderer emits a span table alongside the output: every output byte range
carries the template node that produced it. The preview is editable, but edits
are operations over spans — delete a span → remove the node; type between spans
→ insert a literal node; drag → reorder; edit within a literal span → edit that
literal. An edit *inside a value span* (retyping a hash) is not silently
guessed at; it is surfaced as a choice: convert the span to a literal, or
revert. Well-posed, deterministic, and genuinely direct manipulation.

**R4 — R3 plus free-text with reconciliation.**
Allow arbitrary typing, diff against last render, classify each changed region
as literal-insert / span-delete / span-reorder / unresolvable, and raise a
conflict UI for the last. Deterministic given a pinned diff algorithm, but the
diff algorithm becomes load-bearing and the edge cases are numerous. A later
increment on top of R3, not a starting point.

Scoring against the charter:

| | P1 controls | P2 bidirectional | P5 docs | P6 testable |
|---|---|---|---|---|
| R1 | ✔ | ✘ intent unmet | partial | ✔ |
| R2 | ✔ | ✔ literal | ✘ | ✘ no oracle |
| **R3** | ✔ | ✔ | ✔ **uniquely** | ✔ |
| R4 | ✔ | ✔✔ | ✔ | ✔ with pinned diff |

R3 dominates rather than merely winning on aggregate. The P5 column is the
reason: span attribution is what lets a user hover a *rendered fragment* and
see which placeholder produced it. Documentation-on-output is only reachable if
the span table exists, so the same mechanism pays for P2 and P5 at once, and
the F-4 finding (operators wrap values) means a span *tree* rather than a flat
list is needed regardless.

Generalization check: the justification does not depend on git-specific shape.
Span attribution is the general technique for bidirectional template editing.

**Needed from you:** ratify R3, or overrule toward R2/R4.

---

## 5. Architecture (contingent on D-1)

**The registry is the single source of truth.** `evidence/registry.json` is
generated by probe, then hand-annotated with documentation prose, control kind,
and parameter schema. From that one artifact, four consumers are generated:

1. the control set in the configurator (P1)
2. the tooltip / drill-down documentation (P5)
3. the simulator's node handlers (P6)
4. the differential test matrix (P6)

A build-time totality check asserts the four are in bijection. A placeholder
present in the registry but lacking a handler, a doc entry, a control, or a
test case **fails the build**. This turns "full coverage" from a claim into a
checked property, and it is how P4 gets audited rather than asserted.
Placeholders deliberately out of scope are marked `unimplemented` with a
reason and surfaced in the UI as such — the classification stays total, with
no catch-all bucket and no silent omission.

**Template grammar** (two node arities, per F-4):

```
Template  := Node*
Node      := Literal | Value | Operator
Value     := '%' short | '%(' name (':' opts)? ')'
Operator  := Pad | Wrap | Color        -- modifies subsequent rendering
Pad       := '%<' | '%>' | '%>>' | '%><' ('|')? '(' N (',' trunc)? ')'
Wrap      := '%w(' N (',' i1 ',' i2)? ')'
Color     := '%C' name | '%C(' spec ')'
```

**Dual target (P3).** One HTML/TS frontend, two hosts. The desktop host is not
mere packaging: it can shell out to real git, so it offers a **real-git mode**
alongside simulation, pointed at the user's own repository. The browser build
is simulation-only. This makes the desktop app a live instance of the same
differential harness the test suite runs — the tool dogfoods its own oracle.
Host choice is D-3.

---

## 6. Test architecture (P6)

Two oracles, deliberately separated because they fail differently.

**Oracle A — byte differential.** `simulate(template, commit) ≡ git log` bytes,
run in Node against the fixture. Fast, exhaustive over the 1,771-vector corpus,
extended to full coverage of the control registry by the totality check in §5.
Binary comparison only.

This is also the answer to F-6. We do not need to know git's exact truncation
rule, and given the overshoot behaviour we should not pretend to. We need our
implementation to agree with git across a corpus dense enough that agreement
generalizes — hence the `N = 1..40` sweep across three subject shapes rather
than a handful of spot checks.

**Oracle B — visual.** The UI's preview panel, screenshotted under Playwright,
against a reference terminal rendering of *real git's* bytes. Note that this is
not redundant with Oracle A: if Oracle A passes, the byte streams are already
identical, so Oracle B is not re-testing byte fidelity. It tests that **our UI
renders those bytes faithfully** — that the preview does not drop an SGR
attribute, mis-compute a column, or mangle a wide glyph. That is a distinct
failure class, and it is the class F-5 and F-6 live in. Oracle B therefore
runs on a narrow, visually-interesting subset: colour attributes, padded
columns, CJK/emoji width, `--graph` glyphs.

**Prerequisite, per standing halt policy.** Oracle B requires Playwright plus
browser binaries, which are not present in this environment. `cdn.playwright.dev`
and the npm registry are reachable, so it is installable. I am stating this as a
gate rather than a footnote: **UI implementation should not begin until Oracle B's
harness is standing and green on a trivial case.** If that install turns out to
be blocked, I will stop and say so rather than build UI against a missing
verification surface.

---

## 7. Glossary (seed)

Terms are bound once, at the site where the ambiguity first surfaced.

| term | binding | definition |
|---|---|---|
| **placeholder** | §2 | a `%`-introduced token in a pretty format |
| **value placeholder** | F-4 | placeholder that produces output from commit data |
| **operator placeholder** | F-4 | placeholder that modifies rendering of subsequent nodes and produces no output itself |
| **template** | §5 | the full format string; a sequence of nodes |
| **span** | D-1/R3 | an output byte range paired with the template node that produced it |
| **span table** | D-1/R3 | the tree of spans for one render of one commit |
| **simulator** | §6 | the reimplementation of git's formatter that runs in-browser |
| **real-git mode** | §5 | desktop-only mode where output comes from the host git binary |
| **oracle A / oracle B** | §6 | byte-differential / visual-differential test oracles |
| **vector** | §3 | one (argv, response-bytes) pair in the golden corpus |
| **coverage gap** | §3 | a registry entry with no test vector, declared explicitly and build-failing |
| **display column** | F-5, F-6 | terminal cell count; excludes SGR bytes; wide chars occupy 2 |

---

## 8. Open decisions (as of v0.1.0 — superseded, retained for provenance)

The text of §8 in v0.1.0 is retained in that file. All four decisions it raised
are ruled below.

---

## 9. Decision record (ratified 2026-09-09)

**D-1 — reverse-propagation semantics. RULED: R3, span-attributed structured
preview.** Accepted as recommended. Consequences now binding:

- The renderer emits a span *tree* (not a flat list — operator placeholders
  wrap value placeholders, per F-4) alongside every render.
- Preview edits are operations over spans: delete, insert-literal-between,
  reorder, edit-within-literal.
- An edit landing inside a value span is never inferred. It surfaces a explicit
  choice: convert the span to a literal, or revert. This is the determinism
  doctrine applied at the one point where the naive design would have guessed.
- Span attribution is also the mechanism for P5 documentation-on-output: hover a
  rendered fragment, see its originating placeholder. One mechanism, two
  purposes.

**D-2 — coverage target. RULED: coverage is bounded by verifiability.** The
acceptance criterion is not a placeholder headcount. Every control in the
registry must carry a test proving that changing it propagates to the preview.
A control whose propagation cannot be verified does not ship.

This makes the §5 totality check the release gate rather than a build hygiene
nicety. Restated as the binding rule:

> For every control `c` in the registry there exists a test `t(c)` that
> perturbs `c` and asserts an observable change in preview output. Registry
> entries without such a test fail the build. Placeholders deliberately out of
> scope are marked `unimplemented` with a reason and surfaced as such in the
> UI — the classification remains total, with no catch-all and no silent
> omission.

Note the interaction with F-6: a control whose only effect is sub-column
truncation behaviour on wide glyphs is *verifiable* (Oracle A pins it against
the corpus) even though its rule is not statable. Verifiability is the bar, not
explicability.

**D-3 — desktop host. RULED: Electron.** Chosen on the Oracle B interaction,
not on binary size. Tauri's system webview would mean CI validates a Chromium
render on Linux while a macOS user receives a WebKit render — the visual oracle
would be certifying a surface that does not ship. Electron's bundled Chromium is
the same engine Playwright drives, so screenshots verify what users see.

Cost accepted: ~230 MB runtime. Consequence: `electron` and `@playwright/test`
are version-pinned exactly, and bumping either requires regenerating Oracle B
baselines in the same commit.

**D-4 — naming. STILL OPEN.** No name chosen. Working identifier is
`gitlog-format-tool`; the package name is a placeholder, not a decision.

**D-5 — signed-commit coverage. DEFERRED, tracked.** Generate a throwaway GPG
key during fixture build so `%G*` becomes observable. No external dependency;
gpg 2.4.4 is present.

---

## 10. Gate status

**Oracle B harness: PASS.** The §6 commitment was that UI work does not begin
until the visual oracle is standing and demonstrated capable of failing.

```
[PASS] IDENTITY  (must be 0)   differing_pixels=0     (800x573)
[PASS] MUTATION  (must be >0)  differing_pixels=46    (800x573)
[PASS] SGR-DROP  (must be >0)  differing_pixels=330   (800x573)
```

Environment probed rather than assumed; see `environment-requirements-v0.1.0.md`.
Nothing blocking. One optional egress ask (`storage.googleapis.com`) buys
Firefox/WebKit coverage; without it Release 1 declares Chromium-family scope in
the registry rather than leaving the limitation implicit.

**Next gate, before UI:** the registry must be hand-annotated (control kind,
parameter schema, documentation prose) over the 111 probed placeholders, and the
totality check implemented, since D-2 makes that check the release gate.
