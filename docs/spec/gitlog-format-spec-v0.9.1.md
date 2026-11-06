# logknobs — Specification v0.9.1

Status: **v0.9.1 — the fifteen items implemented (app v0.4.0) and gated.**
Supersedes v0.9.0 (checkpoint 1), retained. New: §49–§56; corrections to §38
are marked in place. Carried text has been converted to American spelling
(§46); history files keep their original text unaltered.

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
is a near-neighbor but not a superset. A tool that offered `%(if)/%(then)`
conditionals would be shipping a feature git does not have.

**F-2 — `%(ahead-behind:…)` is also `for-each-ref`-only on 2.43.** I expected
this one to work. It does not. This is the concrete case for version-binding:
the registry is valid *for a git version*, and the tool must detect the host
git version and degrade the control set accordingly rather than assume.

**F-3 — Color placeholders emit nothing without a TTY.** `%Cred` produces
empty output under `--color=never` (the non-TTY default) and `\x1b[31m` under
`--color=always`. Consequences: (a) every differential run must pin
`--color=always` or the oracle silently compares two colourless strings and
passes vacuously; (b) color is a tri-state (`auto`/`always`/`never`) that the
tool must model as an enumeration, not a boolean.

**F-4 — Padding and wrapping are operators, not values.** `%<(20)` alone
expands to empty; it modifies the *next* placeholder's rendering. My first
probe tested them in isolation and misclassified them as inert. The template
grammar therefore has two node kinds with different arity, and the simulator
cannot be a flat token→string map.

**F-5 — Padding counts display columns and excludes SGR bytes.**
`%<(20)%C(always,red)%s%Creset` on subject `fix typo` yields
`ESC[31m` + `fix typo` + 12 spaces + `ESC[m`. The escape sequence contributes
zero columns, and the pad spans across the color placeholder.

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
spaces of the pad/wrap/color operators. This is the denominator for P4 and it
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
function. Committing to it would put a nondeterministic component at the center
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
rule, and given the overshoot behavior we should not pretend to. We need our
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
runs on a narrow, visually-interesting subset: color attributes, padded
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
truncation behavior on wide glyphs is *verifiable* (Oracle A pins it against
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


---

## 11. Registry and the D-2 totality gate

**Directive, not instance.** The probe emits *instances* — concrete
parameterizations it executed. `%C(bold)` and `%C(226)` are two instances of one
directive. Coverage is defined over directives × parameter space, because an
instance count overstates coverage: a green `%C(bold)` vector says nothing about
`%C(#ff8800)`. Bound in the glossary.

```
111 probe instances  ->  80 directives  ->  25 controls
```

**Gate T1–T8** (`scripts/build_registry.py`), all PASS except T8 which is
declared PENDING rather than omitted:

| | assertion |
|---|---|
| T1 | every instance maps to **exactly one** directive — zero means undocumented behavior, two means an ambiguous grammar where the UI cannot know which control owns an edit |
| T2 | every directive has a summary and a declared control |
| T3 | no orphan controls (a control editing nothing) |
| T4 | every control's contract is a **setter**, not a toggle |
| T5 | every `mode` parameter is an enumeration, never a boolean |
| T6 | every directive has non-empty corpus evidence, or a **declared** gap reason |
| T7 | classification is total — no catch-all, no residue |
| T8 | every control has a propagation test — **PENDING**, activates with the UI |

T6 is the one that earned its keep. Its first implementation drew examples only
from the `placeholder` corpus family and reported 26 of 80 directives as
uncovered. That was the gate being wrong, not the coverage: F-4 says operators
expand to empty in isolation, so their evidence lives in the `pad`/`wrap`/
`color` families. Evidence attribution is now driven by **tokenizing the format
string** of each vector rather than parsing vector names — names encode sweep
parameters, not tokens. That tokenizer is the seed of the simulator's own lexer.

Two genuine gaps surfaced underneath the gate bug and were closed rather than
declared: the corpus had no `--walk-reflogs` vectors, so all seven `%g*`
directives rendered empty; and the fixture had no explicit-encoding commit, so
`%e` was empty everywhere. Corpus is now **2,022 vectors**.

Two declared evidence gaps remain, and they are in the registry as data:
`%Creset` (emits only a reset sequence, no glyph to sample) and `%n` (expands to
a line feed the extractor strips).

## 12. F-8 — signing breaks fixture determinism

Closing D-5 cost the determinism guarantee. GPG signatures embed a timestamp and
random padding, so a signed commit has an unpredictable OID — and so does
anything downstream of it. Verified: the fixture went nondeterministic, and the
*notes* commit was contaminated too, because it was created after the signed
commit and its tree references HEAD.

Resolution is a **two-layer fixture**:

- **Layer 1, deterministic core** — everything on `main`. OIDs byte-reproducible
  across rebuilds, verified by triple build. Oracle A compares bytes.
- **Layer 2, signature overlay** — an isolated `signed-overlay` branch, built
  last so the core is never its descendant. Nondeterministic by construction.
  `%G*` vectors assert **fields**, not whole-output bytes.

`%G?=G`, `%GS=Fixture Signer <signer@example.org>`, `%GT=ultimate` are now
observed rather than assumed. **D-5 is closed.**

## 13. F-9 — the fixture was committing private key material

While closing D-5, the keyring was initially created at `$DEST/.gnupg`, inside
the repository. The `git add -A` in the signing block then swept the entire
keyring — private keys included — into a commit, and the subsequent
`git checkout main` deleted the working copy. The visible symptom was signatures
verifying as `E` (cannot check) with an empty keyring; the real defect was that
private key material was committed and would have shipped inside any archive of
the fixture.

Fixed by relocating the keyring to a sibling directory outside the repo and
narrowing `git add -A` to the single intended path. Both the symptom and the
leak are asserted against in the build.

The general rule, worth stating because it generalizes past this fixture:
**`git add -A` in a script whose working directory is the repository root is a
data-exfiltration primitive.** It stages whatever the script happened to create
there.

## 14. Gate status at v0.3.0

```
D-2 TOTALITY GATE          T1-T7 PASS, T8 PENDING (activates with UI)
Oracle B harness           PASS  (identity 0px, mutation 42px, sgr-drop 349px)
Fixture determinism        PASS  (core layer, triple build)
Key material leakage       PASS  (no .gnupg paths tracked)
Corpus                     2022 vectors, 0 failed invocations
```

**Next artifact: the simulator**, built against the tokenizer already written
for T6, and validated by Oracle A against the corpus. T8 activates once controls
exist.


---

## 15. The simulator and Oracle A

`sim/simulator.mjs` implements the template engine and emits the span tree that
D-1/R3 requires. Commit records are parsed from **raw objects** via
`git cat-file`, deliberately not via `git log --format=...`: building the
oracle's input with the language under test would make it circular, and a shared
misunderstanding on both sides would cancel out and report green.

### Oracle A result

```
placeholder                   704/704   100.0%
placeholder [host-supplied]   184/184   100.0%
pad                           480/480   100.0%
pad-col                        48/48    100.0%
pad-trunc                     357/360    99.2%
color                          53/54     98.1%
wrap                           33/46     71.7%
ENGINE                       1675/1692   99.0%
```

Host-supplied vectors (decoration, describe, notes, signature, relative dates,
`%S`, `%m`) are counted **separately**. The simulator is handed those values, so
agreement proves placement, not computation; folding them into the headline
would inflate it with vectors that cannot fail.

**T8a PASS** — partial activation of the D-2 gate. All 25 controls, 80/80
directives, are exercised by at least one *passing* vector. T8 proper still
needs the UI.

### F-10 — the truncation rule, derived

F-6 recorded that git's wide-glyph truncation had no statable rule. It has one,
and the sweep yields it: **`trunc` and `ltrunc` are asymmetric.** Right
truncation admits the character that straddles the budget — which *is* the +1
column overshoot F-6 observed — while left truncation does not. Two further
facts, both corpus-derived: once truncation fires git does **not** pad back out
to the width (`%<(3,ltrunc)` yields two columns, not three), and the floor is
the ellipsis itself.

This is not a tidy rule and must not be simplified into one.

### F-11 — %Creset is not exempt from the color mode

Emitting the reset sequence unconditionally was the single defect behind 40 of
54 color failures. Under `--color=never` git emits nothing at all, reset
included. Related: git orders SGR attributes ascending by code with the color
last, regardless of source order — `bold ul italic` → `1;3;4`, not `1;4;3`.

### F-12 — F-4 restated at both ends of the template

A pad directive with no following value placeholder produces **nothing**.
Padding the empty buffer out to the width emitted a phantom run of spaces and
failed 80 vectors. This is the same operator-not-value fact as F-4, at the end
of the format string rather than in isolation.

### F-13 — trailers live in the body's last paragraph

Scanning the whole message parsed the subject of a body-less commit
(`docs: clarify padding semantics`) as a trailer, because it matches
`Key: value`. Trailers are the final paragraph of the **body**, and only when
every line in it is a trailer or a folded continuation. 21 vectors.

### Wrapping, derived

`%w` was 4/46 and is now 33/46, all nine `w=0` vectors exact. Two behaviors
came out of the golden data rather than out of reasoning: at width 0 git indents
without reflowing, and `indent1` applies to the first line of the whole text,
not of each paragraph. The trailing spaces in wrapped output are the tell — a
single source newline becomes a space that is emitted unconditionally, and only
then is the wrap decision made, so a line breaking at a converted newline keeps
a trailing space while one breaking at a source space does not.

---

## 16. Declared unresolved divergence — and why it stays unresolved

All 13 remaining `wrap` failures are **one phenomenon**: git refuses to merge
across a source newline when the following word begins with a wide character,
even when it fits well within the width.

```
want   "    cover"                            got   "    cover 日本語テキスト and 🌍"
       "    日本語テキスト and 🌍 explicitly."
```

At w=60 the merged line would be 24 columns. It fits. git breaks anyway.

I am **not** shipping a rule for this, because the corpus cannot discriminate
between the candidate explanations. All 46 wrap vectors reflow the *same body
text*, varying only `(w, i1, i2)`, and that text contains exactly one
CJK-adjacent newline. Any rule inferred from a single instance is unfalsifiable
against this corpus — I could make all 13 pass by special-casing, and would have
learned nothing about whether the rule is "wide first character", "any non-ASCII
in the word", "wrapper abandons width computation on non-ASCII", or something
else entirely.

**This is a corpus defect, not a simulator defect.** The remedy is a dedicated
wrap sweep over synthetic bodies that isolate the variables independently: line
length, newline position, wide-vs-narrow word at the boundary, words longer than
the width, and mixed-script words. Until that exists, `%w` ships with its
measured 71.7% and the divergence declared — per D-2, a behavior that cannot be
verified does not ship claiming it was.

Two smaller residuals, also declared rather than patched:

- `pad-trunc` 3/360 — `mtrunc` on wide glyphs splits its budget one character
  differently from git. Same discriminator problem at smaller scale.
- `color` 1/54 — `%C(auto)` emits git's default attribute for the *following*
  placeholder. Only the commit-hash default (yellow) is corpus-verified; the
  rest of git's auto-color table is not exercised by any vector.

---

## 17. Gate status at v0.4.0

```
D-2 totality gate       T1-T7 PASS; T8a PASS (25/25 controls, 80/80 directives)
                        T8 PENDING — needs UI
Oracle A                1675/1692 engine vectors byte-exact (99.0%)
Oracle B harness        PASS (identity 0px, mutation 42px, sgr-drop 349px)
Fixture determinism     PASS (core layer, triple build)
Key material leakage    PASS
Corpus                  2022 vectors, 0 failed invocations
```

**Next: the wrap discrimination sweep**, then the configurator UI, at which
point T8 activates.


---

## 18. The wrap discrimination sweep — and what it falsified

§16 declared 13 wrap failures as one phenomenon the corpus could not
discriminate, and named three candidate explanations. The sweep
(`gen_wrap_sweep.py`, 30 synthetic bodies × 2 widths × 2 indent pairs = 120
vectors) was built to make them disagree. It did.

**F-14 — the newline rule is ASCII `isalnum`, not display width.** A source
newline is converted to a space **iff the next character is ASCII
alphanumeric**. Digits and uppercase merge. Everything else forces a hard
break: punctuation (`(`, `-`, `#`, `<`), whitespace, and every non-ASCII
character *regardless of width* — `é` at one column blocks the merge exactly as
`日` does, and `e` + U+0301 combining acute merges because its first byte is
ASCII `e`. Leading ASCII whitespace after a hard break is stripped; consecutive
source spaces are preserved, not collapsed.

The "wide first character" hypothesis — the one I would have shipped had I
special-cased the 13 failures — is **false**. `eacute-after-nl` refutes it in
one vector. This is the whole argument for held-out sweeps in one line.

Result: wrap sweep 120/120, main-corpus wrap 46/46.

## 19. Held-out validation, and the defect it exposed

A 100% score on the corpus a rule was derived from is not evidence the rule
generalizes. The wrap rule had a held-out sweep; the truncation rules did not.
`gen_trunc_sweep.py` sweeps `N=1..40 × {trunc,ltrunc,mtrunc}` over **eight
subjects the simulator never saw** — ASCII, CJK-only, Korean, mixed-script,
accented Latin, emoji-dense.

First run: **853/960**. Every failure emoji-adjacent. The truncation rules
generalized; the **width table** did not — `U+1F680 ROCKET` sits in the
transport block my hand-picked ranges omitted, so the simulator counted it as
one column and git as two. 107 failures, two layers away from a one-codepoint
gap.

Remedy, in two parts:

1. `probe_widths.py` derives the width of every non-ASCII codepoint in every
   corpus **from git** (pad to 10, count the spaces). 65 codepoints; git agreed
   with Unicode East Asian Width data on all 65, rocket included.
2. `gen_width_table.py` **generates** the simulator's table from Unicode 15.0
   data — 121 wide ranges, 356 zero-width — instead of a hand-written list. The
   probe remains as the check that git's table still matches the proxy.

Held-out truncation: **960/960**.

**F-15 — `mtrunc` amended.** Head and tail budgets are fixed independently
(`⌊b/2⌋`, `b−⌊b/2⌋`); the tail does *not* shrink when the head overshoots, which
was the defect. Head uses the permissive straddle rule like `trunc`; tail uses
the strict rule like `ltrunc`. A first attempt made the tail permissive too and
was refuted by `N=3,4,9,10`, where a permissive tail admits the emoji at budget
1. The N=1..40 sweep pinned both halves.

`%C(auto)` also resolved: the auto-colored placeholder is wrapped in its own
reset, so `%C(auto)%h%Creset` emits two.

## 20. Gate status at v0.5.0

```
Oracle A  main corpus           1692/1692  100.0%   (derivation set)
Oracle A  wrap sweep             120/120   100.0%   (held-out)
Oracle A  truncation sweep       960/960   100.0%   (held-out)
Width table vs git                 65/65            (probed)
T8a                               25/25 controls, 80/80 directives
D-2 totality gate                 T1-T7 PASS, T8 PENDING (needs UI)
Oracle B harness                  PASS
Fixture determinism / key leak    PASS / PASS
```

§16's declared divergence is closed. No engine divergence remains declared.

**Next: the configurator UI.** T8 activates.


---

## 21. The configurator

`gitlog-app/` — one HTML source, built by `build.mjs` into a single
self-contained file with the simulator, the generated width table, the
registry and three fixture records inlined. No runtime dependencies. The same
file is loaded by the browser and by the Electron host; the host adds one
capability, **real-git mode**, via a preload bridge that runs
`git log -3 --format=<template>` against a chosen repository.

**The template string is the single canonical state.** Every control *derives*
its displayed value by tokenizing the template and *sets* it by rewriting
nodes. Bidirectional sync is therefore not a synchronization problem at all:
there is one source, every view is a projection, and every edit is a function
`template → template`. Typing into the template field re-derives all 25
controls; changing a control rewrites the template and re-renders. Determinism
follows from having no second model to drift.

**Controls are generated from the registry**, not hand-built. Enum controls
list their directives; multi controls render a checkbox per directive;
composite controls render a widget per parameter from the directive's schema.
A control added to the registry without a widget fails T8 by construction.

**The preview is span-attributed** (D-1/R3). Hovering a rendered span lights
its token in the template row and shows its documentation; clicking selects it.
Literal spans are editable in place and write back to the template. Value
spans are removable. Operator controls — padding, color, spacing modifier —
apply to the selection. Insertion of literals and escapes goes after the
selection. Reordering by drag is not implemented in v0.1.0 and is declared as
such.

Documentation is registry prose: summary, detail, alternate forms, gotchas,
corpus examples, and declared evidence gaps, shown on hover and on `?`.

## 22. T8 activated — the D-2 gate is fully green

`tests/t8.js` is driven by the registry. For every control and every option:
set it, and assert (a) the template now carries the directive, (b) the preview
text changed against a neutral baseline, and (c) re-deriving the control from
the template reports the value just set. Then template→controls and
preview→template in the reverse direction, and case cycling.

```
T8  139/139 checks   25/25 controls exercised   PASS
```

Two things T8 caught that reading the code did not:

- **`spacing-modifier` was routed to the wrong widget.** The registry
  classifies it `enum` (its options are an enumeration), so the builder gave it
  the generic enum select. It operates on a selection and needs the modifier
  widget. Caught as a 5-second timeout on an option that didn't exist.
- **Wrapping was appended, not prepended.** `%b %w(30,0,0)` wraps nothing.
  Operators must precede what they act on; value directives append. This is
  F-4 again, in the UI's insertion logic.

## 23. Oracle B on the real preview

`tests/oracle_b.js` renders four templates in the configurator — color
attributes, truncated padding, 24-bit color, wrapped CJK body, centered
padding with trailers — and pixel-compares the preview panel against
**real git's bytes** painted through the same renderer and CSS in the same
window. Each case carries a negative control with one SGR sequence stripped.

```
colour-pad-conventional        0px   (negative control 225px)
attrs-rightpad-terse           0px   (373px)
wrap-cjk-verbose               0px   (192px)
trailers-centre-conventional   0px   (666px)
ORACLE B  PASS
```

**F-16 — style is a property of the stream, not of a span.** First run failed
all four. The trailers case failed by *exactly* its negative control, 666px:
the app had dropped one SGR sequence. Cause: ANSI was converted per attribution
span, so `%C(always,magenta)` — its own span — opened a color that was closed
at the span boundary and never reached the trailers text. This is precisely the
defect class §6 predicted Oracle B would catch and Oracle A could not: the
bytes were correct. Fix: one pass over the whole stream records the style in
force at every visible character; attribution spans are then laid over the
visible text and paint runs from that record.

The fourth case then failed at 2728px on identical bytes. The app was showing
its **hover state** — the body span is large enough to sit under the pointer
Playwright left behind. Oracle B compares the resting state, so the harness now
parks the pointer before every capture. A harness rule, not an app bug, and
recorded as one.

Real-git mode verified in the Electron host against the fixture: three commits
returned, status reports the repository path.

## 24. Gate status at v0.6.0

```
D-2 totality gate      T1–T8 ALL PASS   (T8: 139/139, 25/25 controls)
Oracle A               1692/1692 · 120/120 · 960/960 · widths 65/65
Oracle B (real UI)     4/4 at 0px, negative controls all > 0
Real-git mode          PASS
Fixture / key leak     PASS / PASS
```

Declared not-yet-implemented: span reordering by drag (R3 operation 3 of 4);
Firefox/WebKit coverage pending the optional egress ask; `--graph`, `--stat`
and other non-format flags are not yet controls (they are in the corpus's
`flag` family and out of Oracle A's engine scope by declaration).

D-4, the name, remains open.


---

## 25. The options axis

The registry now has a second dimension: **options**, the non-format flags
that change how a template or a built-in renders. Five are in scope —
`--pretty`, `--abbrev`, `--decorate`, `--date`, `--color` — each with a setter
contract, full documentation, and a widget generated from the registry.
**T9** asserts the axis is total (every option has a setter and docs); **T8**
now sweeps every option's value space alongside the controls.

Out of scope by declaration, not omission: *selection* flags (`--merges`,
`--reverse`, `--all`, `--first-parent`) change which commits appear, and *diff*
flags (`--stat`, `--patch`, `--name-only`) append non-format output. Neither
is a formatting concern, and the tool says so.

Two behaviors were probed rather than assumed, and one contradicted the
obvious reading:

- **`--decorate=no` does not suppress `%d`.** Only `full` changes what `%d`
  renders (to full ref names). `no` and `auto` affect the built-in formats
  alone. Two mechanisms that happen to share a flag.
- `--abbrev=N` applies uniformly to `%h`, `%t`, `%p`. Verified at 4 and 16.

Separator semantics are modeled: `tformat:` terminates every entry with a
newline, `format:` separates entries and leaves none after the last. With a
one-commit preview the only visible difference is the trailing newline, so
the terminator is shown as a marker — as **chrome outside the byte stream**
(a class-keyed pseudo-element), after both gates objected to it being inline.

## 26. Built-in formats are not templates

`oneline`, `short`, `medium`, `full`, `fuller`, `reference`, `email`,
`mboxrd`, `raw` — nine built-ins, and none is expressible in the placeholder
language. `medium` emits a conditional `Merge: a b` line; `raw` emits one
`parent` line per parent and the `gpgsig` header verbatim. So the tool gives
them their own renderer, verified byte-exact against the corpus:

```
named-format (built-in renderer)   72/72   100.0%
options (separator, --abbrev)        4/4
```

Evidence-bound details, each fixed by a vector rather than by reading:

- `raw` does **not** emit the `encoding` header. git re-encodes for output
  and drops it. Verified on the explicit-encoding fixture commit.
- The message block is `%w(0,4,4)`-shaped: every line indented four, interior
  blank lines become four spaces, the trailing newline is not indented.
- With a built-in, decoration defaults to `auto`, which is *off* when stdout
  is not a terminal — unlike `%d` in a custom template, which always shows.
- `email` folds ASCII subjects at 78 columns with a one-space continuation and
  RFC 2047 Q-encodes non-ASCII ones into `=?UTF-8?q?…?=` words, starting a
  new word whenever `line + encoded_char + 2` would exceed 76, never splitting
  a UTF-8 sequence. MIME headers appear when the message is non-ASCII. Two
  vectors pinned all of that: `email@verbose` and `email@wide`.

In the configurator, selecting a built-in disables the template field and dims
the controls, since neither applies; the preview switches to the built-in
renderer and the copied command uses `--pretty=<name>`.

## 27. What the gates caught

- **T8:** the terminator marker was appended to the HTML string *after* it had
  been assigned to the DOM — a no-op. Reordered.
- **T8 and Oracle B together:** once inline, the marker was invisible to T8's
  text observation and read as ~20px of divergence to Oracle B. The marker is
  chrome, not output; it moved to a pseudo-element keyed on a class, outside
  the byte stream, so both captures share it and T8 observes the class.
- **T8:** color is a *style* change; `textContent` cannot see it. T8 now
  observes `innerHTML` for the color and pretty options. A gate that cannot
  observe the thing it asserts is worse than none.
- A name collision on inlining (`NAMED` in the simulator's color table and
  in the app) — caught by a syntax check before any gate ran.

## 28. Gate status at v0.7.0

```
D-2 totality gate      T1–T9 ALL PASS   (T8: 165/165; 25 controls, 5 options)
Oracle A               1692/1692 · 120/120 · 960/960 · built-ins 72/72 · options 4/4
Oracle B (real UI)     4/4 at 0px
Real-git mode          PASS (options passed through)
```

Declared, not implemented: span reordering by drag; `--graph` (needs a
topology renderer — the fixture has a merge, so it is verifiable when built);
Firefox/WebKit pending egress. D-4, the name, remains open.


---

## 29. D-4 closed — the tool is **logknobs**

Availability verified, not assumed:

```
npm  logknobs        404  AVAILABLE
github.com/logknobs  404  AVAILABLE
GitHub repo search     0  matches
```

A first check reported the GitHub orgs as taken off an HTTP 403. That was rate
limiting, not existence — an error code misread as a signal. Re-checked against
github.com directly. The singular `logknob` IS taken; the plural is clear.

The name says what you touch. It does not carry the verified-against-git claim,
and that is an acceptable division: the name names the surface, the docs carry
the warrant.

## 30. The brand system

**One geometry, three uses.** `brand/make_brand.py` emits every asset from a
single parametric knob: 270° sweep from −135° (dead zone down, so "off" is
unambiguous), monoline ring at the wordmark's stem weight, ticks on the swept
arc, accent indicator and hub. `brand/assets/brand-tokens.json` is the source of
truth, and **T10 asserts the running UI's sweep constants equal it**. The
wordmark's two o's, the UI's knob controls, and the status gauge are the same
shape at different scales. Divergence between them is a test failure, not a
style drift.

**The letters are set, not drawn.** A first revision hand-rolled monoline glyphs
for l/g/k/n/b/s and produced a broken `k` and an oversized `b` bowl. Drawing a
typeface was scope creep, and badly done scope creep. The word is now set in the
app's own monospace stack — mark and product share a voice, and there is no
webfont payload. Stated rather than hidden: these SVGs depend on a system font.
That is right for web and app use; a path-outlined lockup for print or
embroidery requires choosing and licensing a face, and **is not produced here**.
Shipping a "final" logo with a silent font dependency would be the failure mode.

**Size-aware variants.** Below ~180px the tick ring fills in and renders as
fuzz, so `logknobs-wordmark-small.svg` and `logknobs-mark-small.svg` drop it.
Six assets: wordmark (dark/light/mono/small), mark (ticked/small), favicon.

**Knobs are controls, not ornaments.** Every enum control (14 of 25) and every
enum option (4 of 5) carries a knob: keyboard-operable (arrows/Home/End),
draggable, wheel-adjustable, `role="slider"` with live `aria-valuetext`. Per the
determinism doctrine the knob is defined on an explicit index setter; drag and
keys are defined atop `setIndex`, never the reverse.

**The canonical `<select>` stays in the DOM**, visually hidden. It is what T8
drives and what assistive technology reads. Replacing it outright would have
made 165 propagation checks unable to reach their controls — *a brand change
must not cost verifiability*, and keeping the select is what made T8 pass
unchanged at 165/165 through the whole redesign.

**The status line is a gauge**, because the useful question about a format
string is how close its first line sits to 80 columns, which a character count
does not answer.

## 31. T10 — the knob gate, and what it caught

The knob is a second view over an existing setter, so T8 cannot see it. T10
(32 checks) asserts keyboard, pointer-drag, wheel, geometry-tracks-value,
bidirectional re-render from the canonical select, coverage over every enum
control and option, and geometry parity with `brand-tokens.json`.

**F-17 — re-rendering `innerHTML` destroys focus.** `makeKnob` initially rebuilt
its markup on every update, which discarded the focused element and the active
pointer capture. Exactly one keypress or drag landed; every subsequent one went
nowhere. T10 surfaced it as "ArrowDown retreats: FAIL". The knob now builds its
DOM once and mutates attributes.

One T10 failure was the test's own bug: reading `line:last-of-type` matched the
last *tick* inside the group rather than the indicator, since ticks precede it
in document order. Fixed in the harness, not the app.

## 32. Adobe connector — what it could and could not do

Asked to offload graphics generation and vectorization. Reported plainly rather
than worked around: **the connector cannot generate images in this
environment** — its own routing documentation states generative AI including
text-to-image is unavailable here — and `image_vectorize` requires a raster at a
publicly reachable HTTPS URL, which the container cannot serve. The
generate-then-vectorize path is closed.

This costs nothing. A knob wordmark is pure geometry; authoring SVG directly
beats tracing a raster, which yields wobbly paths and no parametric control.
The connector's font recommender was used for the wordmark typeface and returned
mostly irrelevant groupings (tattoo, gothic, "soothing"); two plausible
candidates were surfaced by metadata only, and no claim is made here about how
either looks, because their specimens were not fetched.

## 33. Gate status at v0.8.0

```
D-2 totality gate     T1–T9 ALL PASS   (T8: 165/165; 25 controls, 5 options)
T10 knob controls     32/32 PASS       (geometry parity with brand-tokens)
Oracle A              1692/1692 · 120/120 · 960/960 · built-ins 72/72
Oracle B (real UI)    4/4 at 0px
Real-git mode         PASS
```

D-4 is closed. Open: span drag-reorder, `--graph`, Firefox/WebKit egress,
path-outlined print lockup.


---

## 34. Restore after workspace loss

The scratch workspace was wiped between sessions; only delivered outputs
survived. Everything was rebuilt from the archives and re-proven before any new
work: every gate green, and `dist/index.html` rebuilt **byte-identical** to the
delivered v0.3.0 (`bc0a3e7a…`). The deterministic fixture core rebuilt to the
same 7 OIDs; the signed-overlay commit differs, as declared in §12.

The restore exposed two latent defects in what had shipped:

- **`vitest@5.0.0` crashes npm's peer resolver** (isolated by single-package
  installs). It was never used by any gate. Removed, with `typescript`, which
  was also never invoked.
- **Four package scripts pointed at paths that never existed** (`tests/differential`,
  `tools/`). They were aspirational entries carried from v0.1.0 that nothing
  exercised. Replaced with scripts that run the real gates. A script nobody runs
  is unverified by construction; `npm run verify` now runs all of them.

## 35. The fifteen items — interpretation, mechanism, gate

Where an item admits more than one reading, the reading taken is stated, so it
can be overruled by name.

| # | item | interpretation | mechanism | gate |
|---|---|---|---|---|
| 1 | save/load/apply templates | user templates persist per viewer; portable as JSON; "apply" loads one into the configurator | local store + export/import file | T13 |
| 2 | preformatted templates from the web | curated presets with recorded provenance, each executed against real git | `presets` registry (§44) | T13 |
| 3 | `--graph` topology + options | graph drawn byte-exact to git, with order, first-parent and column-color options | port of `graph.c` + rev-walk (§41) | Oracle A graph |
| 4 | undo/redo | history of whole-state snapshots, setter-based | `setHistoryIndex` (§37) | T11 |
| 5 | multi-commit history preview with branches/merges | preview mode `history` over branchy sample repos, one per message style | topology fixtures (§41) | Oracle A graph, Oracle B |
| 6 | BNF or block structural tokens between format and preview | both built, chosen by toggle — no clear path, so not resolved by argument | feature-lab-001 (§43) | T12 |
| 7 | drag/drop ordering | reorder nodes in the token view; drag from palette to insert | token view | T12 |
| 8 | global config output | generate `git config` commands and a `.gitconfig` fragment for formats, colors and log defaults, round-tripped through real git | config exporter (§44) | T13 |
| 9 | micro-templates for composite controls | named presets for decoration, describe and trailer option sets | `micro_templates` in registry | T8 v2 |
| 10 | toggles `--graph`, `--oneline` | explicit enum setters; toggles drawn atop them; mutually exclusive pairs enforced | options axis (§37) | T8 v2 |
| 11 | "bgcolor is in default cli colors of cmd/bash/ps" | **read as:** preview background and ANSI palette selectable from the default schemes of real terminals | terminal themes (§45) | Oracle B themes |
| 12 | literal coloring has no effect; color support limited | three causes found by reproduction, plus missing grammar | §40 | Oracle A color-grammar, T8 v2 |
| 13 | denote applicability of padding/color/etc. | every operator shows its scope, as a chip and as a bracket in the token view | `scope` registry field (§38) | T15 |
| 14 | don't be British | American spelling everywhere, enforced | spelling lint (§46) | T14 |
| 15 | only relevant panels usable on selection; insert visibly distinct from modify | three regions: Insert palette, Inspector for the selection, Output options | §39 | T8 v2 |

Item 11 is the one most likely to be misread. If it meant something else, the
theme machinery is still the right substrate and only the default changes.

## 36. Evidence gathered this iteration

**Literal coloring, reproduced** rather than theorized. Three independent causes:

1. Literal spans in the preview were not selectable: the click handler returned
   early for any `contenteditable` span.
2. `--color` defaulted to `never`, under which git correctly emits nothing for
   `%Cred` — so the first visible effect of applying a color was none.
3. Applying a color to one literal colored everything after it: `%Cred` opens a
   color that runs until reset, and the control inserted only the opening
   directive. Asked to color one part, the tool colored the rest of the line.

**Color grammar on 2.43, probed** through both `git config --type=color` and
`%C(...)` in a format (they agree on every case):

| spec | emitted | finding |
|---|---|---|
| `red blue` | `31;44` | **second color is the background** — previously ignored |
| `normal red` | `41` | `normal` = unchanged; this is red background only |
| `default red` | `39;41` | `default` is an explicit reset to the default color |
| `nobold`, `no-bold` | `22` | negation exists, both spellings |
| `bold nobold` | `1;22` | both emitted, in source-independent order |
| `#ff8800 #001122` | `38;2;255;136;0;48;2;0;17;34` | 24-bit foreground and background |
| `#f80` | **fatal** | short hex rejected on 2.43 |
| `red blue green` | **fatal** | a third color aborts the whole `--format` |

The online git-config reference reports itself as **git 2.56**; the binary here
is **2.43**. The docs and the binary disagree at least on short hex. The registry
stays bound to what 2.43 does, established by probing. An invalid spec does not
render wrongly in git — it aborts `git log` — so the tool must reject it, not
render a guess (§40).

**Graph and decoration**, probed: the `*` commit marker is uncolored; only edge
characters carry column colors. Column colors advance at merges, one per parent.
Graph lines are padded to the graph's width with significant trailing spaces.
`%d` is colored only after `%C(auto)`, even under `--color=always`; under
`%C(auto)` the punctuation takes the commit color and each ref its slot color,
and `color.decorate.<slot>` overrides the slot. `--reverse` with `--graph` is
fatal.

**Sources that could not be reached**, recorded rather than worked around:
Stack Overflow (site blocked to the fetch tool), `gist.github.com` (outside the
egress allowlist), and the git-config reference (truncated before the variable
section). Details in `research/provenance.json`.

## 37. State, history, and toggles

**One canonical state.** The template string remained the single source for
the entry's structure in v0.8.0. v0.9.0 widens the canonical state to
`{ template, options }`, where `options` holds every output setting. The
selection is view state and is not part of it.

**Undo/redo is a history of canonical states, defined on a setter.**
`setHistoryIndex(n)` restores snapshot `n`; undo and redo are defined atop it as
`setHistoryIndex(i−1)` and `setHistoryIndex(i+1)`, never the reverse. Every
mutation commits one snapshot. Consecutive template keystrokes coalesce into one
snapshot within `history.coalesce_ms`; the stack is bounded by `history.limit`.
Both are configuration keys, not constants. Committing after an undo truncates
the redo branch, which is the conventional and least surprising behavior.

**Toggles are enumerations with setters.** `setGraph(mode: 'off'|'on')`;
`setOneline(mode: 'off'|'on')` is a view over `pretty` — on sets `oneline`, off
restores the format that was active before. `setOrder(mode: 'default'|'topo'|
'date'|'author-date')`, `setFirstParent(mode: 'off'|'on')`. Pairs git rejects
are enforced at the setter: turning `--graph` on clears `--reverse`, and the
reverse. A toggle is drawn atop its setter; nothing is defined as "flip".

**Preview modes** form an enumeration: `single` (one commit of the chosen case)
and `history` (a walk over a branchy sample repository). The case selector keeps
its meaning in both: in `history` mode it selects which sample repository —
terse, conventional or verbose — and all three share one topology.

## 38. Scope — what each operator applies to

Every directive gains a `scope`, from a closed set. Classification is total:
a directive without a scope fails the registry build (gate T15).

| scope | meaning | directives |
|---|---|---|
| `self` | renders its own text only | every value placeholder, literals, escapes, spacing `%+X %-X % X` |
| `next-placeholder` | pads everything from here through the next value placeholder, as one unit | padding `%<(n)` family |
| `until-reset` | applies to everything after it until a reset | `%C(...)`, `%Cred` and kin |
| `until-next-wrap` | applies to everything after it until the next `%w` | `%w(...)` |
| `entry` | applies to the whole entry | `--pretty`, `--date`, `--abbrev`, `--decorate` |
| `output` | applies to the whole output | `--graph`, `--color`, order, first-parent |

The scope is shown in two places: as a chip on the control ("applies to: the
next placeholder — `%an`") and as a bracket in the token view drawn over exactly
the nodes it affects. The bracket is the stronger signal, because it shows the
consequence rather than describing it.

## 39. Insert, edit, output

The v0.8.0 controls conflated two different operations: a control set "its"
directive wherever it was in the template, or appended it if absent. Adding a new
part and changing an existing part looked the same. v0.9.0 separates three
regions with three visibly different treatments:

- **Insert palette** — adds a new part. Every directive is a chip marked `+`.
  Click inserts after the selection (or at the end); drag places it anywhere in
  the token view. Nothing in the palette modifies an existing node.
- **Inspector** — edits the selected node. It shows only the sections that apply
  to the selection's kind; inapplicable sections are not merely dimmed but
  absent, with a one-line statement of why. With nothing selected the inspector
  says so and offers nothing to edit.
- **Output options** — global settings, labeled as global, with the `output`
  and `entry` scope chips.

Applicability by selected node kind:

| selected | variant (swap within control) | parameters | color | padding | spacing modifier | wrap |
|---|---|---|---|---|---|---|
| value placeholder | yes | if composite | yes | yes | if single-letter | — |
| literal | — | edit text | yes | — | — | — |
| color directive | — | its spec | edits itself | — | — | — |
| padding directive | — | width, truncation | — | edits itself | — | — |
| wrap directive | — | width, indents | — | — | — | edits itself |

## 40. Color, fixed

- The color operation gains a scope parameter, an enumeration:
  `this-part` (default) wraps the selection — `%C(spec)` before it and `%Creset`
  after — and `from-here` inserts only the opening directive, git's raw
  semantics. The token view brackets whichever range results.
- The preview's color mode defaults to `always`. The copied command still
  carries `--color` only when it differs from git's own default, so the
  configurator showing color does not change the command a user runs.
- Literal spans are selectable in the preview; editing their text is a
  double-click, so selection and text editing no longer collide.
- `sgr()` implements the probed grammar: background as the second color,
  negated attributes, `normal` and `default`, 256-color and 24-bit for both
  layers. Invalid specs — short hex on 2.43, a third color — are flagged as
  errors on the node, matching git's refusal to run.

## 41. Graph and history

The preview's `history` mode walks a sample repository and draws the graph. The
renderer is a port of git's `graph.c` state machine (padding, skip, pre-commit,
commit, post-merge, collapsing), together with the parts of `log-tree.c` that
interleave a multi-line entry with graph lines and place terminators and
separators. Order follows git: `--graph` implies topological order with a LIFO
frontier; `--date-order` and `--author-date-order` use date-keyed priority.

Like truncation and wrapping before it, the port is judged only by a golden
corpus, not by reading. Three topology fixtures share one shape — forks, a
two-parent merge, an octopus merge, a branch that merges `main` back into itself
so lines cross, a second root, tags and a remote-tracking ref — and differ only
in message style. The corpus sweeps templates of one, two and variable line
counts, both terminator modes, color on and off, custom `log.graphColors`, and
each order mode.

**Result.** 444/444 vectors byte-exact (graph 330, graph-colors 9,
graph-builtin 90, history 15). Two defects were found by the corpus on the way,
not by review:

- `--first-parent --all` ordered a branch tip wrongly. `sort_in_topological_order`
  counts and releases over a commit's *full* parent list even when only first
  parents are walked; the port had used the first-parent view.
- `--pretty=oneline` was conflated with `--oneline`. The shorthand adds
  `--abbrev-commit`; the long form shows full hashes. The v0.8.0 built-in family
  ran only under `--color=never`, which also hid that git colors `commit ` and
  the hash together. The family now runs under both color modes.

**Held-out.** Because the walk fix was derived from the 444-vector corpus, that
score does not show generalization. Six seeded random repositories
(`gen_random_topology.py`, seeds 7 11 23 42 101 2026; 39–54 commits; up to 11
simultaneous columns; octopus merges of up to five parents; criss-cross merges;
every seed cycles into the bold half of the column palette) give 192 vectors
never used for derivation: **192/192** byte-exact, first run, no changes.

## 42. Decoration, computed

v0.8.0 took decoration strings from the host. v0.9.0 splits the job: the *set
and order* of refs on a commit comes from git (`--decorate=full`), and the
*rendering* — short or full names, punctuation, `%(decorate:…)` options, and
coloring under `%C(auto)` with `color.decorate.<slot>` — is computed and
verified. Which half is host-supplied is declared, so Oracle A counts only the
computed half as engine coverage.

A dedicated corpus (`gen_decoration_corpus.py`, 144 vectors) sweeps `%d`, `%D`,
`%(decorate)` with and without options, short and full names, both color
modes, every `color.decorate.<slot>` in use by the fixture, and
`color.diff.commit`, plus `--oneline` and medium with `--decorate`. First run:
112/144. Two defects, both fixed:

- Config variable names are case-insensitive: `color.decorate.head` and
  `color.decorate.HEAD` are the same setting. The port matched case.
- `%(decorate:…)` option values honor `%xNN` escapes (`separator=%x7C` is `|`).
  The port passed them through literally.
- (Found alongside) the built-in header ignored `color.diff.commit`; fixed.

After: **144/144**. With rendering computed, `%d`, `%D` and `%(decorate…)` move
out of the main corpus's host-supplied bucket into ENGINE: ENGINE 1692 → 1724
vectors, host-supplied 184 → 152, all passing.

## 43. feature-lab-001 — the token view

The request was for "BNF or block style" structural tokens. There is no clear
basis for choosing by argument, so both are built and compared:

- `blocks` — each node a chip, operators drawn as brackets over the range they
  affect, drag to reorder.
- `bnf` — each node shown as an instance of its grammar production
  (`value⟨%an⟩`, `pad⟨<,14,trunc⟩ value⟨%an⟩`), nested to show scope.

Isolation follows the standing mechanism: each option is a function in a
toggle table taking an extension point; the core receives `document` and the
selected option function as parameters and cannot reach the other option. The
lab code shares nothing with the core except that interface.

## 44. Templates and config export

**Presets** carry a provenance class from a closed set:
`verbatim` (exact bytes obtained from the source), `verbatim-reassembled` (exact,
but delivered in pieces — the join is the risk), `after-source` (reconstructed
from a described structure because the source was unreachable), `built-in`
(git's own flags, no format string) and `original` (written here). Every preset,
whatever its class, is executed against real git on the sample repositories by
gate T13; a preset git rejects does not ship.

**User templates** — save, load, rename, delete, apply — persist per viewer and
export or import as a JSON file. A template is the canonical state
`{ template, options }` plus a name.

**Config export** emits `git config` commands and a `.gitconfig` fragment:
`pretty.<name>`, `format.pretty`, `log.date`, `log.decorate`, `log.abbrevCommit`,
`log.graphColors`, `color.ui`, `color.decorate.<slot>` and an alias. Escaping
crosses two layers — the config parser, then git's alias splitter — so T13 writes
the fragment to a scratch config and confirms git reads back the exact template.

## 45. Terminal themes

The preview background and ANSI palette are selectable from the built-in schemes
of Windows Terminal, taken from its `defaults.json` (hash recorded in
`research/provenance.json`), not from memory. One correction found on the way:
Windows Terminal's PowerShell and Command Prompt profiles both default to
**Campbell** (`#0C0C0C`). The blue `#012456` is the separate "Campbell
Powershell" scheme — the legacy console look, not Windows Terminal's default.
Shells have no colors of their own; bash inherits whatever terminal hosts it. The
selector is labeled by terminal scheme, not by shell, for that reason.

## 46. Spelling

American spelling throughout, enforced by gate T14 over the built app, its
sources, the spec and the READMEs — code comments included. The lint uses an
explicit table rather than a rule, because "-our → -or" would also rewrite
"four", "hour", "our". URLs and code spans are exempt.

One declared exemption: recorded evidence (`evidence/*.json` corpora and
registries from earlier versions) keeps the labels it was generated with, such
as vector names containing `centre`. Those files are measurements; rewriting
them would break the rule that delivered evidence is never overwritten. The
generators that produce them are fixed, so every corpus generated from v0.9.0
on is clean. At checkpoint 1 the simulator and scripts are clean (42 fixes,
including the pad mode enum `centre` → `center`); the app is not yet.

## 47. Gates added

| gate | asserts |
|---|---|
| Oracle A color-grammar | every probed color spec renders byte-exact, invalid specs rejected |
| Oracle A graph | byte-exact `--graph` output across topology fixtures, templates and options |
| Oracle A graph held-out | byte-exact on seeded random repositories never used for derivation |
| Oracle A decoration | computed decoration rendering and coloring byte-exact |
| T8 v2 | every directive insertable, every parameter editable, every option settable, inspector shows only applicable sections |
| T11 | undo/redo restores exact prior states; redo branch truncation |
| T12 | drag reorder and palette drag-insert in both feature-lab-001 options |
| T13 | every preset runs on real git; save/load round-trip; config export round-trips through git |
| T14 | zero British spellings |
| T15 | scope classification total over the registry |
| Oracle B graph/themes | history-mode preview with graph is pixel-exact against real git in each terminal theme |

## 48. Gate status at v0.9.0, checkpoint 1

This checkpoint ships the evidence and simulator work. The UI work (§37–§40,
§43–§45 as implemented in the app) is not in it; gates that judge the app are
re-run to show nothing regressed, and the new app gates (T8 v2, T11–T15,
Oracle B graph/themes) are not yet built.

```
Oracle A  main corpus          ENGINE 1724/1724 · host-supplied 152/152 · T8a PASS
          built-ins 72/72 · options 4/4
          color grammar        210/210
          graph & history      444/444
          graph held-out       192/192   (seeded random DAGs, never derived from)
          decoration           144/144
          wrap sweep           120/120
          trunc sweep          960/960   (held-out)
App (v0.8.0, unchanged)        T8 · T10 · Oracle B · real-git preview — re-run, see gate report
```

**Correction (v0.9.1).** The v0.9.0 table put spacing modifiers under
`next-placeholder` and described padding as "modifies the next value
placeholder". Both were wrong. A spacing modifier is part of its placeholder's
own token (`%+b` is one part), so it is `self`. Padding buffers everything
after it — literals and colors included — through the next value placeholder
and pads that buffer as one unit; that is what `render()` does and what the pad
corpus families verify. The table above is corrected; the token view brackets
follow the corrected rule.

## 49. What v0.9.1 built

App v0.4.0 implements §37–§45. Each of the fifteen items, with the gate that
judges it:

| # | item | implemented as | gate |
|---|---|---|---|
| 1 | save / load / apply templates | saved list per viewer (browser storage), rename, delete, JSON export/import | T13 |
| 2 | preformatted templates | 14 presets in five provenance classes (§44), each executed by real git | T13, Oracle A presets |
| 3 | `--graph` topology | graph.c port in the history preview; `log.graphColors` | Oracle A graph, Oracle B history |
| 4 | undo/redo | `setHistoryIndex`; coalescing and limit are config keys | T11 |
| 5 | multi-commit history with branches and merges | history preview over three topology repositories (octopus, criss-cross, orphan) | Oracle A graph, Oracle B |
| 6 | BNF or block tokens | feature-lab-001: `blocks` and `grammar` views, closure-isolated | T12 |
| 7 | drag/drop ordering | both views; drag from Insert; Alt+←/→; refusal of merging moves | T12 |
| 8 | global config output | `.gitconfig` fragment and `git config` commands, round-tripped through git | T13 |
| 9 | micro-templates | decoration ×6, describe ×4, trailers ×5, in Insert and in Edit selected | T8 v2, Oracle A micro-template |
| 10 | toggles | `--graph --oneline --all --first-parent --reverse` atop enum setters | T8 v2 |
| 11 | terminal default colors | 16 Windows Terminal schemes + a house theme; default Campbell | T8 v2 themes, Oracle B themes |
| 12 | literal coloring; color support | §40, all three causes fixed; full 2.43 grammar | T8 v2 color, Oracle A color |
| 13 | denote applicability | scope chips on every section and option; brackets / indentation in the parts view | T8 v2 scope, T12, T15 |
| 14 | American spelling | lint over app, sources, tests, simulator, scripts, spec | T14 |
| 15 | only relevant panels usable; insert distinct from modify | Insert / Edit selected / Output, visibly different; inapplicable sections absent and named | T8 v2 applicability |

## 50. Defects found by the new corpora

Each found by a vector, not by reading.

- **Tokenization.** `%ndate` was read as an unknown `%nd` followed by `ate`,
  and printed literally. git reads `%n` then `date`: two-letter placeholders
  exist only in the `a`/`c` (ident, date) and `g`/`G` (reflog, signature)
  families. Found by the `smartlog` preset, the first template in any corpus to
  put a letter straight after `%n`. A sweep of every letter after `%` followed
  by every letter and `?` (52 vectors × 53 continuations) now judges the
  tokenizer: 52/52.
- **`%S` is walk-dependent.** It names the ref a commit was reached by. With
  HEAD only it is `HEAD`; under `--all` it is the first ref (for-each-ref order,
  then HEAD) whose walk reached the commit. The simulator took it from the
  record, which is right only for the walk the record was captured with. It is
  now computed in the walk, as revision.c does: 15/15 across five walks.
- **`--date=relative` and `human`** fell through to the default format in the
  simulator. They are clock-dependent and now host-supplied like `%ar`, through
  one ident helper used by `%ad`, `%cd` and the built-ins.

## 51. Defects found by the new gates

- **Layout shift under the pointer.** The documentation pane resized with its
  content, so hovering a preset moved the preset list and the next click
  missed. T13 timed out on it. The pane now has a fixed height.
- **Bracket labels sized the grid.** Scope labels in the blocks view widened
  their columns until the row scrolled; T12's long drags then landed on the
  wrong part. Labels are now out of flow and clipped, with the full text on hover.
- **Padding directives could not edit themselves.** §39's table says a selected
  padding directive edits its own width and truncation. The first build routed
  that through the placeholder it pads, and the first T8 v2 expectation was
  written from the build instead of from the table, so it agreed. Found by
  reading a screenshot against §39. The expectation is now taken from the table;
  the directive edits itself; T8 asserts it, and does the same for `%w`.
- **Real-git newline.** Real-git history mode dropped git's final newline; the
  simulated history keeps it. Both now show git's bytes as they are.

## 52. Oracle B: what changed in the method

Oracle B paints git's bytes as the reference. In v0.8.0 the reference was
painted as one stream; the app's preview wraps attribution spans around parts.
In history mode the two differed by 157–239 px — sub-pixel glyph placement at
run boundaries, with identical text. The reference is now painted with the
**same span boundaries** the app used (`paintSegs`, shared). This is a
commitment, stated: the comparison no longer measures the effect of run
splitting on anti-aliasing, which is not a property of the bytes. It still
measures every byte: if git's bytes differ from the simulator's, the text, the
colors and their positions differ, and the negative controls (one SGR sequence
stripped, 61–750 px) show the comparison can see a single attribute.

## 53. Presets — what is and is not known

`lg`, `hist`, `lp`, `ld`, `ls` are verbatim from their sources; `smartlog` is
verbatim but delivered by its source in pieces. `lg1`–`lg3` are **after-source**:
the Stack Overflow answer they come from is unreachable here, and the formats
shipped were written after the structure that answer is known for. They are not
claimed as its bytes. `columns` and `conventional` are original. Every preset,
whatever its class, runs on real git against all three sample repositories and
the preview matches git byte for byte (T13, 42/42).

## 54. Decisions taken without asking

- **`--color` and `--decorate` gained git's real default, `auto`.** The preview
  is a terminal, so `auto` shows color and short decorations; the copied
  command omits both flags. This replaces v0.9.0 §40's "preview defaults to
  always", which would have put `--color=always` into every copied command.
- **PowerShell quoting is offered but not executed by a gate** (no pwsh in the
  workspace). bash quoting is executed by T13. cmd.exe is not offered: `%`
  behaves differently at the prompt and in batch files.
- **Colors `this part` closes with a matching reset**: `%C(always,red)` closes
  with `%C(always,reset)`, because `%Creset` emits nothing under
  `--color=never` and the color would run to the end of the line in a pipe.
- **Escapes have no "form"**: `%n`, `%%` and `%xNN` share a control but are not
  alternative forms of one field, so Edit selected offers no swap among them.

## 55. Gate status at v0.9.1

```
Oracle A  main corpus          ENGINE 1724/1724 · host-supplied 152/152 · T8a PASS · built-ins 72/72 · options 4/4
          color grammar        210/210
          graph & history      444/444
          graph held-out       192/192
          decoration           144/144
          tokenize + %S         67/67
          presets + micro      201/201   (14 presets, 15 micro-templates, --reverse, relative/human dates)
          wrap / trunc         120/120 · 960/960
Registry  T1–T7 T9 T13 T15     PASS; regenerated byte-identical
App       T8 v2 457/457 · T10 47/47 · T11 12/12 · T12 165/165 · T13 121/121 · T14 0 British
          Oracle B 21/21 (single + history, five themes) · real git 7/7
```

## 56. Not done

- No gate executes the PowerShell quoting (§54).
- The history preview shows at most `preview.history.max_commits` (40)
  commits; the sample repositories have 18, so the cap is never reached there.
- Real-git mode runs in the desktop build only; the browser build cannot run git.

## Glossary additions (v0.9.1)

| term | binding | definition |
|---|---|---|
| **part** | §39 | one node of the template: a literal, a placeholder, or an operator |
| **production** | §49 | a part's grammar category in the `grammar` view: literal, value, modified-value, color, pad, wrap |
| **walk source** | §50 | the ref a commit was reached by in a walk; what `%S` prints |
| **refusal** | §49 | an edit not applied because git would read the result differently than intended |
| **run structure** | §52 | how painted text is split into elements; shared by preview and Oracle B reference |

## Glossary additions (v0.9.0)

| term | binding | definition |
|---|---|---|
| **canonical state** | §37 | `{ template, options }`; every view is a projection of it |
| **scope** | §38 | the range of output an operator affects, from a closed set |
| **insert** | §39 | adding a new node; never changes an existing one |
| **inspector** | §39 | the region that edits the selected node |
| **preview mode** | §37 | `single` or `history` |
| **topology fixture** | §41 | a deterministic branchy sample repository |
| **provenance class** | §44 | how exactly a preset's bytes are known |
| **terminal theme** | §45 | a terminal's background, foreground and 16-color palette |
