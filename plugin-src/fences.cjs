'use strict';

// Block scanner for fenced and indented code blocks.
//
// This is a faithful port of the markdown-it block rules the plugin needs
// (table, code, fence, blockquote, hr, list, reference, heading, lheading,
// paragraph) with html_block disabled (the plugin parses with html:false).
// markdown-it's line-state model is reproduced exactly — bMarks / eMarks /
// tShift / sCount / bsCount plus the blkIndent / listIndent / parentType
// block variables, including the container rules that rewrite line state and
// restore it afterwards — so fence discovery is identical to the markdown-it
// implementation this replaces. Equivalence is enforced by
// tools/fence-diff-test.cjs against a golden corpus captured from markdown-it
// (plugin-src/tests/fixtures/fence-golden.json, 104 cases) and by
// tools/fence-fuzz-test.cjs, which compares both implementations on random
// documents.

const { canonical } = require('./engine.cjs');

const MAX_NESTING = 100;
const MAX_AUTOCOMPLETED_CELLS = 0x10000;

function isSpaceCode(code) {
  return code === 0x09 || code === 0x20;
}

function skipSpaces(src, pos) {
  for (let max = src.length; pos < max; pos++) {
    if (!isSpaceCode(src.charCodeAt(pos))) break;
  }
  return pos;
}

function skipChars(src, pos, code) {
  for (let max = src.length; pos < max; pos++) {
    if (src.charCodeAt(pos) !== code) break;
  }
  return pos;
}

function skipCharsBack(src, pos, code, min) {
  if (pos <= min) return pos;
  while (pos > min) {
    if (code !== src.charCodeAt(--pos)) return pos + 1;
  }
  return pos;
}

function skipSpacesBack(src, pos, min) {
  if (pos <= min) return pos;
  while (pos > min) {
    if (!isSpaceCode(src.charCodeAt(--pos))) return pos + 1;
  }
  return pos;
}

// markdown-it StateBlock line preprocessing: per-line begin/end offsets, the
// leading-whitespace character count, the visual indent (tabs expanded to
// stops of 4) and the virtual tab offset. A trailing newline does not create
// an extra line, one fake tail entry simplifies bounds checks, and a final
// line that is entirely whitespace (with no trailing newline) is dropped
// altogether — markdown-it's line scan only emits a line at a '\n' or at the
// last character, and leading whitespace never reaches that check.
function createState(text) {
  const parts = text.split('\n');
  let lineMax = parts.length;
  if (parts[lineMax - 1] === '') lineMax--;
  else if (/^[ \t]*$/.test(parts[lineMax - 1])) lineMax--;
  const state = {
    src: text,
    bMarks: [], eMarks: [], tShift: [], sCount: [], bsCount: [],
    lineMax,
    line: 0,
    blkIndent: 0,
    listIndent: -1,
    parentType: 'root',
    level: 0,
    tokens: [],
  };
  let start = 0;
  for (let i = 0; i < lineMax; i++) {
    const line = parts[i];
    let indent = 0;
    let offset = 0;
    let j = 0;
    while (j < line.length) {
      const ch = line.charCodeAt(j);
      if (ch === 0x20) offset++;
      else if (ch === 0x09) offset += 4 - offset % 4;
      else break;
      indent++;
      j++;
    }
    state.bMarks.push(start);
    state.eMarks.push(start + line.length);
    state.tShift.push(indent);
    state.sCount.push(offset);
    state.bsCount.push(0);
    start += line.length + 1;
  }
  state.bMarks.push(text.length);
  state.eMarks.push(text.length);
  state.tShift.push(0);
  state.sCount.push(0);
  state.bsCount.push(0);
  return state;
}

function stateIsEmpty(state, line) {
  return state.bMarks[line] + state.tShift[line] >= state.eMarks[line];
}

function stateSkipEmptyLines(state, from) {
  for (let max = state.lineMax; from < max; from++) {
    if (state.bMarks[from] + state.tShift[from] < state.eMarks[from]) break;
  }
  return from;
}

// Cut a line range, dedenting by `indent` visual columns. Characters masked
// by container rules (blockquote markers, list markers) count as one column
// each, and a tab that straddles the boundary leaves its overflow as literal
// spaces — markdown-it's exact getLines() behaviour.
function getLines(state, begin, end, indent, keepLastLF) {
  if (begin >= end) return '';
  const queue = new Array(end - begin);
  for (let i = 0, line = begin; line < end; line++, i++) {
    let lineIndent = 0;
    const lineStart = state.bMarks[line];
    let first = lineStart;
    let last;
    if (line + 1 < end || keepLastLF) last = state.eMarks[line] + 1;
    else last = state.eMarks[line];
    while (first < last && lineIndent < indent) {
      const ch = state.src.charCodeAt(first);
      if (isSpaceCode(ch)) {
        if (ch === 0x09) lineIndent += 4 - (lineIndent + state.bsCount[line]) % 4;
        else lineIndent++;
      } else if (first - lineStart < state.tShift[line]) {
        lineIndent++;
      } else {
        break;
      }
      first++;
    }
    if (lineIndent > indent) {
      queue[i] = new Array(lineIndent - indent + 1).join(' ') + state.src.slice(first, last);
    } else {
      queue[i] = state.src.slice(first, last);
    }
  }
  return queue.join('');
}

function getLine(state, line) {
  return state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
}

function escapedSplit(str) {
  const result = [];
  const max = str.length;
  let pos = 0;
  let isEscaped = false;
  let lastPos = 0;
  let current = '';
  while (pos < max) {
    const ch = str.charCodeAt(pos);
    if (ch === 0x7C && !isEscaped) {
      result.push(current + str.substring(lastPos, pos));
      current = '';
      lastPos = pos + 1;
    } else if (ch === 0x7C) {
      current += str.substring(lastPos, pos - 1);
      lastPos = pos;
    }
    isEscaped = ch === 0x5C;
    pos++;
  }
  result.push(current + str.substring(lastPos));
  return result;
}

// GFM table. Only the line-consumption behaviour matters here; no tokens are
// emitted. The rule gates whether following lines are paragraph content.
function ruleTable(state, startLine, endLine, silent) {
  if (startLine + 2 > endLine) return false;
  let nextLine = startLine + 1;
  if (state.sCount[nextLine] < state.blkIndent) return false;
  if (state.sCount[nextLine] - state.blkIndent >= 4) return false;
  let pos = state.bMarks[nextLine] + state.tShift[nextLine];
  if (pos >= state.eMarks[nextLine]) return false;
  const firstCh = state.src.charCodeAt(pos++);
  if (firstCh !== 0x7C && firstCh !== 0x2D && firstCh !== 0x3A) return false;
  if (pos >= state.eMarks[nextLine]) return false;
  const secondCh = state.src.charCodeAt(pos++);
  if (secondCh !== 0x7C && secondCh !== 0x2D && secondCh !== 0x3A && !isSpaceCode(secondCh)) return false;
  if (firstCh === 0x2D && isSpaceCode(secondCh)) return false;
  while (pos < state.eMarks[nextLine]) {
    const ch = state.src.charCodeAt(pos);
    if (ch !== 0x7C && ch !== 0x2D && ch !== 0x3A && !isSpaceCode(ch)) return false;
    pos++;
  }
  const columns = getLine(state, nextLine).split('|');
  const aligns = [];
  for (let i = 0; i < columns.length; i++) {
    const t = columns[i].trim();
    if (!t) {
      if (i === 0 || i === columns.length - 1) continue;
      return false;
    }
    if (!/^:?-+:?$/.test(t)) return false;
    if (t.charCodeAt(t.length - 1) === 0x3A) aligns.push(t.charCodeAt(0) === 0x3A ? 'center' : 'right');
    else if (t.charCodeAt(0) === 0x3A) aligns.push('left');
    else aligns.push('');
  }
  let lineText = getLine(state, startLine).trim();
  if (lineText.indexOf('|') === -1) return false;
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  let headerColumns = escapedSplit(lineText);
  if (headerColumns.length && headerColumns[0] === '') headerColumns.shift();
  if (headerColumns.length && headerColumns[headerColumns.length - 1] === '') headerColumns.pop();
  const columnCount = headerColumns.length;
  if (columnCount === 0 || columnCount !== aligns.length) return false;
  if (silent) return true;

  const oldParentType = state.parentType;
  state.parentType = 'table';
  let autocompletedCells = 0;
  for (nextLine = startLine + 2; nextLine < endLine; nextLine++) {
    if (state.sCount[nextLine] < state.blkIndent) break;
    let terminate = false;
    for (const rule of BLOCKQUOTE_TERMINATORS) {
      if (rule(state, nextLine, endLine, true)) { terminate = true; break; }
    }
    if (terminate) break;
    lineText = getLine(state, nextLine).trim();
    if (!lineText) break;
    if (state.sCount[nextLine] - state.blkIndent >= 4) break;
    const rowColumns = escapedSplit(lineText);
    if (rowColumns.length && rowColumns[0] === '') rowColumns.shift();
    if (rowColumns.length && rowColumns[rowColumns.length - 1] === '') rowColumns.pop();
    autocompletedCells += columnCount - rowColumns.length;
    if (autocompletedCells > MAX_AUTOCOMPLETED_CELLS) break;
  }
  state.parentType = oldParentType;
  state.line = nextLine;
  return true;
}

// Indented code block (4 spaces past the current block indent).
function ruleCode(state, startLine, endLine) {
  if (state.sCount[startLine] - state.blkIndent < 4) return false;
  let nextLine = startLine + 1;
  let last = nextLine;
  while (nextLine < endLine) {
    if (stateIsEmpty(state, nextLine)) { nextLine++; continue; }
    if (state.sCount[nextLine] - state.blkIndent >= 4) { nextLine++; last = nextLine; continue; }
    break;
  }
  state.line = last;
  state.tokens.push({
    type: 'code_block',
    content: getLines(state, startLine, last, 4 + state.blkIndent, false) + '\n',
    map: [startLine, state.line],
  });
  return true;
}

function ruleFence(state, startLine, endLine, silent) {
  let pos = state.bMarks[startLine] + state.tShift[startLine];
  let max = state.eMarks[startLine];
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  if (pos + 3 > max) return false;
  const marker = state.src.charCodeAt(pos);
  if (marker !== 0x7E && marker !== 0x60) return false;
  const mem = pos;
  pos = skipChars(state.src, pos, marker);
  let len = pos - mem;
  if (len < 3) return false;
  const params = state.src.slice(pos, max);
  if (marker === 0x60 && params.indexOf(String.fromCharCode(marker)) >= 0) return false;
  if (silent) return true;

  let nextLine = startLine;
  let haveEndMarker = false;
  for (;;) {
    nextLine++;
    if (nextLine >= endLine) break;
    const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
    pos = lineStart;
    max = state.eMarks[nextLine];
    if (pos < max && state.sCount[nextLine] < state.blkIndent) break;
    if (state.src.charCodeAt(pos) !== marker) continue;
    if (state.sCount[nextLine] - state.blkIndent >= 4) continue;
    pos = skipChars(state.src, pos, marker);
    if (pos - lineStart < len) continue;
    pos = skipSpaces(state.src, pos);
    if (pos < max) continue;
    haveEndMarker = true;
    break;
  }
  len = state.sCount[startLine];
  state.line = nextLine + (haveEndMarker ? 1 : 0);
  state.tokens.push({
    type: 'fence',
    info: params,
    content: getLines(state, startLine + 1, nextLine, len, true),
    map: [startLine, state.line],
  });
  return true;
}

function ruleBlockquote(state, startLine, endLine, silent) {
  let pos = state.bMarks[startLine] + state.tShift[startLine];
  const oldLineMax = state.lineMax;
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  if (state.src.charCodeAt(pos) !== 0x3E) return false;
  if (silent) return true;

  const oldBMarks = [];
  const oldBSCount = [];
  const oldSCount = [];
  const oldTShift = [];
  const oldParentType = state.parentType;
  state.parentType = 'blockquote';
  let lastLineEmpty = false;
  let nextLine;

  for (nextLine = startLine; nextLine < endLine; nextLine++) {
    const isOutdented = state.sCount[nextLine] < state.blkIndent;
    pos = state.bMarks[nextLine] + state.tShift[nextLine];
    const max = state.eMarks[nextLine];
    if (pos >= max) break;

    if (state.src.charCodeAt(pos++) === 0x3E && !isOutdented) {
      let initial = state.sCount[nextLine] + 1;
      let spaceAfterMarker;
      let adjustTab;
      if (state.src.charCodeAt(pos) === 0x20) {
        pos++;
        initial++;
        adjustTab = false;
        spaceAfterMarker = true;
      } else if (state.src.charCodeAt(pos) === 0x09) {
        spaceAfterMarker = true;
        if ((state.bsCount[nextLine] + initial) % 4 === 3) {
          pos++;
          initial++;
          adjustTab = false;
        } else {
          adjustTab = true;
        }
      } else {
        spaceAfterMarker = false;
      }
      let offset = initial;
      oldBMarks.push(state.bMarks[nextLine]);
      state.bMarks[nextLine] = pos;
      while (pos < max) {
        const ch = state.src.charCodeAt(pos);
        if (isSpaceCode(ch)) {
          if (ch === 0x09) offset += 4 - (offset + state.bsCount[nextLine] + (adjustTab ? 1 : 0)) % 4;
          else offset++;
        } else {
          break;
        }
        pos++;
      }
      lastLineEmpty = pos >= max;
      oldBSCount.push(state.bsCount[nextLine]);
      state.bsCount[nextLine] = state.sCount[nextLine] + 1 + (spaceAfterMarker ? 1 : 0);
      oldSCount.push(state.sCount[nextLine]);
      state.sCount[nextLine] = offset - initial;
      oldTShift.push(state.tShift[nextLine]);
      state.tShift[nextLine] = pos - state.bMarks[nextLine];
      continue;
    }

    if (lastLineEmpty) break;

    let terminate = false;
    for (const rule of BLOCKQUOTE_TERMINATORS) {
      if (rule(state, nextLine, endLine, true)) { terminate = true; break; }
    }
    if (terminate) {
      state.lineMax = nextLine;
      if (state.blkIndent !== 0) {
        oldBMarks.push(state.bMarks[nextLine]);
        oldBSCount.push(state.bsCount[nextLine]);
        oldTShift.push(state.tShift[nextLine]);
        oldSCount.push(state.sCount[nextLine]);
        state.sCount[nextLine] -= state.blkIndent;
      }
      break;
    }

    oldBMarks.push(state.bMarks[nextLine]);
    oldBSCount.push(state.bsCount[nextLine]);
    oldTShift.push(state.tShift[nextLine]);
    oldSCount.push(state.sCount[nextLine]);
    // A negative indent marks a lazy paragraph continuation line.
    state.sCount[nextLine] = -1;
  }

  const oldIndent = state.blkIndent;
  state.blkIndent = 0;
  state.level++;
  tokenize(state, startLine, nextLine);
  state.level--;
  state.lineMax = oldLineMax;
  state.parentType = oldParentType;
  for (let i = 0; i < oldTShift.length; i++) {
    state.bMarks[i + startLine] = oldBMarks[i];
    state.tShift[i + startLine] = oldTShift[i];
    state.sCount[i + startLine] = oldSCount[i];
    state.bsCount[i + startLine] = oldBSCount[i];
  }
  state.blkIndent = oldIndent;
  return true;
}

function ruleHr(state, startLine, endLine, silent) {
  const max = state.eMarks[startLine];
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  let pos = state.bMarks[startLine] + state.tShift[startLine];
  const marker = state.src.charCodeAt(pos++);
  if (marker !== 0x2A && marker !== 0x2D && marker !== 0x5F) return false;
  let cnt = 1;
  while (pos < max) {
    const ch = state.src.charCodeAt(pos++);
    if (ch !== marker && !isSpaceCode(ch)) return false;
    if (ch === marker) cnt++;
  }
  if (cnt < 3) return false;
  if (silent) return true;
  state.line = startLine + 1;
  return true;
}

function skipBulletListMarker(state, startLine) {
  const max = state.eMarks[startLine];
  let pos = state.bMarks[startLine] + state.tShift[startLine];
  const marker = state.src.charCodeAt(pos++);
  if (marker !== 0x2A && marker !== 0x2D && marker !== 0x2B) return -1;
  if (pos < max) {
    if (!isSpaceCode(state.src.charCodeAt(pos))) return -1;
  }
  return pos;
}

function skipOrderedListMarker(state, startLine) {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  let pos = start;
  if (pos + 1 >= max) return -1;
  let ch = state.src.charCodeAt(pos++);
  if (ch < 0x30 || ch > 0x39) return -1;
  for (;;) {
    if (pos >= max) return -1;
    ch = state.src.charCodeAt(pos++);
    if (ch >= 0x30 && ch <= 0x39) {
      if (pos - start >= 10) return -1;
      continue;
    }
    if (ch === 0x29 || ch === 0x2E) break;
    return -1;
  }
  if (pos < max) {
    if (!isSpaceCode(state.src.charCodeAt(pos))) return -1;
  }
  return pos;
}

function ruleList(state, startLine, endLine, silent) {
  let max, pos, start;
  let nextLine = startLine;
  if (state.sCount[nextLine] - state.blkIndent >= 4) return false;
  if (state.listIndent >= 0 &&
      state.sCount[nextLine] - state.listIndent >= 4 &&
      state.sCount[nextLine] < state.blkIndent) {
    return false;
  }

  let isTerminatingParagraph = false;
  if (silent && state.parentType === 'paragraph') {
    if (state.sCount[nextLine] >= state.blkIndent) isTerminatingParagraph = true;
  }

  let isOrdered;
  let posAfterMarker;
  if ((posAfterMarker = skipOrderedListMarker(state, nextLine)) >= 0) {
    isOrdered = true;
    start = state.bMarks[nextLine] + state.tShift[nextLine];
    if (isTerminatingParagraph && Number(state.src.slice(start, posAfterMarker - 1)) !== 1) return false;
  } else if ((posAfterMarker = skipBulletListMarker(state, nextLine)) >= 0) {
    isOrdered = false;
  } else {
    return false;
  }
  if (isTerminatingParagraph) {
    if (skipSpaces(state.src, posAfterMarker) >= state.eMarks[nextLine]) return false;
  }
  if (silent) return true;

  const markerCharCode = state.src.charCodeAt(posAfterMarker - 1);
  const oldParentType = state.parentType;
  state.parentType = 'list';

  while (nextLine < endLine) {
    pos = posAfterMarker;
    max = state.eMarks[nextLine];
    const initial = state.sCount[nextLine] + posAfterMarker - (state.bMarks[nextLine] + state.tShift[nextLine]);
    let offset = initial;
    while (pos < max) {
      const ch = state.src.charCodeAt(pos);
      if (ch === 0x09) offset += 4 - (offset + state.bsCount[nextLine]) % 4;
      else if (ch === 0x20) offset++;
      else break;
      pos++;
    }
    const contentStart = pos;
    let indentAfterMarker;
    if (contentStart >= max) indentAfterMarker = 1;
    else indentAfterMarker = offset - initial;
    if (indentAfterMarker > 4) indentAfterMarker = 1;
    const indent = initial + indentAfterMarker;

    const oldTShift = state.tShift[nextLine];
    const oldSCount = state.sCount[nextLine];
    const oldListIndent = state.listIndent;
    state.listIndent = state.blkIndent;
    state.blkIndent = indent;
    state.tShift[nextLine] = contentStart - state.bMarks[nextLine];
    state.sCount[nextLine] = offset;

    if (contentStart >= max && stateIsEmpty(state, nextLine + 1)) {
      state.line = Math.min(state.line + 2, endLine);
    } else {
      state.level++;
      tokenize(state, nextLine, endLine);
      state.level--;
    }

    state.blkIndent = state.listIndent;
    state.listIndent = oldListIndent;
    state.tShift[nextLine] = oldTShift;
    state.sCount[nextLine] = oldSCount;

    nextLine = state.line;
    if (nextLine >= endLine) break;
    if (state.sCount[nextLine] < state.blkIndent) break;
    if (state.sCount[nextLine] - state.blkIndent >= 4) break;
    let terminate = false;
    for (const rule of LIST_TERMINATORS) {
      if (rule(state, nextLine, endLine, true)) { terminate = true; break; }
    }
    if (terminate) break;
    if (isOrdered) {
      posAfterMarker = skipOrderedListMarker(state, nextLine);
      if (posAfterMarker < 0) break;
      start = state.bMarks[nextLine] + state.tShift[nextLine];
    } else {
      posAfterMarker = skipBulletListMarker(state, nextLine);
      if (posAfterMarker < 0) break;
    }
    if (markerCharCode !== state.src.charCodeAt(posAfterMarker - 1)) break;
  }

  state.parentType = oldParentType;
  state.line = nextLine;
  return true;
}

// markdown-it reference definitions. The parsed label, destination and title
// are discarded — only the consumed line range matters — but the rule must
// accept and reject exactly the same inputs as markdown-it's, because a
// matched reference removes its lines from paragraph flow, which changes
// whether a following list marker may interrupt a paragraph.
const UNESCAPE_ALL_RE = /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g;
const BAD_PROTO_RE = /^(vbscript|javascript|file|data):/;
const GOOD_DATA_RE = /^data:image\/(gif|png|jpeg|webp);/;

function unescapeAll(str) {
  if (str.indexOf('\\') < 0) return str;
  return str.replace(UNESCAPE_ALL_RE, '$1');
}

// markdown-it normalizeLink is only needed to store the href, which the
// scanner discards; validateLink runs on the raw destination.
function validateLink(url) {
  const str = url.trim().toLowerCase();
  return BAD_PROTO_RE.test(str) ? GOOD_DATA_RE.test(str) : true;
}

function parseLinkDestination(str, start, max) {
  let pos = start;
  const result = { ok: false, pos: 0, str: '' };
  if (str.charCodeAt(pos) === 0x3C /* < */) {
    pos++;
    while (pos < max) {
      const code = str.charCodeAt(pos);
      if (code === 0x0A /* \n */ || code === 0x3C /* < */) return result;
      if (code === 0x3E /* > */) {
        result.pos = pos + 1;
        result.str = unescapeAll(str.slice(start + 1, pos));
        result.ok = true;
        return result;
      }
      if (code === 0x5C /* \ */ && pos + 1 < max) {
        pos += 2;
        continue;
      }
      pos++;
    }
    // no closing '>'
    return result;
  }

  let level = 0;
  while (pos < max) {
    const code = str.charCodeAt(pos);
    if (code === 0x20) break;
    // ascii control characters
    if (code < 0x20 || code === 0x7F) break;
    if (code === 0x5C /* \ */ && pos + 1 < max) {
      if (str.charCodeAt(pos + 1) === 0x20) break;
      pos += 2;
      continue;
    }
    if (code === 0x28 /* ( */) {
      level++;
      if (level > 32) return result;
    }
    if (code === 0x29 /* ) */) {
      if (level === 0) break;
      level--;
    }
    pos++;
  }
  if (start === pos) return result;
  if (level !== 0) return result;
  result.str = unescapeAll(str.slice(start, pos));
  result.pos = pos;
  result.ok = true;
  return result;
}

function parseLinkTitle(str, start, max, prevState) {
  let pos = start;
  const state = { ok: false, can_continue: false, pos: 0, str: '', marker: 0 };
  if (prevState) {
    // continuation of a previous parseLinkTitle call on the next line
    state.str = prevState.str;
    state.marker = prevState.marker;
  } else {
    if (pos >= max) return state;
    let marker = str.charCodeAt(pos);
    if (marker !== 0x22 /* " */ && marker !== 0x27 /* ' */ && marker !== 0x28 /* ( */) return state;
    start++;
    pos++;
    // if opening marker is "(", switch it to closing marker ")"
    if (marker === 0x28) marker = 0x29;
    state.marker = marker;
  }
  while (pos < max) {
    const code = str.charCodeAt(pos);
    if (code === state.marker) {
      state.pos = pos + 1;
      state.str += unescapeAll(str.slice(start, pos));
      state.ok = true;
      return state;
    } else if (code === 0x28 /* ( */ && state.marker === 0x29 /* ) */) {
      return state;
    } else if (code === 0x5C /* \ */ && pos + 1 < max) {
      pos++;
    }
    pos++;
  }
  // no closing marker found, but this link title may continue on the next line
  state.can_continue = true;
  state.str += unescapeAll(str.slice(start, pos));
  return state;
}

function ruleReference(state, startLine, endLine, silent) {
  let pos = state.bMarks[startLine] + state.tShift[startLine];
  let max = state.eMarks[startLine];
  let nextLine = startLine + 1;

  // if it's indented more than 3 spaces, it should be a code block
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  if (state.src.charCodeAt(pos) !== 0x5B /* [ */) return false;

  function getNextLine(nextLine) {
    const endLine = state.lineMax;
    if (nextLine >= endLine || stateIsEmpty(state, nextLine)) {
      // empty line or end of input
      return null;
    }
    let isContinuation = false;
    // this would be a code block normally, but after paragraph
    // it's considered a lazy continuation regardless of what's there
    if (state.sCount[nextLine] - state.blkIndent > 3) isContinuation = true;
    // quirk for blockquotes, this line should already be checked by that rule
    if (state.sCount[nextLine] < 0) isContinuation = true;
    if (!isContinuation) {
      // markdown-it's 'reference' terminator chain equals the 'paragraph'
      // chain here (html_block is disabled).
      const terminatorRules = PARAGRAPH_TERMINATORS;
      const oldParentType = state.parentType;
      state.parentType = 'reference';
      let terminate = false;
      for (const rule of terminatorRules) {
        if (rule(state, nextLine, endLine, true)) {
          terminate = true;
          break;
        }
      }
      state.parentType = oldParentType;
      if (terminate) {
        // terminated by another block
        return null;
      }
    }
    const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
    const lineEnd = state.eMarks[nextLine];
    // max + 1 explicitly includes the newline
    return state.src.slice(lineStart, lineEnd + 1);
  }

  let str = state.src.slice(pos, max + 1);
  max = str.length;
  let labelEnd = -1;

  for (pos = 1; pos < max; pos++) {
    const ch = str.charCodeAt(pos);
    if (ch === 0x5B /* [ */) {
      return false;
    } else if (ch === 0x5D /* ] */) {
      labelEnd = pos;
      break;
    } else if (ch === 0x0A /* \n */) {
      const lineContent = getNextLine(nextLine);
      if (lineContent !== null) {
        str += lineContent;
        max = str.length;
        nextLine++;
      }
    } else if (ch === 0x5C /* \ */) {
      pos++;
      if (pos < max && str.charCodeAt(pos) === 0x0A) {
        const lineContent = getNextLine(nextLine);
        if (lineContent !== null) {
          str += lineContent;
          max = str.length;
          nextLine++;
        }
      }
    }
  }

  if (labelEnd < 0 || str.charCodeAt(labelEnd + 1) !== 0x3A /* : */) return false;

  // [label]:   destination   'title'
  //         ^^^ skip optional whitespace here
  for (pos = labelEnd + 2; pos < max; pos++) {
    const ch = str.charCodeAt(pos);
    if (ch === 0x0A) {
      const lineContent = getNextLine(nextLine);
      if (lineContent !== null) {
        str += lineContent;
        max = str.length;
        nextLine++;
      }
    } else if (isSpaceCode(ch)) {
      /* eslint no-empty:0 */
    } else {
      break;
    }
  }

  // [label]:   destination   'title'
  //            ^^^^^^^^^^^ parse this
  const destRes = parseLinkDestination(str, pos, max);
  if (!destRes.ok) return false;
  if (!validateLink(destRes.str)) return false;

  pos = destRes.pos;

  // save cursor state, we could require to rollback later
  const destEndPos = pos;
  const destEndLineNo = nextLine;

  // [label]:   destination   'title'
  //                       ^^^ skipping those spaces
  const start = pos;
  for (; pos < max; pos++) {
    const ch = str.charCodeAt(pos);
    if (ch === 0x0A) {
      const lineContent = getNextLine(nextLine);
      if (lineContent !== null) {
        str += lineContent;
        max = str.length;
        nextLine++;
      }
    } else if (isSpaceCode(ch)) {
      /* eslint no-empty:0 */
    } else {
      break;
    }
  }

  // [label]:   destination   'title'
  //                          ^^^^^^^ parse this
  let titleRes = parseLinkTitle(str, pos, max);
  while (titleRes.can_continue) {
    const lineContent = getNextLine(nextLine);
    if (lineContent === null) break;
    str += lineContent;
    pos = max;
    max = str.length;
    nextLine++;
    titleRes = parseLinkTitle(str, pos, max, titleRes);
  }
  let title;

  if (pos < max && start !== pos && titleRes.ok) {
    title = titleRes.str;
    pos = titleRes.pos;
  } else {
    title = '';
    pos = destEndPos;
    nextLine = destEndLineNo;
  }

  // skip trailing spaces until the rest of the line
  while (pos < max) {
    const ch = str.charCodeAt(pos);
    if (!isSpaceCode(ch)) break;
    pos++;
  }

  if (pos < max && str.charCodeAt(pos) !== 0x0A) {
    if (title) {
      // garbage at the end of the line after title,
      // but it could still be a valid reference if we roll back
      title = '';
      pos = destEndPos;
      nextLine = destEndLineNo;
      while (pos < max) {
        const ch = str.charCodeAt(pos);
        if (!isSpaceCode(ch)) break;
        pos++;
      }
    }
  }

  if (pos < max && str.charCodeAt(pos) !== 0x0A) {
    // garbage at the end of the line
    return false;
  }

  // normalizeReference() is empty exactly when the label has no non-space
  // characters; CommonMark 0.20 disallows empty labels.
  if (!str.slice(1, labelEnd).trim()) return false;

  // Reference can not terminate anything. This check is for safety only.
  if (silent) return true;

  state.line = nextLine;
  return true;
}

function ruleHeading(state, startLine, endLine, silent) {
  let pos = state.bMarks[startLine] + state.tShift[startLine];
  let max = state.eMarks[startLine];
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  let ch = state.src.charCodeAt(pos);
  if (ch !== 0x23 || pos >= max) return false;
  let level = 1;
  ch = state.src.charCodeAt(++pos);
  while (ch === 0x23 && pos < max && level <= 6) {
    level++;
    ch = state.src.charCodeAt(++pos);
  }
  if (level > 6 || (pos < max && !isSpaceCode(ch))) return false;
  if (silent) return true;
  state.line = startLine + 1;
  return true;
}

// Setext heading underline (=== / ---). The rule emits no fence or code_block
// token itself, but it consumes the paragraph plus its underline, which
// decides whether following indented lines are code blocks or lazy paragraph
// continuations — so it must stay in the rule chain, in markdown-it's order
// (after heading, before paragraph).
function ruleLheading(state, startLine, endLine) {
  const terminatorRules = PARAGRAPH_TERMINATORS;

  // if it's indented more than 3 spaces, it should be a code block
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;

  const oldParentType = state.parentType;
  state.parentType = 'paragraph'; // use paragraph to match terminatorRules

  let level = 0;
  let marker;
  let nextLine = startLine + 1;

  for (; nextLine < endLine && !stateIsEmpty(state, nextLine); nextLine++) {
    // this would be a code block normally, but after paragraph
    // it's considered a lazy continuation regardless of what's there
    if (state.sCount[nextLine] - state.blkIndent > 3) continue;

    // check for underline in setext header
    if (state.sCount[nextLine] >= state.blkIndent) {
      let pos = state.bMarks[nextLine] + state.tShift[nextLine];
      const max = state.eMarks[nextLine];
      if (pos < max) {
        marker = state.src.charCodeAt(pos);
        if (marker === 0x2D /* - */ || marker === 0x3D /* = */) {
          pos = skipChars(state.src, pos, marker);
          pos = skipSpaces(state.src, pos);
          if (pos >= max) {
            level = marker === 0x3D ? 1 : 2;
            break;
          }
        }
      }
    }

    // quirk for blockquotes, this line should already be checked by that rule
    if (state.sCount[nextLine] < 0) continue;

    // some tags can terminate paragraph without empty line
    let terminate = false;
    for (const rule of terminatorRules) {
      if (rule(state, nextLine, endLine, true)) {
        terminate = true;
        break;
      }
    }
    if (terminate) break;
  }

  if (!level) {
    // didn't find valid underline
    return false;
  }

  state.line = nextLine + 1;
  state.parentType = oldParentType;
  return true;
}

function ruleParagraph(state, startLine, endLine) {
  const terminatorRules = PARAGRAPH_TERMINATORS;
  const oldParentType = state.parentType;
  let nextLine = startLine + 1;
  state.parentType = 'paragraph';
  for (; nextLine < endLine && !stateIsEmpty(state, nextLine); nextLine++) {
    // After a paragraph start, indented lines are lazy continuations.
    if (state.sCount[nextLine] - state.blkIndent > 3) continue;
    // Blockquote lazy continuation lines are already handled by that rule.
    if (state.sCount[nextLine] < 0) continue;
    let terminate = false;
    for (const rule of terminatorRules) {
      if (rule(state, nextLine, endLine, true)) { terminate = true; break; }
    }
    if (terminate) break;
  }
  state.line = nextLine;
  state.parentType = oldParentType;
  return true;
}

// Terminator sets mirror markdown-it's default preset alt lists (html_block is
// disabled because the plugin parses with html:false). markdown-it's
// 'reference' chain (used by the reference rule to detect block terminators)
// has the same members as the 'paragraph' chain, so PARAGRAPH_TERMINATORS
// serves both. reference itself is in no terminator chain: it can never
// terminate a paragraph, blockquote or list.
const PARAGRAPH_TERMINATORS = [ruleTable, ruleFence, ruleBlockquote, ruleHr, ruleList, ruleHeading];
const BLOCKQUOTE_TERMINATORS = [ruleFence, ruleBlockquote, ruleHr, ruleList, ruleHeading];
const LIST_TERMINATORS = [ruleFence, ruleBlockquote, ruleHr];

function tokenize(state, startLine, endLine) {
  // markdown-it rule order with html_block omitted (parsed with html:false).
  const rules = [ruleTable, ruleCode, ruleFence, ruleBlockquote, ruleHr, ruleList, ruleReference, ruleHeading, ruleLheading, ruleParagraph];
  let line = startLine;
  let hasEmptyLines = false;
  while (line < endLine) {
    // markdown-it writes the skipped-to line back into state.line before the
    // range check, so a container rule that tokenizes an empty range still
    // leaves state.line advanced past its content.
    state.line = line = stateSkipEmptyLines(state, line);
    if (line >= endLine) break;
    if (state.sCount[line] < state.blkIndent) break;
    if (state.level >= MAX_NESTING) {
      state.line = endLine;
      break;
    }
    const prevLine = state.line;
    let ok = false;
    for (const rule of rules) {
      ok = rule(state, line, endLine, false);
      if (ok) {
        if (prevLine >= state.line) throw new Error('block rule did not increment state.line');
        break;
      }
    }
    if (!ok) throw new Error('none of the block rules matched');
    if (stateIsEmpty(state, state.line - 1)) hasEmptyLines = true;
    line = state.line;
    if (line < endLine && stateIsEmpty(state, line)) {
      hasEmptyLines = true;
      line++;
      state.line = line;
    }
  }
}

function scanBlocks(text) {
  const state = createState(text);
  tokenize(state, 0, state.lineMax);
  return state.tokens;
}

function sourceLines(text) {
  const lines=text.split('\n').map(line=>line.replace(/\r$/,'')), parsedLines=[...lines];
  if (/^\uFEFF?---\s*$/.test(lines[0] || '')) {
    const end=lines.findIndex((line,i)=>i>0 && /^(---|\.\.\.)\s*$/.test(line));
    if(end>=0) for(let i=0;i<=end;i++) parsedLines[i]='';
  }
  return {lines, parsedLines};
}

// Keep only fence tokens that start outside Obsidian %% ... %% comments.
// Shared with the differential tools so the markdown-it reference side applies
// exactly the same comment filter to its own tokens.
function filterCommentedFences(fenceTokens, parsedLines) {
  const starts=new Map(fenceTokens.map(t=>[t.map[0],t])),allowed=new Set();
  let commented=false,protectedEnd=0;
  for(let i=0;i<parsedLines.length;i++) {
    if(i<protectedEnd) continue;
    const fence=starts.get(i);
    if(fence && !commented) {allowed.add(i);protectedEnd=fence.map[1];continue;}
    const line=parsedLines[i].replace(/(`+).*?\1/g,'');
    for(let at=0;(at=line.indexOf('%%',at))>=0;at+=2) {
      let slash=at-1;while(slash>=0 && line[slash]==='\\') slash--;
      if((at-1-slash)%2===0) commented=!commented;
    }
  }
  return fenceTokens.filter(t=>allowed.has(t.map[0]));
}

// Parse fences while excluding Obsidian %% ... %% comments. The same allowed
// set is used for syntax highlighting and for deciding which native elements
// are fenced code blocks for the optional background.
function fencedTokens(parsedLines) {
  return filterCommentedFences(scanBlocks(parsedLines.join('\n')).filter(t=>t.type==='fence'), parsedLines);
}

// All real fenced blocks, including unlabeled and unsupported languages. This
// is intentionally broader than fencedBlocks(), which only returns blocks the
// syntax engine knows how to highlight.
function allFencedBlocks(text) {
  const {lines, parsedLines}=sourceLines(text);
  return fencedTokens(parsedLines).map(token=>{
    const content=token.content.endsWith('\n') ? token.content.slice(0,-1) : token.content;
    const codeLines=content.split('\n'), positions=[];
    for(let i=0;i<codeLines.length;i++) {
      const index=token.map[0]+1+i, raw=lines[index];
      if(raw===undefined || !raw.endsWith(codeLines[i])) return null;
      positions.push({line:index,column:raw.length-codeLines[i].length});
    }
    return {language:canonical(token.info.trim().split(/\s+/)[0]),text:content,
      start:token.map[0],end:token.map[1],positions};
  }).filter(Boolean);
}

// Fenced blocks supported by the TextMate engine; preserves the 0.1.x/0.2.x
// public behavior of fencedBlocks().
function fencedBlocks(text) {
  return allFencedBlocks(text).filter(block=>block.language);
}

// Ordered code blocks in a Markdown section, for mapping native reading-mode
// <pre> elements back to their source. Includes indented code_block tokens so
// the background is applied only to fences, never to indented code.
function codeBlockTokens(text) {
  const {parsedLines}=sourceLines(text);
  const allowedFences=new Set(fencedTokens(parsedLines).map(token=>token.map[0]));
  return scanBlocks(parsedLines.join('\n')).filter(token=>{
    if(token.type==='fence') return allowedFences.has(token.map[0]);
    return token.type==='code_block';
  }).map(token=>({
    type:token.type,
    fenced:token.type==='fence',
    language:token.type==='fence' ? canonical(token.info.trim().split(/\s+/)[0]) : null,
    text:token.content.endsWith('\n') ? token.content.slice(0,-1) : token.content,
    start:token.map[0],
    end:token.map[1],
  }));
}

// The three public entry points above are the plugin API. sourceLines,
// scanBlocks and filterCommentedFences are exported so the differential tools
// (tools/fence-diff-test.cjs, tools/fence-fuzz-test.cjs) can feed the same
// front-matter / %% pipeline to the markdown-it reference implementation.
module.exports = {fencedBlocks, allFencedBlocks, codeBlockTokens, sourceLines, scanBlocks, filterCommentedFences};
