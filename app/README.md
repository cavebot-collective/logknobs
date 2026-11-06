# logknobs v0.4.0 — configurator for git log formats (browser + Electron)

    node build.mjs                 # -> dist/index.html (single file, no runtime deps)
    open dist/index.html           # browser: simulated preview
    GITLOG_REPO=/path/to/repo npx electron electron/main.js   # desktop: + real-git mode
    npm run verify                 # every gate below, each under timeout(1)

## Layout (spec §39)

- **Insert** (left, dashed, mint, every item marked +): adds a new part after
  the selection, or at the end; or drag a chip into the parts row. Nothing in
  Insert changes an existing part.
- **Edit selected** (right, solid amber): edits the selected part. Only the
  sections that apply to that kind of part appear; the rest are named, with the
  reason on hover. Every section carries a scope chip ("applies to: ...").
- **Output** (right): global options and git config colors, each with a scope chip.
- **Parts** (center): the template as parts — feature-lab-001, two views:
  `blocks` (chips, operator scopes drawn as brackets) and `grammar` (each part as
  an instance of its production, indented by scope depth). Drag to reorder,
  Alt+←/→ to move, Delete to remove.
- **Preview**: one commit, or history (a branchy sample repository, with
  --graph) in a terminal theme from Windows Terminal's own defaults.

## Architecture

- Canonical state is `{ template, options }`. Every view is a projection; every
  edit is a pure function to a new state. Undo/redo is `setHistoryIndex` over a
  list of states; undo and redo are defined atop it. Selection, theme and
  preview mode are view state and are not undone.
- Toggles (--graph, --oneline, --all, --first-parent, --reverse) are drawn atop
  enum setters. git's exclusions are enforced in the setter: --graph and
  --reverse turn each other off.
- Every edit that places text re-tokenizes and checks git reads it back as
  intended. An edit that would merge with a neighbor ("%a" + "n" is "%an") is
  refused with a notice, not applied.
- Preview spans carry node attribution. Style is computed over the whole ANSI
  stream first, then spans are laid over the visible text (Oracle B caught the
  per-span version at 666px in v0.2.0). paintSegs is shared with Oracle B so the
  reference has the same run structure.
- The desktop host runs only `git log`, with flags from a closed whitelist;
  --output and unknown config keys are refused.

## Gates (tests/)

| gate | file | asserts |
|---|---|---|
| T8 v2 | t8.js | palette totality, inspector applicability, variants, params, micro-templates, color (this part / from here / literals / grammar / refusal), padding, spacing, every option value, toggles + exclusivity, config colors, invalid color aborts, themes, scope chips |
| T10 | t10.js | knobs: keyboard, drag, wheel, angle tracks value, select → knob, brand geometry |
| T11 | t11.js | undo/redo exact over 60 seeded edits, branch truncation, coalescing, keys, limit |
| T12 | t12.js | drag every part to every gap in both views, drag from Insert, keyboard order, refusal, scope brackets |
| T13 | t13.js | every preset == real git on three repositories; save/load/rename/delete/export/import; config fragment and commands round-trip through git |
| T14 | t14.py | zero British spellings across app, sources, tests, simulator, scripts, spec |
| Oracle B | oracle_b.js | preview pixels == real git bytes, single and history, five themes, with negative controls |
| real git | realgit.js | desktop mode agrees with the simulator; host refuses unlisted flags and config |

tests/legacy/ holds the v0.3.0 gates for reference; they drive the v0.3.0 UI.

## Not covered

- PowerShell quoting is generated but not executed by any gate (no pwsh here).
  bash quoting is executed by T13.
- cmd.exe quoting is not offered: % handling differs between the prompt and
  batch files, so one quoting cannot be right for both.

## Brand (v0.3.0)

    python3 brand/make_brand.py brand/assets    # regenerates all SVGs + tokens

The knob is ONE geometry, shared three ways: the wordmark's two o's, the UI's
knob controls, and the gauge. brand/assets/brand-tokens.json is the source;
T10 asserts the UI's sweep matches it.

- Knob controls are a second VIEW over the option setter. The canonical
  <select> stays in the DOM (class "vh") so the gates drive it and assistive
  tech reads it.
- makeKnob builds its DOM once and mutates attributes. Rewriting innerHTML per
  render destroys focus and pointer capture, so exactly one keypress lands.
