# git-log Format Tool — Specification v0.7.0

Status: **built-in formats and the options axis delivered, all gates green**.
Supersedes v0.6.0, retained. New: §25 the options axis and the second
registry dimension, §26 the built-in formats and why they are not templates,
§27 what T8 and Oracle B caught this iteration.

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
| T1 | every instance maps to **exactly one** directive — zero means undocumented behaviour, two means an ambiguous grammar where the UI cannot know which control owns an edit |
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

### F-11 — %Creset is not exempt from the colour mode

Emitting the reset sequence unconditionally was the single defect behind 40 of
54 colour failures. Under `--color=never` git emits nothing at all, reset
included. Related: git orders SGR attributes ascending by code with the colour
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

`%w` was 4/46 and is now 33/46, all nine `w=0` vectors exact. Two behaviours
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
measured 71.7% and the divergence declared — per D-2, a behaviour that cannot be
verified does not ship claiming it was.

Two smaller residuals, also declared rather than patched:

- `pad-trunc` 3/360 — `mtrunc` on wide glyphs splits its budget one character
  differently from git. Same discriminator problem at smaller scale.
- `color` 1/54 — `%C(auto)` emits git's default attribute for the *following*
  placeholder. Only the commit-hash default (yellow) is corpus-verified; the
  rest of git's auto-colour table is not exercised by any vector.

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

`%C(auto)` also resolved: the auto-coloured placeholder is wrapped in its own
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
spans are removable. Operator controls — padding, colour, spacing modifier —
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

`tests/oracle_b.js` renders four templates in the configurator — colour
attributes, truncated padding, 24-bit colour, wrapped CJK body, centred
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
span, so `%C(always,magenta)` — its own span — opened a colour that was closed
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

Two behaviours were probed rather than assumed, and one contradicted the
obvious reading:

- **`--decorate=no` does not suppress `%d`.** Only `full` changes what `%d`
  renders (to full ref names). `no` and `auto` affect the built-in formats
  alone. Two mechanisms that happen to share a flag.
- `--abbrev=N` applies uniformly to `%h`, `%t`, `%p`. Verified at 4 and 16.

Separator semantics are modelled: `tformat:` terminates every entry with a
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
- **T8:** colour is a *style* change; `textContent` cannot see it. T8 now
  observes `innerHTML` for the colour and pretty options. A gate that cannot
  observe the thing it asserts is worse than none.
- A name collision on inlining (`NAMED` in the simulator's colour table and
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
