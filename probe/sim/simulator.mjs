/*
 * git-log pretty-format simulator.
 *
 * Produces (a) the rendered bytes and (b) a span tree attributing every output
 * range to the template node that produced it. The span tree is not a debugging
 * extra -- D-1/R3 makes it the mechanism for both reverse propagation from the
 * preview and documentation-on-output, so it is built during evaluation rather
 * than reconstructed afterwards.
 *
 * Evidence-bound behaviors, each pinned by corpus vectors:
 *   F-3  color directives emit nothing unless color is enabled
 *   F-4  padding/wrapping/color are operators over subsequent output
 *   F-5  padding counts display columns and ignores SGR bytes
 *   F-6  truncation is character-aligned and may overshoot by one column
 *
 * Where git's rule is not statable (F-6), this implements a hypothesis and
 * Oracle A decides. Do not "fix" these by reasoning; change them only when a
 * corpus vector says so.
 */

// ---------------------------------------------------------------- tokenizer
// Longest-alternative-first. %>>( must precede %>(, %><|( must precede %><(,
// or a shorter alternative matches and the directive is misattributed.
const TOKEN_RE = new RegExp([
  // %C shorthands are PREFIX matches and only four exist (verified): "%Creddish"
  // is red + "dish"; "%Cyellow", "%CRED" and bare "%C" pass through as literal
  // text. A greedy /%C[a-zA-Z]+/ swallowed the trailing letters.
  /%C\([^)]*\)/, /%C(?:red|green|blue|reset)/,
  /%\([a-z][a-z-]*(?::[^)]*)?\)/,
  /%><\|\([^)]*\)/, /%<\|\([^)]*\)/, /%>\|\([^)]*\)/,
  /%>>\([^)]*\)/, /%><\([^)]*\)/, /%<\([^)]*\)/, /%>\([^)]*\)/,
  /%w\([^)]*\)/,
  /%x[0-9a-fA-F]{2}/,
  /%[+\- ][a-zA-Z]/,
  /%%/,
  // Never %C: an unknown %C<x> is literal text in git ("%Cyellow" prints as
  // written). Letting this generic pattern take "%Cy" swallowed it.
  // Two-letter placeholders exist only in the a/c (ident, date) and g/G
  // (reflog, signature) families. Everything else is ONE letter: "%ndate" is
  // %n then "date". The earlier /%[a-zA-Z][a-zA-Z]?/ read it as an unknown
  // "%nd" and printed it -- found by the smartlog preset, the first template
  // in any corpus to put a letter straight after %n.
  /%[acgG][a-zA-Z?]|%[a-zA-BD-Z]/,
].map(r => r.source).join("|"), "g");

export function tokenize(fmt) {
  const nodes = [];
  let last = 0, m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(fmt))) {
    if (m.index > last) nodes.push({ kind: "literal", text: fmt.slice(last, m.index), at: last });
    nodes.push(classify(m[0], m.index));
    last = TOKEN_RE.lastIndex;
  }
  if (last < fmt.length) nodes.push({ kind: "literal", text: fmt.slice(last), at: last });
  return nodes;
}

const PAD_RE = /^%(>>|><\||<\||>\||><|<|>)\((\d+)(?:,(trunc|ltrunc|mtrunc))?\)$/;

function classify(tok, at) {
  let m;
  if ((m = PAD_RE.exec(tok))) {
    const sym = m[1];
    const mode = { "<": "left", ">": "right", ">>": "steal", "><": "center",
                   "<|": "col-left", ">|": "col-right", "><|": "col-center" }[sym];
    return { kind: "pad", tok, at, mode, width: +m[2], truncate: m[3] || "none" };
  }
  if ((m = /^%w\(([^)]*)\)$/.exec(tok))) {
    const [w = 0, i1 = 0, i2 = 0] = m[1].split(",").map(x => +x || 0);
    return { kind: "wrap", tok, at, width: w, indent1: i1, indent2: i2 };
  }
  if (/^%C/.test(tok)) return { kind: "color", tok, at, spec: parseColor(tok) };
  if ((m = /^%x([0-9a-fA-F]{2})$/.exec(tok)))
    return { kind: "value", tok, at, field: "hexbyte", arg: parseInt(m[1], 16) };
  if (tok === "%%") return { kind: "value", tok, at, field: "percent" };
  if ((m = /^%([+\- ])([a-zA-Z])$/.exec(tok)))
    return { kind: "modifier", tok, at, mode: { "+": "newline", "-": "strip", " ": "space" }[m[1]],
             inner: classify("%" + m[2], at) };
  if ((m = /^%\(([a-z][a-z-]*)(?::([^)]*))?\)$/.exec(tok)))
    return { kind: "value", tok, at, field: m[1], opts: parseOpts(m[2] || "") };
  return { kind: "value", tok, at, field: tok.slice(1) };
}

function parseOpts(s) {
  const out = {};
  if (!s) return out;
  // Split on commas that are not inside an escape. Option values may contain
  // %x-escapes (%x2C is a literal comma), which must not be split on.
  for (const part of s.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) out[part] = true; else out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}

function parseColor(tok) {
  // Mirrors the dispatch in git's pretty.c, verified by the color sweep:
  //   %C(auto)            exactly -> auto-color mode (see render())
  //   %C(auto,<spec>)     emitted only when color is on
  //   %C(always,<spec>)   always emitted, regardless of --color
  //   %C(<spec>)          same as auto,
  //   %Cred %Cgreen %Cblue %Creset  fixed sequences, emitted when color is on
  // Only the FIRST "auto," or "always," is a mode prefix; any other comma is
  // part of the spec, so "red,blue" is invalid exactly as in git.
  const SHORT = { "%Cred": "\x1b[31m", "%Cgreen": "\x1b[32m", "%Cblue": "\x1b[34m", "%Creset": "\x1b[m" };
  if (tok in SHORT) return { form: "short", seq: SHORT[tok] };
  const m = /^%C\((.*)\)$/.exec(tok);
  if (!m) return { form: "short", seq: "" };
  const body = m[1];
  if (body === "auto") return { form: "auto" };
  if (body.startsWith("auto,")) return { form: "spec", mode: "auto", spec: body.slice(5) };
  if (body.startsWith("always,")) return { form: "spec", mode: "always", spec: body.slice(7) };
  return { form: "spec", mode: "auto", spec: body };
}

// git's color_parse_mem, derived from the 210-vector color sweep:
//  - words split on whitespace; COLOR names are case-insensitive, ATTRIBUTES
//    are case-sensitive ("RED" ok, "Bold" fatal)
//  - first color = foreground, second = background, a third is fatal
//  - numeric 0-7 -> 30-37, 8-15 -> 90-97, 16-255 -> 38;5;n, -1 = normal
//  - #rrggbb only; short #rgb is fatal on 2.43 (the 2.56 docs differ)
//  - attributes and their negations ("no"/"no-") are a SET emitted in
//    ascending SGR order, then foreground, then background
//  - "normal" contributes nothing; "default" is 39/49; "reset" alone -> ESC[m
export class ColorSpecError extends Error {}
const COLOR_NAMES = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
const ATTR_CODES = { bold: 1, dim: 2, italic: 3, ul: 4, blink: 5, reverse: 7, strike: 9 };
const ATTR_OFF = { bold: 22, dim: 22, italic: 23, ul: 24, blink: 25, reverse: 27, strike: 29 };

function parseOneColor(word) {
  const w = word.toLowerCase();
  if (w === "normal") return { kind: "normal" };
  if (w === "default") return { kind: "default" };
  let i = COLOR_NAMES.indexOf(w);
  if (i >= 0) return { kind: "ansi", i };
  if (w.startsWith("bright") && (i = COLOR_NAMES.indexOf(w.slice(6))) >= 0) return { kind: "bright", i };
  if (/^-?\d+$/.test(w)) {
    const n = parseInt(w, 10);
    if (n === -1) return { kind: "normal" };
    if (n >= 0 && n <= 7) return { kind: "ansi", i: n };
    if (n >= 8 && n <= 15) return { kind: "bright", i: n - 8 };
    if (n >= 16 && n <= 255) return { kind: "256", n };
    return null;
  }
  if (/^#[0-9a-f]{6}$/.test(w))
    return { kind: "rgb", r: parseInt(w.slice(1, 3), 16), g: parseInt(w.slice(3, 5), 16), b: parseInt(w.slice(5, 7), 16) };
  return null;
}
function colorCodes(c, bg) {
  switch (c.kind) {
    case "normal": return [];
    case "default": return [bg ? 49 : 39];
    case "ansi": return [(bg ? 40 : 30) + c.i];
    case "bright": return [(bg ? 100 : 90) + c.i];
    case "256": return [bg ? 48 : 38, 5, c.n];
    case "rgb": return [bg ? 48 : 38, 2, c.r, c.g, c.b];
  }
}
export function colorParse(spec) {
  const s = spec.trim();
  if (s === "") return "";
  if (s.toLowerCase() === "reset") return "\x1b[m";
  const attrs = new Set(); const colors = [];
  for (const word of s.split(/\s+/)) {
    const c = parseOneColor(word);
    if (c) {
      if (colors.length === 2) throw new ColorSpecError(`invalid color value: ${spec}`);
      colors.push(c); continue;
    }
    let m;
    if (word in ATTR_CODES) { attrs.add(ATTR_CODES[word]); continue; }
    if ((m = /^no-?(.+)$/.exec(word)) && m[1] in ATTR_OFF) { attrs.add(ATTR_OFF[m[1]]); continue; }
    throw new ColorSpecError(`invalid color value: ${spec}`);
  }
  const codes = [...attrs].sort((a, b) => a - b);
  if (colors[0]) codes.push(...colorCodes(colors[0], false));
  if (colors[1]) codes.push(...colorCodes(colors[1], true));
  return codes.length ? `\x1b[${codes.join(";")}m` : "";
}

// Is this color directive valid under the given --color mode? git parses a
// spec only when it will emit it -- under --color=always, or with "always,".
// So a template can run under --color=never and abort under --color=always.
export function colorDirectiveError(tok, colorMode) {
  const c = parseColor(tok);
  if (c.form !== "spec") return null;
  if (c.mode !== "always" && colorMode !== "always") return null;
  try { colorParse(c.spec); return null; } catch (e) { return e.message; }
}

// ------------------------------------------------------------------- width
// Display columns. The table is GENERATED from Unicode data (width_table.mjs),
// not hand-picked: a hand-picked list missed U+1F680 and produced 107 held-out
// truncation failures two layers away from the real defect. probe_widths.py
// checks git agrees with the generated table on every codepoint in the corpora.
import { WIDE_RANGES, ZERO_RANGES } from "./width_table.mjs";
function inRanges(cp, rs) {
  let lo = 0, hi = rs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, [a, b] = rs[mid];
    if (cp < a) hi = mid - 1; else if (cp > b) lo = mid + 1; else return true;
  }
  return false;
}
export function charWidth(cp) {
  if (cp === 0) return 0;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (inRanges(cp, ZERO_RANGES)) return 0;
  return inRanges(cp, WIDE_RANGES) ? 2 : 1;
}
export function displayWidth(s) {
  let w = 0;
  for (const ch of s) w += charWidth(ch.codePointAt(0));
  return w;
}
const SGR_RE = /\x1b\[[0-9;]*m/g;
export function visibleWidth(s) { return displayWidth(s.replace(SGR_RE, "")); }

// --------------------------------------------------------------- truncation
// Hypothesis under test. F-6 established that git is character-aligned and can
// overshoot the requested budget by one column on wide glyphs, and that the
// floor is the ellipsis itself. No rule was stated by git; this is inferred and
// Oracle A is the arbiter.
function truncate(s, width, mode) {
  if (visibleWidth(s) <= width) return s;
  const ell = "..";
  const chars = [...s];
  const budget = Math.max(0, width - 2);
  const cw = c => charWidth(c.codePointAt(0));

  // Derived from the N=1..40 x {ascii,CJK} sweep, not from a stated rule.
  // trunc and ltrunc are ASYMMETRIC: right-truncation admits the character
  // that straddles the budget (this is exactly the +1 column overshoot in
  // F-6), left-truncation does not. The asymmetry is what the corpus says;
  // it is not a tidy rule and must not be "simplified".
  if (mode === "trunc") {
    let out = "", w = 0;
    for (const c of chars) { if (w >= budget) break; out += c; w += cw(c); }
    return out + ell;
  }
  if (mode === "ltrunc") {
    let out = "", w = 0;
    for (let i = chars.length - 1; i >= 0; i--) {
      if (w + cw(chars[i]) > budget) break;
      out = chars[i] + out; w += cw(chars[i]);
    }
    return ell + out;
  }
  // mtrunc: head and tail budgets are fixed INDEPENDENTLY -- floor(b/2) and
  // b - floor(b/2). The tail budget does NOT shrink when the head overshoots;
  // computing it as b - hw was the defect. Head uses the permissive straddle
  // rule (like trunc); tail uses the strict one (like ltrunc). Derived from the
  // full N=1..40 sweep: N=27/31/35 fix the budget split, N=3/4/9/10 fix the
  // tail's strictness (a permissive tail admits the emoji at budget 1).
  const half = Math.floor(budget / 2), tailBudget = budget - half;
  let head = "", hw = 0;
  for (const c of chars) { if (hw >= half) break; head += c; hw += cw(c); }
  let tail = "", tw = 0;
  for (let i = chars.length - 1; i >= 0; i--) {
    if (tw + cw(chars[i]) > tailBudget) break;
    tail = chars[i] + tail; tw += cw(chars[i]);
  }
  return head + ell + tail;
}

function applyPad(text, pad, column) {
  let s = text;
  if (pad.truncate !== "none") {
    s = truncate(s, pad.width, pad.truncate);
    // Verified: once truncation fires, git does NOT then pad back out to the
    // width. %<(3,ltrunc) over a long subject yields ".." -- two columns, not
    // three. Padding only applies when the value fit to begin with.
    if (s !== text) return s;
  }
  const target = pad.mode.startsWith("col-") ? Math.max(0, pad.width - column) : pad.width;
  const w = visibleWidth(s);
  if (w >= target) return s;
  const fill = target - w;
  switch (pad.mode) {
    case "left": case "col-left": return s + " ".repeat(fill);
    case "right": case "steal": case "col-right": return " ".repeat(fill) + s;
    default: {
      const l = Math.floor(fill / 2);
      return " ".repeat(l) + s + " ".repeat(fill - l);
    }
  }
}

// ---------------------------------------------------------------- wrapping
// git's %w reflows paragraphs. Verified consequences: trailer line structure is
// destroyed, and trailing spaces survive into the output.
function wrapText(s, w, i1, i2) {
  const lines = s.split("\n");
  if (!w) {
    // A trailing empty element comes from the body's final newline and is NOT
    // indented -- interior blank lines are.
    const lastIsTrailer = lines.length > 1 && lines[lines.length - 1] === "";
    return lines.map((l, i) => {
      if (lastIsTrailer && i === lines.length - 1) return l;
      return (i === 0 ? " ".repeat(i1) : " ".repeat(i2)) + l;
    }).join("\n");
  }

  // Derived from the wrap discrimination sweep (30 synthetic bodies x 4
  // configurations), not from the main corpus, which held a single instance
  // of the triggering configuration and could not discriminate.
  //
  // A source newline is SOFT -- converted to a space that is emitted
  // unconditionally, after which the wrap decision is made -- iff the next
  // character is ASCII alphanumeric. Digits and uppercase merge. Anything
  // else forces a HARD break: punctuation, whitespace, and every non-ASCII
  // character regardless of display width (e-acute at one column blocks the
  // merge exactly as CJK does; "e" + combining acute merges because its first
  // byte is ASCII). This is git's ASCII-only isalnum. After a hard break,
  // leading ASCII whitespace on the next line is stripped.
  //
  // The trailing-space asymmetry follows: a line breaking at a soft newline
  // keeps the emitted space; one breaking at a source space does not.
  const ASCII_ALNUM = /^[A-Za-z0-9]/;
  const out = [];
  let firstOfText = true;
  for (const para of s.split("\n\n")) {
    if (para === "") { out.push(""); continue; }
    const srcLines = para.split("\n");
    let line = null, cur = 0;
    const emitWord = (word, sep) => {
      const ww = displayWidth(word);
      if (line === null) {
        const ind = firstOfText ? i1 : i2;
        line = " ".repeat(ind) + word; cur = ind + ww; firstOfText = false;
        return;
      }
      if (word === "") {
        // consecutive source spaces are preserved, not collapsed -- verified:
        // "aaa bbb \nccc" renders "aaa bbb  ccc" with both spaces intact
        line += " "; cur += 1; return;
      }
      if (sep === "soft") {
        if (cur + 1 + ww > w) { out.push(line + " "); line = " ".repeat(i2) + word; cur = i2 + ww; }
        else { line += " " + word; cur += 1 + ww; }
      } else if (cur + 1 + ww > w) {
        out.push(line); line = " ".repeat(i2) + word; cur = i2 + ww;
      } else { line += " " + word; cur += 1 + ww; }
    };
    for (let li = 0; li < srcLines.length; li++) {
      let src = srcLines[li];
      if (li > 0 && src === "") {
        // the body's final newline: close the line, open nothing
        if (line !== null) out.push(line);
        line = null;
        continue;
      }
      if (li > 0) {
        if (ASCII_ALNUM.test(src)) {
          // soft: first word joins the flow with the converted-newline space
          const words = src.split(" ");
          emitWord(words[0], "soft");
          for (const wd of words.slice(1)) emitWord(wd, "space");
          continue;
        }
        // hard: close the current line, strip leading ASCII whitespace
        if (line !== null) out.push(line);
        line = null;
        src = src.replace(/^[ \t]+/, "");
      }
      const words = src.split(" ");
      for (const wd of words) emitWord(wd, "space");
    }
    if (line !== null) out.push(line);
    out.push("");
  }
  // The final "" stands for the source's trailing newline; a subject has none.
  if (!s.endsWith("\n") && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

// ------------------------------------------------------------------ colors
// Emit a color directive. Validation happens only when emission happens.
function emitColor(spec, ctx) {
  const on = ctx.colorMode === "always";
  if (spec.form === "short") return on ? spec.seq : "";
  if (spec.mode !== "always" && !on) return "";
  return colorParse(spec.spec);     // throws ColorSpecError, as git dies
}
// The default color git uses for the commit hash under %C(auto)
// (color.diff.commit). Overridable via opts.config["color.diff.commit"].
const DEFAULT_COMMIT_COLOR = "yellow";
/** git config variable names are case-insensitive; look one up that way. */
export function configGet(cfg, key) {
  if (!cfg) return undefined;
  const k = Object.keys(cfg).find(x => x.toLowerCase() === key.toLowerCase());
  return k === undefined ? undefined : cfg[k];
}

// ------------------------------------------------------------------- dates
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
             "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shift(ts, tz) {
  const sign = tz[0] === "-" ? -1 : 1;
  const off = sign * (parseInt(tz.slice(1, 3), 10) * 60 + parseInt(tz.slice(3, 5), 10));
  return { d: new Date((ts + off * 60) * 1000), off };
}
const p2 = n => String(n).padStart(2, "0");
/** The author / committer ident with git's clock-dependent renderings attached. */
function identOf(rec, who) {
  const H = rec.host || {}, w = who === "author" ? "a" : "c";
  return { ...rec[who], rel: H[w + "r"], human: H[w + "h"] };
}
export function formatDate(ident, style) {
  const { d } = shift(ident.ts, ident.tz);
  const Y = d.getUTCFullYear(), M = d.getUTCMonth(), D = d.getUTCDate();
  const hh = p2(d.getUTCHours()), mm = p2(d.getUTCMinutes()), ss = p2(d.getUTCSeconds());
  const tz = ident.tz;
  switch (style) {
    // relative and human depend on the clock, so they are host-supplied (the
    // record carries git's own rendering, captured with the record); an ident
    // without one is a defect in the record, not a reason to guess.
    case "relative": case "human": {
      const v = style === "relative" ? ident.rel : ident.human;
      if (v === undefined) throw new Error(`--date=${style} needs a host-supplied value`);
      return v;
    }
    case "default": return `${DOW[d.getUTCDay()]} ${MON[M]} ${String(D).padStart(2, " ")} ${hh}:${mm}:${ss} ${Y} ${tz}`;
    case "rfc2822": return `${DOW[d.getUTCDay()]}, ${D} ${MON[M]} ${Y} ${hh}:${mm}:${ss} ${tz}`;
    case "iso": return `${Y}-${p2(M + 1)}-${p2(D)} ${hh}:${mm}:${ss} ${tz}`;
    case "iso-strict": return `${Y}-${p2(M + 1)}-${p2(D)}T${hh}:${mm}:${ss}${tz.slice(0, 3)}:${tz.slice(3)}`;
    case "short": return `${Y}-${p2(M + 1)}-${p2(D)}`;
    case "unix": return String(ident.ts);
    case "raw": return `${ident.ts} ${tz}`;
    default: return `${DOW[d.getUTCDay()]} ${MON[M]} ${String(D).padStart(2, " ")} ${hh}:${mm}:${ss} ${Y} ${tz}`;
  }
}

// ---------------------------------------------------------------- trailers
export function extractTrailers(message) {
  // Trailers live in the LAST paragraph of the BODY. Scanning the whole
  // message parsed the subject of a body-less commit ("docs: clarify padding
  // semantics") as a trailer, because it happens to match "Key: value".
  const i = message.indexOf("\n\n");
  if (i < 0) return [];
  const body = message.slice(i + 2).replace(/\n+$/, "");
  if (body === "") return [];
  const paras = body.split("\n\n");
  const lines = paras[paras.length - 1].split("\n");
  const isTrailer = l => /^[A-Za-z][A-Za-z0-9-]*:/.test(l);
  const isFold = l => /^\s+\S/.test(l);
  if (!lines.length || !isTrailer(lines[0])) return [];
  if (!lines.every(l => isTrailer(l) || isFold(l))) return [];
  const out = [];
  for (const line of lines) {
    if (isFold(line) && out.length) { out[out.length - 1].value += "\n" + line; continue; }
    const j = line.indexOf(":");
    out.push({ key: line.slice(0, j), value: line.slice(j + 1).replace(/^ /, "") });
  }
  return out;
}

function renderTrailers(rec, opts) {
  let items = extractTrailers(rec.message);
  const keys = Object.keys(opts).filter(k => k === "key").length;
  if (opts.key) {
    const want = String(opts.key).toLowerCase();
    items = items.filter(t => t.key.toLowerCase() === want);
  }
  const kvsep = opts.key_value_separator !== undefined
    ? unescapeHex(String(opts.key_value_separator)) : ": ";
  const parts = items.map(t => {
    let v = t.value;
    if (opts.unfold) v = v.replace(/\n\s*/g, " ");
    if (opts.keyonly) return t.key;
    if (opts.valueonly) return v;
    return t.key + kvsep + v;
  });
  if (opts.separator !== undefined) return parts.join(unescapeHex(String(opts.separator)));
  return parts.map(p => p + "\n").join("");
}

// ---------------------------------------------------------- decoration ----
// Port of format_decorations() in git's log-tree.c. The SET and ORDER of refs
// on a commit come from git (--decorate=full %D, host-supplied and declared as
// such). Everything else is computed: short or full names, punctuation, the
// %(decorate:...) options, and coloring -- which applies only under
// %C(auto) for placeholders, or under --color for the built-in formats.

// Decoration slots and git's default colors (color.decorate.<slot>).
const DECO_DEFAULT = { branch: "bold green", remoteBranch: "bold red", tag: "bold yellow",
                       stash: "bold magenta", HEAD: "bold cyan", grafted: "bold blue" };

function refKind(full) {
  if (full === "HEAD") return "HEAD";
  if (full.startsWith("refs/heads/")) return "branch";
  if (full.startsWith("refs/remotes/")) return "remoteBranch";
  if (full.startsWith("refs/tags/")) return "tag";
  if (full === "refs/stash") return "stash";
  if (full === "grafted") return "grafted";
  return "branch";
}
function shortName(full) {
  for (const pfx of ["refs/heads/", "refs/tags/", "refs/remotes/"]) if (full.startsWith(pfx)) return full.slice(pfx.length);
  return full;
}

/** Parse git's own "--decorate=full %D" text into ordered items. */
export function parseDecoration(fullText) {
  if (!fullText) return [];
  return fullText.split(", ").map(item => {
    let m;
    if ((m = /^HEAD -> (.+)$/.exec(item))) return { kind: "HEAD", full: "HEAD", current: { kind: refKind(m[1]), full: m[1] } };
    if ((m = /^tag: (.+)$/.exec(item))) return { kind: "tag", full: m[1] };
    return { kind: refKind(item), full: item };
  });
}

/**
 * @param items   from parseDecoration
 * @param opts    { prefix, suffix, separator, pointer, tag } (git defaults if absent)
 * @param style   { color: bool, names: 'short'|'full', config: {...} }
 */
export function formatDecorations(items, opts, style) {
  if (!items.length) return "";
  let prefix = opts.prefix ?? " (";
  const suffix = opts.suffix ?? ")", separator = opts.separator ?? ", ";
  const pointer = opts.pointer ?? " -> ", tag = opts.tag ?? "tag: ";
  const cfg = style.config || {};
  // Config keys are case-insensitive (git lowercases the variable name and
  // compares slot names with strcasecmp): color.decorate.HEAD == .head.
  const cfgGet = key => configGet(cfg, key);
  const col = slot => style.color ? colorParse(cfgGet(`color.decorate.${slot}`) ?? DECO_DEFAULT[slot]) : "";
  const commitColor = style.color ? colorParse(cfgGet("color.diff.commit") ?? "yellow") : "";
  const reset = style.color ? "\x1b[m" : "";
  const name = it => it.kind === "HEAD" ? "HEAD" : style.names === "full" ? it.full : shortName(it.full);
  let out = "";
  for (const it of items) {
    if (prefix) out += commitColor + prefix + reset;
    if (tag && it.kind === "tag") out += col("tag") + tag + reset;
    out += col(it.kind) + name(it) + reset;
    if (it.current) {
      out += commitColor + pointer + reset;
      out += col(it.current.kind) + name(it.current) + reset;
    }
    prefix = separator;
  }
  if (suffix) out += commitColor + suffix + reset;
  return out;
}

function unescapeHex(s) {
  return s.replace(/%x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// ----------------------------------------------------------------- evaluate
const HOST_FIELDS = new Set([
  "d", "D", "N", "S", "m", "ar", "cr", "ah", "ch",
  "GG", "G?", "GS", "GK", "GF", "GP", "GT", "decorate", "describe",
]);

function valueOf(node, rec, ctx) {
  const f = node.field, H = rec.host || {};
  // --abbrev=N applies uniformly to %h %t %p (verified: =4 and =16)
  const n = ctx.abbrev || rec.abbrev || 7;
  switch (f) {
    case "H": return rec.H; case "h": return rec.H.slice(0, n);
    case "T": return rec.T; case "t": return rec.T.slice(0, n);
    case "P": return rec.P.join(" "); case "p": return rec.P.map(x => x.slice(0, n)).join(" ");
    case "an": case "aN": return rec.author.name;
    case "ae": case "aE": return rec.author.email;
    case "al": case "aL": return rec.author.email.split("@")[0];
    case "cn": case "cN": return rec.committer.name;
    case "ce": case "cE": return rec.committer.email;
    case "cl": case "cL": return rec.committer.email.split("@")[0];
    case "ad": return formatDate(identOf(rec, "author"), ctx.dateStyle);
    case "cd": return formatDate(identOf(rec, "committer"), ctx.dateStyle);
    case "aD": return formatDate(rec.author, "rfc2822");
    case "cD": return formatDate(rec.committer, "rfc2822");
    case "at": return String(rec.author.ts);
    case "ct": return String(rec.committer.ts);
    case "ai": return formatDate(rec.author, "iso");
    case "ci": return formatDate(rec.committer, "iso");
    case "aI": return formatDate(rec.author, "iso-strict");
    case "cI": return formatDate(rec.committer, "iso-strict");
    case "as": return formatDate(rec.author, "short");
    case "cs": return formatDate(rec.committer, "short");
    case "ar": return H.ar ?? ""; case "cr": return H.cr ?? "";
    case "ah": return H.ah ?? ""; case "ch": return H.ch ?? "";
    case "e": return rec.encoding;
    case "s": return subjectOf(rec);
    case "f": return subjectOf(rec).replace(/[^A-Za-z0-9._]+/g, "-")
                                   .replace(/^-+|-+$/g, "");
    case "b": return bodyOf(rec);
    case "B": return rec.message;
    case "N": return H.notes ? H.notes + "\n" : "";
    // --decorate=full switches %d/%D to full ref names; no/auto do NOT
    // suppress them (verified) -- that only affects the built-ins
    // %d and %D are colored only under %C(auto) (verified), and --decorate=full
    // switches to full ref names; --decorate=no/auto do not suppress them.
    case "d": return formatDecorations(parseDecoration(H.decoration_full_bare), {},
                                       { color: ctx.autoColor, names: ctx.decorate === "full" ? "full" : "short", config: ctx.config });
    case "D": return formatDecorations(parseDecoration(H.decoration_full_bare), { prefix: "", suffix: "" },
                                       { color: ctx.autoColor, names: ctx.decorate === "full" ? "full" : "short", config: ctx.config });
    case "S": return H.ref_name ?? "";
    case "m": return H.mark ?? ">";
    case "GG": return H.sig_raw ? H.sig_raw + "\n" : ""; case "G?": return H.sig_status ?? "N";
    case "GS": return H.sig_signer ?? ""; case "GK": return H.sig_key ?? "";
    case "GF": return H.sig_fingerprint ?? ""; case "GP": return H.sig_primary_fingerprint ?? "";
    case "GT": return H.sig_trust ?? "";
    // Outside a reflog walk every %g* placeholder is empty -- NOT passed
    // through as an unknown token. Falling through to the default branch
    // emitted the literal "%gD" and failed 49 vectors.
    case "gD": case "gd": case "gn": case "gN": case "ge": case "gE": case "gs":
      return (rec.reflog && rec.reflog[f]) || "";
    case "describe": {
      const o = node.opts || {};
      if (o.exclude !== undefined) return H.describe_exclude ?? "";
      if (o.match !== undefined) return H.describe_match ?? "";
      if (o.abbrev !== undefined) return H.describe_abbrev8 ?? "";
      return (o.tags ? H.describe_tags : H.describe) ?? "";
    }
    case "decorate": {
      const o = node.opts || {}, opt = {};
      for (const k of ["prefix", "suffix", "separator", "pointer", "tag"]) if (o[k] !== undefined) opt[k] = unescapeHex(String(o[k]));   // %xNN is honored in option values
      return formatDecorations(parseDecoration(H.decoration_full_bare), opt,
                               { color: ctx.autoColor, names: ctx.decorate === "full" ? "full" : "short", config: ctx.config });
    }
    case "trailers": return renderTrailers(rec, node.opts || {});
    case "n": return "\n";
    case "percent": return "%";
    case "hexbyte": return String.fromCharCode(node.arg);
    default: return node.tok;    // unknown -> git passes through verbatim
  }
}

function subjectOf(rec) {
  const i = rec.message.indexOf("\n\n");
  const head = i < 0 ? rec.message : rec.message.slice(0, i);
  return head.replace(/\n+$/, "").split("\n").join(" ");
}
function bodyOf(rec) {
  const i = rec.message.indexOf("\n\n");
  return i < 0 ? "" : rec.message.slice(i + 2);
}

/**
 * Render one commit. Returns { text, spans }.
 * Padding hypothesis: a pad directive applies to the concatenated output of
 * everything up to and including the next value placeholder, with color
 * directives transparent (they emit no columns).
 */
export function render(fmt, rec, opts = {}) {
  const ctx = { dateStyle: opts.dateStyle || "default",
                colorMode: opts.color || "never", abbrev: opts.abbrev, decorate: opts.decorate,
                config: opts.config || {}, autoColor: false };
  const nodes = tokenize(fmt);
  let out = "", spans = [], pending = null, wrap = null, column = 0;
  try {
  const push = (text, node) => {
    if (!text) return;
    spans.push({ start: out.length, end: out.length + text.length, node });
    out += text;
  };

  for (const node of nodes) {
    if (node.kind === "pad") { pending = { pad: node, buf: "", spans: [], col: column }; continue; }
    if (node.kind === "wrap") { wrap = node; continue; }

    let text, isValue = false;
    if (node.kind === "literal") text = node.text;
    else if (node.kind === "color") {
      // %C(auto) turns auto-color on for EVERY following %h/%H/%d/%D until the
      // next color directive -- not just the next placeholder (v0.8.0 bug,
      // masked because every corpus case had exactly one). When color is on and
      // anything has already been output, it first emits a reset.
      if (node.spec.form === "auto") {
        ctx.autoColor = ctx.colorMode === "always";
        const already = out.length + (pending ? pending.buf.length : 0);
        text = ctx.autoColor && already ? "\x1b[m" : "";
      } else {
        text = emitColor(node.spec, ctx);
        ctx.autoColor = false;
      }
    }
    else if (node.kind === "modifier") {
      const inner = valueOf(node.inner, rec, ctx);
      if (!inner) text = "";
      else if (node.mode === "newline") text = "\n" + inner;
      else if (node.mode === "space") text = " " + inner;
      else text = inner;
      isValue = true;
    } else {
      text = valueOf(node, rec, ctx);
      isValue = true;
      // Under auto-color the hash is wrapped in the commit color and its OWN
      // reset, so "%C(auto)%h%Creset" emits two resets, not one (verified).
      if (ctx.autoColor && (node.field === "h" || node.field === "H")) {
        const cc = colorParse(configGet(ctx.config, "color.diff.commit") ?? DEFAULT_COMMIT_COLOR);
        text = `${cc}${text}\x1b[m`;
      }
    }

    if (wrap && isValue) text = wrapText(text, wrap.width, wrap.indent1, wrap.indent2);

    if (pending) {
      pending.buf += text;
      pending.spans.push({ off: pending.buf.length - text.length, len: text.length, node });
      if (isValue) {
        const padded = applyPad(pending.buf, pending.pad, pending.col);
        const base = out.length;
        out += padded;
        spans.push({ start: base, end: out.length, node: pending.pad, children: pending.spans });
        column = trailingColumn(out);
        pending = null;
      }
      continue;
    }
    push(text, node);
    column = trailingColumn(out);
  }
  if (pending) {
    // A pad directive with no following value placeholder produces NOTHING --
    // this is F-4 restated at the end of the template. Padding an empty buffer
    // out to the width emitted a phantom run of spaces and failed 80 vectors.
    if (pending.buf) {
      spans.push({ start: out.length, end: out.length + pending.buf.length, node: pending.pad });
      out += pending.buf;
    }
  }
  } catch (e) {
    // git dies on an invalid emitted color spec: nothing is printed for the
    // entry and the process exits 128. The error is part of the result.
    if (e instanceof ColorSpecError) return { text: "", spans: [], error: e.message };
    throw e;
  }
  return { text: out, spans };
}

function trailingColumn(s) {
  const i = s.lastIndexOf("\n");
  return visibleWidth(i < 0 ? s : s.slice(i + 1));
}

export function renderAll(fmt, recs, opts = {}) {
  const term = opts.terminator ?? "\n";
  return recs.map(r => render(fmt, r, opts).text + term).join("");
}

// ------------------------------------------------------------ built-ins ---
// The named pretty formats are NOT expressible as templates: medium emits a
// conditional "Merge:" line, raw emits one "parent" line per parent and the
// gpgsig header verbatim. They get their own renderer, verified by Oracle A
// against the named-format corpus family. Evidence-bound details:
//   - raw does NOT emit the encoding header (git re-encodes for output and
//     drops it) -- verified on the encoded commit
//   - the message block is %w(0,4,4)-style: every line indented 4, interior
//     blank lines become 4 spaces, the trailing newline is not indented
//   - decoration follows the hash on the "commit" line
export const NAMED_FORMATS = ["oneline", "short", "medium", "full", "fuller",
                              "reference", "email", "mboxrd", "raw"];
function indent4(msg) { return wrapText(msg, 0, 4, 4); }
function abbrevOf(rec, ctx) { return ctx.abbrev || rec.abbrev || 7; }
function ident(i) { return `${i.name} <${i.email}>`; }
export function renderNamed(name, rec, opts = {}) {
  const ctx = { dateStyle: opts.dateStyle || "default", colorMode: opts.color || "never", abbrev: opts.abbrev };
  const H = rec.host || {}, n = abbrevOf(rec, ctx);
  const deco = decorationText(rec, opts);
  const hash = rec.H, short = rec.H.slice(0, n);
  const merge = rec.P.length > 1 ? `Merge: ${rec.P.map(p => p.slice(0, n)).join(" ")}\n` : "";
  const msg = rec.message.replace(/\n+$/, "\n");
  const body = bodyOf(rec).replace(/\n+$/, "");
  switch (name) {
    case "oneline":
      return `${color(ctx, 33, hash)}${deco} ${subjectOf(rec)}\n`;
    case "short":
      return `commit ${color(ctx, 33, hash)}${deco}\n${merge}Author: ${ident(rec.author)}\n\n${indent4(subjectOf(rec) + "\n")}`;
    case "medium":
      return `commit ${color(ctx, 33, hash)}${deco}\n${merge}Author: ${ident(rec.author)}\nDate:   ${formatDate(identOf(rec, "author"), ctx.dateStyle)}\n\n${indent4(msg)}`;
    case "full":
      return `commit ${color(ctx, 33, hash)}${deco}\n${merge}Author: ${ident(rec.author)}\nCommit: ${ident(rec.committer)}\n\n${indent4(msg)}`;
    case "fuller":
      return `commit ${color(ctx, 33, hash)}${deco}\n${merge}Author:     ${ident(rec.author)}\nAuthorDate: ${formatDate(identOf(rec, "author"), ctx.dateStyle)}\nCommit:     ${ident(rec.committer)}\nCommitDate: ${formatDate(identOf(rec, "committer"), ctx.dateStyle)}\n\n${indent4(msg)}`;
    case "reference":
      return `${color(ctx, 33, short)} (${subjectOf(rec)}, ${formatDate(rec.author, "short")})\n`;
    case "email": case "mboxrd": {
      const b = name === "mboxrd" ? body.replace(/^(>*From )/gm, ">$1") : body;
      const subj = emailSubject(subjectOf(rec));
      // MIME headers appear when the MESSAGE (subject or body) is non-ASCII
      const mime = /[^\x00-\x7f]/.test(rec.message)
        ? "MIME-Version: 1.0\nContent-Type: text/plain; charset=UTF-8\nContent-Transfer-Encoding: 8bit\n" : "";
      return `From ${hash} Mon Sep 17 00:00:00 2001\nFrom: ${ident(rec.author)}\nDate: ${formatDate(rec.author, "rfc2822")}\n${subj}\n${mime}\n${b}${b ? "\n" : ""}`;
    }
    case "raw": {
      const parents = rec.P.map(p => `parent ${p}\n`).join("");
      const sig = rec.gpgsig ? `gpgsig ${rec.gpgsig}\n` : "";
      return `commit ${color(ctx, 33, hash)}${deco}\ntree ${rec.T}\n${parents}author ${ident(rec.author)} ${rec.author.ts} ${rec.author.tz}\ncommitter ${ident(rec.committer)} ${rec.committer.ts} ${rec.committer.tz}\n${sig}\n${indent4(msg)}`;
    }
    default: throw new Error(`unknown named format ${name}`);
  }
}
/**
 * Built-in formats split as show_log() prints them: a HEADER written directly
 * ("commit <hash><decorations>", or "<hash><decorations> " for oneline) and a
 * MESSAGE buffer that goes through graph interleaving. Under color, the commit
 * color wraps "commit " AND the hash -- the unsplit renderer above colored the
 * hash only, which no corpus vector exercised (all ran --color=never).
 * reference is a user format in git ("%C(auto)%h (%s, %ad)") and has no header.
 */
export function renderNamedParts(name, rec, opts = {}) {
  const on = opts.color === "always";
  const cc = on ? colorParse(configGet(opts.config, "color.diff.commit") ?? DEFAULT_COMMIT_COLOR) : "", rs = on ? "\x1b[m" : "";
  const n = opts.abbrev || rec.abbrev || 7;
  const hash = opts.abbrevCommit ? rec.H.slice(0, n) : rec.H;
  const deco = opts.decorations || "";
  if (name === "reference") {
    const full = renderNamed(name, rec, { ...opts, decorate: "no" });
    return { header: "", headerNewline: false, message: full.replace(/\n$/, "") };
  }
  if (name === "oneline")
    return { header: `${cc}${hash}${rs}${deco} `, headerNewline: false, message: subjectOf(rec) };
  const full = renderNamed(name, rec, { ...opts, color: "never", decorate: "no" });
  return { header: `${cc}commit ${hash}${rs}${deco}`, headerNewline: true,
           message: full.slice(full.indexOf("\n") + 1) };
}

// Subject header. Two regimes, both derived from the email@verbose and
// email@wide vectors:
//  - ASCII: folded at 78 columns with a single-space continuation, the
//    "Subject: [PATCH] " prefix counting toward the first line
//  - non-ASCII: RFC 2047 Q-encoded words, "=?UTF-8?q?...?=", a new word
//    started whenever line + encoded_char + 2 would exceed 76; space, "=",
//    "?", "_" and every non-ASCII byte are =XX-encoded; a UTF-8 sequence is
//    never split across words
function emailSubject(subject) {
  const prefix = "Subject: [PATCH] ";
  if (!/[^\x00-\x7f]/.test(subject)) return wrapText(prefix + subject, 78, 0, 1);
  const enc = new TextEncoder(); let out = prefix + "=?UTF-8?q?", line = out.length;
  for (const ch of subject) {
    const bytes = enc.encode(ch); let piece = "";
    for (const b of bytes) piece += (b >= 0x80 || b < 0x20 || b === 0x20 || b === 0x3d || b === 0x3f || b === 0x5f)
      ? "=" + b.toString(16).toUpperCase().padStart(2, "0") : String.fromCharCode(b);
    if (line + piece.length + 2 > 76) { out += "?=\n =?UTF-8?q?"; line = 11; }
    out += piece; line += piece.length;
  }
  return out + "?=";
}
function color(ctx, code, s) { return ctx.colorMode === "always" ? `\x1b[${code}m${s}\x1b[m` : s; }
// --decorate=<mode>: short (default) | full | no. auto == no when not a TTY.
export function decorationText(rec, opts) {
  // Default is AUTO, which is off when stdout is not a terminal -- so the
  // built-ins show no decoration in the corpus, while %d in a custom format
  // always does. The two are different mechanisms and must not be conflated.
  const H = rec.host || {}; const mode = opts.decorate || "auto";
  if (mode === "no" || mode === "auto") return "";
  const bare = mode === "full" ? (H.decoration_full_bare ?? "") : (H.decoration_bare ?? "");
  return bare ? ` (${bare})` : "";
}
