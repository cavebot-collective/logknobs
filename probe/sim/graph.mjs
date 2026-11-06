/*
 * Port of git's graph.c (git 2.43): the --graph state machine.
 *
 * States: PADDING, SKIP, PRE_COMMIT, COMMIT, POST_MERGE, COLLAPSING.
 * Each call to nextLine() emits one row. Structure and names follow the C
 * source so that a divergence found by the corpus can be located by reading
 * the two side by side. Judged only by the topology corpus.
 *
 * Width accounting: color escape sequences add no width; '*' and edge
 * characters add one column each; rows are right-padded with spaces to the
 * graph's width (the trailing spaces are significant bytes).
 */
import { colorParse } from "./simulator.mjs";

export const PADDING = 0, SKIP = 1, PRE_COMMIT = 2, COMMIT = 3, POST_MERGE = 4, COLLAPSING = 5;

// git's built-in column colors (column_colors_ansi), RESET last.
const DEFAULT_COLUMN_COLORS = ["\x1b[31m", "\x1b[32m", "\x1b[33m", "\x1b[34m", "\x1b[35m", "\x1b[36m",
  "\x1b[1;31m", "\x1b[1;32m", "\x1b[1;33m", "\x1b[1;34m", "\x1b[1;35m", "\x1b[1;36m"];
const RESET = "\x1b[m";

/** log.graphColors: comma-separated specs; invalid entries are ignored by git
 *  (with a warning on stderr), which is reproduced here by skipping them. */
export function parseGraphColors(value) {
  if (value == null) return DEFAULT_COLUMN_COLORS.slice();
  const out = [];
  for (const part of String(value).split(",")) {
    try { out.push(colorParse(part)); } catch { /* ignored, as git does */ }
  }
  return out;
}

class Line {
  constructor() { this.buf = ""; this.width = 0; }
  addch(c) { this.buf += c; this.width++; }
  addchars(c, n) { if (n > 0) { this.buf += c.repeat(n); this.width += n; } }
  addstr(s) { this.buf += s; this.width += s.length; }
  addcolor(s) { this.buf += s; }
}

export class Graph {
  /**
   * @param recs        commit records by oid (need .P parents)
   * @param interesting Set of oids that are shown (get_commit_action == show)
   * @param opts        { color: bool, firstParent: bool, columnColors: [seq] }
   */
  constructor(recs, interesting, opts = {}) {
    this.recs = recs; this.interesting = interesting;
    this.firstParent = !!opts.firstParent;
    this.colors = opts.columnColors || DEFAULT_COLUMN_COLORS.slice();
    this.max = this.colors.length;          // column_colors_max
    this.useColor = !!opts.color;
    this.commit = null; this.numParents = 0; this.expansionRow = 0;
    this.state = PADDING; this.prevState = PADDING;
    this.commitIndex = 0; this.prevCommitIndex = 0;
    this.mergeLayout = 0; this.edgesAdded = 0; this.prevEdgesAdded = 0;
    this.width = 0;
    this.columns = []; this.newColumns = []; this.numColumns = 0; this.numNewColumns = 0;
    this.mapping = []; this.oldMapping = []; this.mappingSize = 0;
    // Start one below 0 so the first increment lands on 0.
    this.defaultColumnColor = this.max - 1;
  }

  // ---------------------------------------------------------- parents ----
  interestingParents() {
    const ps = this.recs[this.commit].P.filter(p => this.interesting.has(p));
    return this.firstParent ? ps.slice(0, 1) : ps;
  }

  // ----------------------------------------------------------- colors ----
  currentColor() { return this.useColor ? this.defaultColumnColor : this.max; }
  incrementColor() { this.defaultColumnColor = (this.defaultColumnColor + 1) % this.max; }
  findCommitColor(oid) {
    for (let i = 0; i < this.numColumns; i++) if (this.columns[i].commit === oid) return this.columns[i].color;
    return this.currentColor();
  }
  writeColumn(line, col, ch) {
    if (col.color < this.max) line.addcolor(this.colors[col.color]);
    line.addch(ch);
    if (col.color < this.max) line.addcolor(RESET);
  }

  // ---------------------------------------------------------- columns ----
  findNewColumnByCommit(oid) {
    for (let i = 0; i < this.numNewColumns; i++) if (this.newColumns[i].commit === oid) return i;
    return -1;
  }

  insertIntoNewColumns(oid, idx) {
    let i = this.findNewColumnByCommit(oid);
    let mappingIdx;
    if (i < 0) {
      i = this.numNewColumns++;
      this.newColumns[i] = { commit: oid, color: this.findCommitColor(oid) };
    }
    if (this.numParents > 1 && idx > -1 && this.mergeLayout === -1) {
      // First parent of a merge: choose a layout by whether that parent sits
      // to the left of the merge.
      const dist = idx - i;
      const shift = dist > 1 ? 2 * dist - 3 : 1;
      this.mergeLayout = dist > 0 ? 0 : 1;
      this.edgesAdded = this.numParents + this.mergeLayout - 2;
      mappingIdx = this.width + (this.mergeLayout - 1) * shift;
      this.width += 2 * this.mergeLayout;
    } else if (this.edgesAdded > 0 && i === this.mapping[this.width - 2]) {
      // Edges added by a merge whose commit landed in the last existing
      // column join immediately.
      mappingIdx = this.width - 2;
      this.edgesAdded = -1;
    } else {
      mappingIdx = this.width;
      this.width += 2;
    }
    this.mapping[mappingIdx] = i;
  }

  updateColumns() {
    // swap columns <-> newColumns
    [this.columns, this.newColumns] = [this.newColumns, this.columns];
    this.numColumns = this.numNewColumns;
    this.numNewColumns = 0;
    const maxNew = this.numColumns + this.numParents;
    this.mappingSize = 2 * maxNew;
    this.mapping = new Array(this.mappingSize).fill(-1);
    this.width = 0;
    this.prevEdgesAdded = this.edgesAdded;
    this.edgesAdded = 0;
    let seenThis = false, isCommitInColumns = true;
    for (let i = 0; i <= this.numColumns; i++) {
      let colCommit;
      if (i === this.numColumns) {
        if (seenThis) break;
        isCommitInColumns = false;
        colCommit = this.commit;
      } else colCommit = this.columns[i].commit;

      if (colCommit === this.commit) {
        seenThis = true;
        this.commitIndex = i;
        this.mergeLayout = -1;
        for (const p of this.interestingParents()) {
          // A merge, or the start of a new childless column, advances the color.
          if (this.numParents > 1 || !isCommitInColumns) this.incrementColor();
          this.insertIntoNewColumns(p, i);
        }
        // The commit itself always takes at least two columns.
        if (this.numParents === 0) this.width += 2;
      } else {
        this.insertIntoNewColumns(colCommit, -1);
      }
    }
    while (this.mappingSize > 1 && this.mapping[this.mappingSize - 1] < 0) this.mappingSize--;
  }

  // ------------------------------------------------------------ public ----
  update(oid) {
    this.commit = oid;
    this.numParents = this.interestingParents().length;
    this.prevCommitIndex = this.commitIndex;
    this.updateColumns();
    this.expansionRow = 0;
    if (this.state !== PADDING) this.state = SKIP;
    else if (this.needsPreCommitLine()) this.state = PRE_COMMIT;
    else this.state = COMMIT;
  }

  isCommitFinished() { return this.state === PADDING; }
  setState(s) { this.prevState = this.state; this.state = s; }

  numDashedParents() { return this.numParents + this.mergeLayout - 3; }
  numExpansionRows() { return this.numDashedParents() * 2; }
  needsPreCommitLine() {
    return this.numParents >= 3 && this.commitIndex < this.numColumns - 1 &&
           this.expansionRow < this.numExpansionRows();
  }

  isMappingCorrect() {
    for (let i = 0; i < this.mappingSize; i++) {
      const t = this.mapping[i];
      if (t < 0) continue;
      if (t === Math.floor(i / 2)) continue;
      return false;
    }
    return true;
  }

  padHorizontally(line) { if (line.width < this.width) line.addchars(" ", this.width - line.width); }

  /** One row. Returns { text, shownCommitLine }. */
  nextLine() {
    const line = new Line();
    let shown = false;
    switch (this.state) {
      case PADDING: this.outputPaddingLine(line); break;
      case SKIP: this.outputSkipLine(line); break;
      case PRE_COMMIT: this.outputPreCommitLine(line); break;
      case COMMIT: this.outputCommitLine(line); shown = true; break;
      case POST_MERGE: this.outputPostMergeLine(line); break;
      case COLLAPSING: this.outputCollapsingLine(line); break;
    }
    this.padHorizontally(line);
    return { text: line.buf, shownCommitLine: shown };
  }

  /** graph_padding_line(): used for padding before separators/terminators. */
  paddingLine() {
    if (this.state !== COMMIT) return this.nextLine().text;
    const line = new Line();
    for (let i = 0; i < this.numColumns; i++) {
      const col = this.columns[i];
      this.writeColumn(line, col, "|");
      if (col.commit === this.commit && this.numParents > 2) line.addchars(" ", (this.numParents - 2) * 2);
      else line.addch(" ");
    }
    this.padHorizontally(line);
    this.prevState = PADDING;
    return line.buf;
  }

  // ----------------------------------------------------------- rows ----
  outputPaddingLine(line) {
    for (let i = 0; i < this.numNewColumns; i++) {
      this.writeColumn(line, this.newColumns[i], "|");
      line.addch(" ");
    }
  }

  outputSkipLine(line) {
    line.addstr("...");
    this.setState(this.needsPreCommitLine() ? PRE_COMMIT : COMMIT);
  }

  outputPreCommitLine(line) {
    let seenThis = false;
    for (let i = 0; i < this.numColumns; i++) {
      const col = this.columns[i];
      if (col.commit === this.commit) {
        seenThis = true;
        this.writeColumn(line, col, "|");
        line.addchars(" ", this.expansionRow);
      } else if (seenThis && this.expansionRow === 0) {
        if (this.prevState === POST_MERGE && this.prevCommitIndex < i) this.writeColumn(line, col, "\\");
        else this.writeColumn(line, col, "|");
      } else if (seenThis && this.expansionRow > 0) {
        this.writeColumn(line, col, "\\");
      } else {
        this.writeColumn(line, col, "|");
      }
      line.addch(" ");
    }
    this.expansionRow++;
    if (!this.needsPreCommitLine()) this.setState(COMMIT);
  }

  drawOctopusMerge(line) {
    const dashed = this.numDashedParents();
    for (let i = 0; i < dashed; i++) {
      const j = this.mapping[(this.commitIndex + i + 2) * 2];
      const col = this.newColumns[j];
      this.writeColumn(line, col, "-");
      this.writeColumn(line, col, i === dashed - 1 ? "." : "-");
    }
  }

  outputCommitLine(line) {
    let seenThis = false;
    for (let i = 0; i <= this.numColumns; i++) {
      const col = this.columns[i];
      let colCommit;
      if (i === this.numColumns) {
        if (seenThis) break;
        colCommit = this.commit;
      } else colCommit = col.commit;

      if (colCommit === this.commit) {
        seenThis = true;
        line.addstr("*");                 // the commit mark is not colored
        if (this.numParents > 2) this.drawOctopusMerge(line);
      } else if (seenThis && this.edgesAdded > 1) {
        this.writeColumn(line, col, "\\");
      } else if (seenThis && this.edgesAdded === 1) {
        if (this.prevState === POST_MERGE && this.prevEdgesAdded > 0 && this.prevCommitIndex < i)
          this.writeColumn(line, col, "\\");
        else this.writeColumn(line, col, "|");
      } else if (this.prevState === COLLAPSING && this.oldMapping[2 * i + 1] === i && this.mapping[2 * i] < i) {
        this.writeColumn(line, col, "/");
      } else {
        this.writeColumn(line, col, "|");
      }
      line.addch(" ");
    }
    if (this.numParents > 1) this.setState(POST_MERGE);
    else if (this.isMappingCorrect()) this.setState(PADDING);
    else this.setState(COLLAPSING);
  }

  outputPostMergeLine(line) {
    const MERGE_CHARS = ["/", "|", "\\"];
    const parents = this.interestingParents();
    const firstParent = parents[0];
    let seenThis = false, parentCol = null;
    for (let i = 0; i <= this.numColumns; i++) {
      const col = this.columns[i];
      let colCommit;
      if (i === this.numColumns) {
        if (seenThis) break;
        colCommit = this.commit;
      } else colCommit = col.commit;

      if (colCommit === this.commit) {
        seenThis = true;
        let idx = this.mergeLayout;
        for (let j = 0; j < this.numParents; j++) {
          const parCol = this.findNewColumnByCommit(parents[j]);
          const c = MERGE_CHARS[idx];
          this.writeColumn(line, this.newColumns[parCol], c);
          if (idx === 2) {
            if (this.edgesAdded > 0 || j < this.numParents - 1) line.addch(" ");
          } else idx++;
        }
        if (this.edgesAdded === 0) line.addch(" ");
      } else if (seenThis) {
        this.writeColumn(line, col, this.edgesAdded > 0 ? "\\" : "|");
        line.addch(" ");
      } else {
        this.writeColumn(line, col, "|");
        if (this.mergeLayout !== 0 || i !== this.commitIndex - 1) {
          if (parentCol) this.writeColumn(line, parentCol, "_");
          else line.addch(" ");
        }
      }
      if (colCommit === firstParent) parentCol = col;
    }
    this.setState(this.isMappingCorrect() ? PADDING : COLLAPSING);
  }

  outputCollapsingLine(line) {
    let usedHorizontal = false, horizontalEdge = -1, horizontalEdgeTarget = -1;
    [this.mapping, this.oldMapping] = [this.oldMapping, this.mapping];
    for (let i = 0; i < this.mappingSize; i++) this.mapping[i] = -1;
    for (let i = 0; i < this.mappingSize; i++) {
      const target = this.oldMapping[i];
      if (target === undefined || target < 0) continue;
      if (target * 2 === i) {
        this.mapping[i] = target;
      } else if (!(this.mapping[i - 1] >= 0)) {
        this.mapping[i - 1] = target;
        if (horizontalEdge === -1) {
          horizontalEdge = i;
          horizontalEdgeTarget = target;
          for (let j = target * 2 + 3; j < i - 2; j += 2) this.mapping[j] = target;
        }
      } else if (this.mapping[i - 1] === target) {
        // shares the branch line to its left; nothing to draw
      } else {
        this.mapping[i - 2] = target;
        if (horizontalEdge === -1) {
          horizontalEdgeTarget = target;
          horizontalEdge = i - 1;
          for (let j = target * 2 + 3; j < i - 2; j += 2) this.mapping[j] = target;
        }
      }
    }
    // COPY_ARRAY(old_mapping, mapping)
    this.oldMapping = this.mapping.slice(0, this.mappingSize);
    if (this.mapping[this.mappingSize - 1] < 0) this.mappingSize--;
    for (let i = 0; i < this.mappingSize; i++) {
      const target = this.mapping[i];
      if (target < 0) line.addch(" ");
      else if (target * 2 === i) this.writeColumn(line, this.newColumns[target], "|");
      else if (target === horizontalEdgeTarget && i !== horizontalEdge - 1) {
        if (i !== target * 2 + 3) this.mapping[i] = -1;
        usedHorizontal = true;
        this.writeColumn(line, this.newColumns[target], "_");
      } else {
        if (usedHorizontal && i < horizontalEdge) this.mapping[i] = -1;
        this.writeColumn(line, this.newColumns[target], "/");
      }
    }
    if (this.isMappingCorrect()) this.setState(PADDING);
  }
}
