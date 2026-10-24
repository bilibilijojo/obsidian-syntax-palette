/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

// CM owns the editable line nodes. Never wrap/reparent them. Each decorated
// line is a native scrollport; a non-text pseudo element gives short rows the
// same extent, and this controller synchronizes only rows of the same fence.
// No document changes, replacement widgets, transforms or cloned editable text.
class EditorFenceScroll {
  constructor(view, enabled) {
    this.view = view;
    this.enabled = enabled;
    this.groups = new Map();
    this.rows = new Map();
    this.extents = new Map();
    this.rowOffsets = new WeakMap();
    this.destroyed = false;
    this.ensureCaret = false;
    this.onScroll = (event) => {
      const row = event.target;
      const group = this.rows.get(row);
      if (!group) return;
      const offset = row.scrollLeft;
      this.rowOffsets.set(row, offset);
      if (Math.abs(offset - group.offset) < 0.5) return;
      this.move(group, offset);
    };
    this.onWheel = (event) => {
      if (event.ctrlKey || !this.enabled()) return;
      const row = event.target.closest?.('.cm-line[data-aof-scroll]');
      const group = this.rows.get(row);
      const delta = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
      if (!group || !delta || (!event.shiftKey && Math.abs(event.deltaY) > Math.abs(delta))) return;
      // Horizontal intent belongs to this fence, including at either end.
      // Ordinary vertical gestures retain the browser's native scroll chain.
      event.preventDefault();
      this.move(group, group.offset + delta * (event.deltaMode === 1 ? this.view.defaultCharacterWidth : event.deltaMode === 2 ? row.clientWidth : 1));
    };
    view.contentDOM.addEventListener('scroll', this.onScroll, true);
    view.contentDOM.addEventListener('wheel', this.onWheel, { passive: false });
    this.schedule();
  }

  update(update, blocks) {
    if (update.docChanged) {
      const mapped = new Map();
      for (const [key, group] of this.groups) {
        mapped.set(String(update.changes.mapPos(Number(key), -1)), { offset: group.offset, width: 0, rows: [] });
      }
      const valid = new Set(blocks.map(block => String(update.state.doc.line(block.start + 1).from)));
      this.groups = new Map([...mapped].filter(([key]) => valid.has(key)));
    }
    this.ensureCaret ||= update.selectionSet || update.docChanged;
    if (update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged || update.transactions.some(t => t.effects.length)) this.schedule();
  }

  schedule() {
    this.view.requestMeasure({
      key: this,
      read: () => this.measure(),
      write: (plan) => this.apply(plan),
    });
  }

  measure() {
    if (this.destroyed || !this.view.contentDOM.clientWidth) return null;
    const signature = `${this.view.contentDOM.clientWidth}|${this.view.defaultCharacterWidth}|${this.view.defaultLineHeight}`;
    if (signature !== this.signature) {
      for (const group of this.groups.values()) group.width = 0;
      this.signature = signature;
    }
    const lines = [...this.view.contentDOM.querySelectorAll('.cm-line[data-aof-scroll]')];
    if (!this.enabled()) return { lines, groups: new Map(), caret: null };
    const groups = new Map();
    for (const row of lines) {
      const key = row.getAttribute('data-aof-scroll');
      let group = groups.get(key);
      if (!group) {
        const previous = this.groups.get(key);
        group = { offset: previous?.offset || 0, width: previous?.width || 0, viewportWidth: row.clientWidth, rows: [] };
        groups.set(key, group);
      }
      const range = row.ownerDocument.createRange();
      range.selectNodeContents(row);
      const rect = range.getBoundingClientRect();
      const box = row.getBoundingClientRect();
      const padding = parseFloat(row.ownerDocument.defaultView.getComputedStyle(row).paddingRight) || 0;
      group.width = Math.max(group.width, row.clientWidth, Math.ceil(rect.right - box.left + row.scrollLeft + padding));
      this.rowOffsets.set(row, row.scrollLeft);
      group.rows.push(row);
    }
    // Modest rounding prevents viewport remounts with one extra digit from
    // repeatedly changing the shared extent. The code remains fully reachable.
    for (const group of groups.values()) {
      if (group.width > group.viewportWidth) group.width = Math.ceil(group.width / 64) * 64;
    }
    let caret = null;
    if (this.ensureCaret && !this.view.composing) {
      const pos = this.view.state.selection.main.head;
      const dom = this.view.domAtPos(pos);
      const row = (dom.node.nodeType === 1 ? dom.node : dom.node.parentElement)?.closest('.cm-line[data-aof-scroll]');
      const coords = row && this.view.coordsAtPos(pos);
      if (coords) caret = { key: row.getAttribute('data-aof-scroll'), offset: row.scrollLeft, left: coords.left, right: coords.right, box: row.getBoundingClientRect() };
    }
    return { lines, groups, caret };
  }

  apply(plan) {
    if (!plan || this.destroyed) return;
    for (const row of this.rows.keys()) {
      if (!this.enabled() || !row.matches('.aof-nowrap[data-aof-scroll]')) {
        row.scrollLeft = 0;
        this.rowOffsets.set(row, 0);
      }
    }
    this.rows.clear();
    // Keep offsets of offscreen fences, but release detached DOM references.
    for (const group of this.groups.values()) group.rows = [];
    if (!this.enabled()) this.groups.clear();
    for (const key of this.extents.keys()) {
      if (!this.groups.has(key) && !plan.groups.has(key)) {
        this.view.contentDOM.style.removeProperty(`--aof-block-width-${key}`);
        this.extents.delete(key);
      }
    }
    for (const [key, group] of plan.groups) {
      this.groups.set(key, group);
      // Every row's CM-owned decoration references this shared property.
      // Newly virtualized rows therefore receive the correct extent in their
      // initial layout, rather than being resized again during our write pass.
      const extent = `${group.width - 1}px`;
      if (this.extents.get(key) !== extent) {
        this.view.contentDOM.style.setProperty(`--aof-block-width-${key}`, extent);
        this.extents.set(key, extent);
      }
      for (const row of group.rows) this.rows.set(row, group);
      this.move(group, group.offset);
    }
    if (plan.caret) {
      const { key, offset, box } = plan.caret;
      const group = this.groups.get(key);
      if (group) {
        const left = plan.caret.left + offset - group.offset;
        const right = plan.caret.right + offset - group.offset;
        const correction = left < box.left + 4 ? left - box.left - 4 : right > box.right - 4 ? right - box.right + 4 : 0;
        if (correction) this.move(group, group.offset + correction);
      }
    }
    this.ensureCaret = false;
  }

  move(group, offset) {
    const width = group.viewportWidth || 0;
    const previous = group.offset;
    group.offset = Math.max(0, Math.min(offset, Math.max(0, group.width - width)));
    // Write-only loop: reading scrollLeft/clientWidth after each preceding
    // write forces repeated layout in a tall fence. Width was read in measure.
    for (const row of group.rows) {
      if (this.rowOffsets.get(row) === group.offset) continue;
      row.scrollLeft = group.offset;
      this.rowOffsets.set(row, group.offset);
    }
    // CM draws its own cursor/selection layers. Ask it to redraw using the
    // real, now-scrolled DOM rectangles (no transaction/history entry).
    if (Math.abs(previous - group.offset) > 0.5) this.view.requestMeasure();
  }

  destroy() {
    this.destroyed = true;
    this.view.contentDOM.removeEventListener('scroll', this.onScroll, true);
    this.view.contentDOM.removeEventListener('wheel', this.onWheel);
    for (const row of this.rows.keys()) {
      row.scrollLeft = 0;
      this.rowOffsets.set(row, 0);
    }
    for (const key of this.extents.keys()) this.view.contentDOM.style.removeProperty(`--aof-block-width-${key}`);
    this.extents.clear();
    this.rows.clear();
    this.groups.clear();
  }
}

module.exports = { EditorFenceScroll };
