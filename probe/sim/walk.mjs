/*
 * Revision walk order -- a port of the parts of git's revision.c and
 * commit.c that decide WHICH commits appear and IN WHAT ORDER.
 *
 *   default            date walk: pop the newest commit, enqueue its parents
 *   --topo-order       limit_list() then sort_in_topological_order() with a
 *   (and --graph)      LIFO frontier (REV_SORT_IN_GRAPH_ORDER)
 *   --date-order       same, with a commit-date heap as the frontier
 *   --author-date-order   same, with an author-date heap
 *   --first-parent     only first parents are walked; graph shows one edge
 *
 * Judged by the "history" and "graph" families of the topology corpus.
 */

// A priority queue with git's semantics: with no comparator it is a LIFO
// stack; with one, a heap whose ties break by insertion order (ctr).
class PrioQueue {
  constructor(compare) { this.cmp = compare; this.a = []; this.ctr = 0; }
  put(x) { this.a.push({ x, ctr: this.ctr++ }); }
  reverse() { this.a.reverse(); }
  get() {
    if (!this.a.length) return null;
    if (!this.cmp) return this.a.pop().x;
    let best = 0;
    for (let i = 1; i < this.a.length; i++) {
      const c = this.cmp(this.a[i].x, this.a[best].x) || (this.a[i].ctr - this.a[best].ctr);
      if (c < 0) best = i;
    }
    return this.a.splice(best, 1)[0].x;
  }
}

// commit_list_insert_by_date: place before the first OLDER commit, i.e.
// after any equal-dated ones (stable).
function insertByDate(list, oid, recs) {
  const d = recs[oid].committer.ts;
  let i = 0;
  while (i < list.length && recs[list[i]].committer.ts >= d) i++;
  list.splice(i, 0, oid);
}

/**
 * @param store  { records, refs, head }
 * @param opts   { all: bool, order: 'default'|'topo'|'date'|'author-date',
 *                 firstParent: bool, graph: bool }
 * @returns ordered array of commit oids
 */
export function walk(store, opts = {}) {
  const recs = store.records;
  const parentsOf = oid => (opts.firstParent ? recs[oid].P.slice(0, 1) : recs[oid].P).filter(p => recs[p]);
  // Starting points: HEAD, plus every ref under --all.
  const tips = [];
  const seen = new Set();
  const addTip = oid => { if (oid && recs[oid] && !seen.has(oid)) { seen.add(oid); insertByDate(tips, oid, recs); } };
  // %S (the ref a commit was reached by) is computed here, as revision.c does:
  // each tip takes its own name, first assignment wins (so for-each-ref order,
  // then HEAD, decides between refs on one commit), and a parent takes the
  // source of the commit that first processes it, in date-walk order.
  const sources = new Map();
  const setSource = (oid, name) => { if (!sources.has(oid)) sources.set(oid, name); };
  if (opts.all) for (const r of store.refs) { if (recs[r.oid]) setSource(r.oid, r.name); addTip(r.oid); }
  if (store.head && recs[store.head]) setSource(store.head, "HEAD");
  addTip(store.head);

  // --graph implies topological order unless a date order was asked for.
  let order = opts.order || "default";
  if (opts.graph && order === "default") order = "topo";

  // The date walk: what limit_list() also does, in order to build its list.
  const dateWalk = () => {
    const out = [], list = tips.slice();
    while (list.length) {
      const c = list.shift();
      out.push(c);
      for (const p of parentsOf(c)) { setSource(p, sources.get(c)); if (!seen.has(p)) { seen.add(p); insertByDate(list, p, recs); } }
    }
    return out;
  };
  const dated = dateWalk();
  const done = list => Object.assign(list, { sources });
  if (order === "default") return done(dated);

  // sort_in_topological_order()
  const indeg = new Map();
  for (const c of dated) indeg.set(c, 1);
  // sort_in_topological_order() counts and releases over the commit's FULL
  // parent list, not the --first-parent view: under --all, a branch tip that
  // is a merge's second parent is still ordered as that merge's parent even
  // though the graph draws no edge to it. Only parents in the walked set count.
  const allParents = c => recs[c].P.filter(p => recs[p]);
  for (const c of dated) for (const p of allParents(c)) if (indeg.get(p)) indeg.set(p, indeg.get(p) + 1);
  const cmp = order === "date" ? (a, b) => recs[b].committer.ts - recs[a].committer.ts
            : order === "author-date" ? (a, b) => recs[b].author.ts - recs[a].author.ts
            : null;
  const q = new PrioQueue(cmp);
  for (const c of dated) if (indeg.get(c) === 1) q.put(c);
  // "the initial tips need to be shown in the order given from the revision
  // traversal machinery" -- a LIFO stack must be reversed to achieve that.
  if (!cmp) q.reverse();
  const out = [];
  let c;
  while ((c = q.get()) !== null) {
    for (const p of allParents(c)) {
      const pi = indeg.get(p);
      if (!pi) continue;
      indeg.set(p, pi - 1);
      if (pi - 1 === 1) q.put(p);
    }
    indeg.set(c, 0);
    out.push(c);
  }
  return done(out);
}
