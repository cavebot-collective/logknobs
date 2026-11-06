/*
 * Multi-commit output: a port of show_log() in git's log-tree.c together with
 * the graph_show_* helpers in graph.c. This is where the graph meets the
 * formatted entry:
 *
 *   - graph rows up to and including the commit row are printed before the
 *     entry; the commit row is the first line's prefix
 *   - every further line of the entry consumes ONE graph row (so a two-line
 *     template on a merge commit shows the post-merge row as its prefix)
 *   - rows still owed after the entry ("remainder") follow it
 *   - tformat: terminates each entry; format: separates entries; in both, a
 *     padding row is printed before the newline when the entry itself ended
 *     with a newline, so the graph shows no gap
 *
 * Judged by the graph, graph-colors and graph-builtin corpus families.
 */
import { render, renderNamedParts, formatDecorations, parseDecoration, colorParse } from "./simulator.mjs";
import { walk } from "./walk.mjs";
import { Graph, parseGraphColors } from "./graph.mjs";

const BUILTIN_TFORMAT = new Set(["oneline", "reference"]);

/**
 * @param store  { records, refs, head }
 * @param opts   { template, pretty: 'tformat'|'format'|<builtin>, graph: bool,
 *                 color: 'always'|'never', all, order, firstParent,
 *                 decorate: 'auto'|'short'|'full'|'no', dateStyle, abbrev,
 *                 config: { 'log.graphColors', 'color.decorate.*', ... } }
 * @returns { text, entries: [{ oid, start, end }], error? }
 */
export function renderLog(store, opts) {
  const recs = store.records;
  // git refuses --graph with --reverse; so does the simulator, rather than guess
  if (opts.graph && opts.reverse) return { text: "", entries: [], error: "options '--reverse' and '--graph' cannot be used together" };
  const order = walk(store, { all: opts.all, order: opts.order, firstParent: opts.firstParent, graph: opts.graph });
  // -N limits BEFORE --reverse is applied, as git does (the newest N, reversed)
  if (opts.maxCount !== undefined) order.splice(opts.maxCount);
  if (opts.reverse) order.reverse();
  const shownSet = new Set(order);
  const useColor = opts.color === "always";
  const cfg = opts.config || {};
  const graph = opts.graph
    ? new Graph(recs, shownSet, { color: useColor, firstParent: opts.firstParent,
                                   columnColors: parseGraphColors(cfg["log.graphColors"]) })
    : null;
  const pretty = opts.pretty || "tformat";
  const builtin = pretty !== "tformat" && pretty !== "format";
  const useTerminator = pretty === "tformat" || BUILTIN_TFORMAT.has(pretty);
  const formatEmpty = !builtin && !opts.template;          // commit_format_is_empty

  let out = "";
  const entries = [];
  let shownOne = false, missingNewline = false;
  const emit = s => { out += s; };
  const padding = () => { if (graph) emit(graph.paddingLine()); };
  const showOneline = () => { if (graph) emit(graph.nextLine().text); };

  // graph_show_commit(): rows up to and including the commit row
  const showCommit = () => {
    if (!graph) return;
    let shown = false;
    if (graph.isCommitFinished()) { padding(); shown = true; }
    while (!shown && !graph.isCommitFinished()) {
      const r = graph.nextLine();
      emit(r.text);
      shown = r.shownCommitLine;
      if (!shown) emit("\n");
    }
  };
  // graph_show_commit_msg()
  // msgMap[i] = output offset of message character i, so that attribution
  // spans computed on the message survive the graph rows interleaved into it
  let msgMap = null;
  const showCommitMsg = msg => {
    // graph_show_strbuf: graph prefix before every line but the first
    let p = 0;
    msgMap = new Array(msg.length + 1);
    while (p < msg.length) {
      const nl = msg.indexOf("\n", p);
      const end = nl < 0 ? msg.length : nl + 1;
      for (let k = p; k < end; k++) msgMap[k] = out.length + (k - p);
      emit(msg.slice(p, end));
      if (nl >= 0 && end < msg.length) showOneline();
      p = end;
    }
    msgMap[msg.length] = out.length;
    if (!graph) return;
    const nlTerminated = msg.length > 0 && msg[msg.length - 1] === "\n";
    if (!graph.isCommitFinished()) {
      if (!nlTerminated) emit("\n");
      // graph_show_remainder
      for (;;) {
        emit(graph.nextLine().text);
        if (!graph.isCommitFinished()) emit("\n"); else break;
      }
      if (nlTerminated) emit("\n");
    }
  };

  for (const oid of order) {
    // %S is walk-dependent: replace the record's host value with the source
    // this walk computed
    const rec = { ...recs[oid], host: { ...(recs[oid].host || {}), ref_name: order.sources.get(oid) } };
    if (graph) graph.update(oid);
    const start = out.length;

    // Separator between entries (format: and the non-tformat built-ins).
    if (shownOne && !useTerminator) {
      if (!missingNewline) padding();
      emit("\n");
    }
    shownOne = true;
    showCommit();

    let msg, spans = null;
    if (builtin) {
      // Built-in header: printed directly, before the message buffer.
      const parts = renderNamedParts(pretty, rec, {
        color: opts.color, dateStyle: opts.dateStyle, abbrev: opts.abbrev,
        decorations: opts.decorate === "short" || opts.decorate === "full"
          ? formatDecorations(parseDecoration(rec.host?.decoration_full_bare), {},
              { color: useColor, names: opts.decorate === "full" ? "full" : "short", config: cfg })
          : "",
        // --pretty=oneline shows FULL hashes; only the --oneline shorthand adds
        // --abbrev-commit. The two were conflated here once.
        abbrevCommit: !!opts.abbrevCommit, config: cfg });
      emit(parts.header);
      if (parts.headerNewline) { emit("\n"); showOneline(); }
      msg = parts.message;
    } else {
      const r = render(opts.template || "", rec, { color: opts.color, dateStyle: opts.dateStyle,
                                                   abbrev: opts.abbrev, decorate: opts.decorate, config: cfg });
      if (r.error) return { text: "", entries: [], error: r.error };
      msg = r.text; spans = r.spans;
    }
    missingNewline = !msg.length || msg[msg.length - 1] !== "\n";
    showCommitMsg(msg);
    if (useTerminator && !formatEmpty) {
      if (!missingNewline) padding();
      emit("\n");
    }
    entries.push({ oid, start, end: out.length,
                   spans: spans && spans.map(s => ({ node: s.node, start: msgMap[s.start], end: s.end > s.start ? msgMap[s.end - 1] + 1 : msgMap[s.start] })) });
  }
  return { text: out, entries };
}
