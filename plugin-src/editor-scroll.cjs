/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

// CM owns the editable DOM. Touch prefers one CM BlockWrapper scrollport per
// fence, so the browser owns panning and momentum. Older CM engines retain the
// shared-offset mark fallback; desktop keeps synchronized native row ports.
function usesSharedTouchScroll(view) {
  const win = view.contentDOM.ownerDocument?.defaultView;
  return Boolean(win?.matchMedia?.('(pointer: coarse)').matches &&
    win.CSS?.supports?.('overflow', 'clip') &&
    win.CSS.supports('touch-action', 'pan-y pinch-zoom'));
}
class EditorFenceScroll {
  constructor(view, enabled, touchMode = usesSharedTouchScroll(view), nativeBlocks = false) {
    this.view = view;
    this.enabled = enabled;
    this.groups = new Map();
    this.rows = new Map();
    this.extents = new Map();
    this.offsets = new Map();
    this.touchMode = touchMode;
    this.nativeBlocks = nativeBlocks;
    this.scrollports = new Map();
    this.rowOffsets = new WeakMap();
    this.overscrollingRows = new WeakSet();
    this.destroyed = false;
    this.ensureCaret = false;
    this.touch = null;
    this.measureFrame = null;
    this.touchFrame = null;
    this.pendingTouchMove = null;
    this.momentumFrame = null;
    this.onScroll = (event) => {
      if (!this.enabled()) return;
      const row = event.target;
      const group = this.rows.get(row) || this.scrollports.get(row);
      if (!group) return;
      if (this.nativeBlocks) {
        if (row === group.scrollport) {
          group.offset = Math.max(0, Math.min(row.scrollLeft, Math.max(0, group.width - group.viewportWidth)));
          this.rowOffsets.set(row, row.scrollLeft);
          this.view.requestMeasure();
        }
        return;
      }
      // Clipped fallback rows cannot acquire ownership of the shared offset.
      if (this.touchMode) return;
      const offset = row.scrollLeft;
      this.rowOffsets.set(row, offset);
      const maximum = Math.max(0, group.width - (group.viewportWidth || 0));
      if (offset < -0.5 || offset > maximum + 0.5) this.overscrollingRows.add(row);
      else this.overscrollingRows.delete(row);
      if (Math.abs(offset - group.offset) < 0.5) return;
      this.move(group, offset, row);
    };
    this.onWheel = (event) => {
      if (event.ctrlKey || !this.enabled()) return;
      const row = event.target.closest?.('.cm-line[data-aof-scroll]');
      const group = this.rows.get(row);
      const delta = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
      if (!group || !delta || (!event.shiftKey && Math.abs(event.deltaY) > Math.abs(delta))) return;
      this.stopMomentum();
      // Horizontal intent belongs to this fence, including at either end.
      // Ordinary vertical gestures retain the browser's native scroll chain.
      event.preventDefault();
      this.move(group, group.offset + delta * (event.deltaMode === 1 ? this.view.defaultCharacterWidth : event.deltaMode === 2 ? group.viewportWidth : 1));
    };
    view.contentDOM.addEventListener('scroll', this.onScroll, true);
    view.contentDOM.addEventListener('wheel', this.onWheel, { passive: false });
    this.onTouchStart = (event) => this.startTouch(event);
    this.onTouchMove = (event) => this.moveTouch(event);
    this.onTouchEnd = (event) => this.endTouch(event);
    this.onTouchCancel = () => { this.touch = null; this.cancelTouchMove(); this.stopMomentum(); };
    // A non-passive touchmove listener makes the browser wait for the main
    // thread even when its callback immediately returns. Native block ports
    // need no JS gesture driver, so do not register one on their ancestor.
    if (!this.nativeBlocks) {
      view.contentDOM.addEventListener('touchstart', this.onTouchStart, { passive: true });
      view.contentDOM.addEventListener('touchmove', this.onTouchMove, { passive: false });
      view.contentDOM.addEventListener('touchend', this.onTouchEnd, { passive: true });
      view.contentDOM.addEventListener('touchcancel', this.onTouchCancel, { passive: true });
    }
    if (this.touchMode && this.enabled()) view.contentDOM.classList.add(this.nativeBlocks ? 'aof-native-blocks' : 'aof-touch-scroll');
    this.schedule();
  }

  update(update, blocks) {
    if (!this.enabled() || update.docChanged) {
      this.touch = null;
      this.cancelTouchMove();
      this.stopMomentum();
    } else if (update.selectionSet) {
      this.stopMomentum();
    }
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

  startTouch(event) {
    this.cancelTouchMove();
    this.stopMomentum();
    this.touch = null;
    const doc = this.view.contentDOM.ownerDocument;
    const win = doc?.defaultView;
    // Match the CSS policy: other pointer configurations keep native scrolling.
    if (!this.enabled() || !this.touchMode || this.nativeBlocks || this.view.composing || event.touches.length !== 1) return;
    if (win.CSS?.supports && !win.CSS.supports('touch-action', 'pan-y pinch-zoom')) return;
    const selection = doc.getSelection?.();
    if (selection && !selection.isCollapsed) return;
    const element = event.target.nodeType === 1 ? event.target : event.target.parentElement;
    const row = element?.closest?.('.cm-line[data-aof-scroll]');
    const group = this.rows.get(row);
    if (!group || group.width <= group.viewportWidth) return;
    const point = event.touches[0];
    this.touch = {
      id: point.identifier, key: row.getAttribute('data-aof-scroll'),
      x: point.clientX, y: point.clientY, offset: group.offset,
      lastX: point.clientX, lastTime: event.timeStamp, started: event.timeStamp,
      velocity: 0, horizontal: false,
    };
  }

  moveTouch(event) {
    const touch = this.touch;
    if (!touch || !this.enabled() || this.view.composing || event.touches.length !== 1) {
      this.touch = null;
      this.cancelTouchMove();
      return;
    }
    const point = event.touches[0];
    if (point.identifier !== touch.id) { this.touch = null; this.cancelTouchMove(); return; }
    const dx = point.clientX - touch.x;
    const dy = point.clientY - touch.y;
    if (!touch.horizontal) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
      // Leave vertical gestures, long-press selection and non-cancellable
      // gestures to the host. Never start controlling a gesture mid-scroll.
      if (Math.abs(dy) >= Math.abs(dx) || event.timeStamp - touch.started > 350 || !event.cancelable) {
        this.touch = null;
        return;
      }
      touch.horizontal = true;
      const group = this.groups.get(touch.key);
      if (!group) { this.touch = null; return; }
      for (const row of group.rows) this.overscrollingRows.delete(row);
    }
    if (!event.cancelable) { this.touch = null; this.cancelTouchMove(); return; }
    const group = this.groups.get(touch.key);
    if (!group) { this.touch = null; this.cancelTouchMove(); return; }
    event.preventDefault();
    const dt = event.timeStamp - touch.lastTime;
    if (dt > 0) touch.velocity = dt > 100 ? 0 : Math.max(-2.5, Math.min(2.5, (touch.lastX - point.clientX) / dt));
    touch.lastX = point.clientX;
    touch.lastTime = event.timeStamp;
    this.queueTouchMove(touch.key, touch.offset - dx);
  }

  // A device may deliver several touchmove events per display frame. Updating
  // each event forces redundant style and CodeMirror work. Keep the latest
  // position and move the fence once before the next paint.
  queueTouchMove(key, offset) {
    this.pendingTouchMove = { key, offset };
    if (this.touchFrame !== null) return;
    const win = this.view.contentDOM.ownerDocument?.defaultView;
    if (!win?.requestAnimationFrame) { this.flushTouchMove(); return; }
    this.touchFrame = win.requestAnimationFrame(() => {
      this.touchFrame = null;
      this.flushTouchMove();
    });
  }

  flushTouchMove() {
    if (this.touchFrame !== null) {
      this.view.contentDOM.ownerDocument?.defaultView?.cancelAnimationFrame?.(this.touchFrame);
      this.touchFrame = null;
    }
    const pending = this.pendingTouchMove;
    this.pendingTouchMove = null;
    const group = pending && this.groups.get(pending.key);
    if (group && this.enabled() && !this.destroyed) this.move(group, pending.offset);
  }

  cancelTouchMove() {
    if (this.touchFrame !== null) this.view.contentDOM.ownerDocument?.defaultView?.cancelAnimationFrame?.(this.touchFrame);
    this.touchFrame = null;
    this.pendingTouchMove = null;
  }

  endTouch(event) {
    const touch = this.touch;
    this.touch = null;
    if (touch?.horizontal && !event.touches.length) this.flushTouchMove();
    else this.cancelTouchMove();
    if (!touch?.horizontal || event.touches.length || event.timeStamp - touch.lastTime > 80 || Math.abs(touch.velocity) < 0.08) return;
    const win = this.view.contentDOM.ownerDocument?.defaultView;
    if (!win?.requestAnimationFrame) return;
    let velocity = touch.velocity;
    let last = null;
    const tick = (time) => {
      this.momentumFrame = null;
      const group = this.groups.get(touch.key);
      if (this.destroyed || !this.enabled() || !group) return;
      if (last !== null) {
        const dt = Math.min(32, Math.max(0, time - last));
        const previous = group.offset;
        this.move(group, previous + velocity * dt);
        velocity *= Math.exp(-dt / 240);
        if (Math.abs(velocity) < 0.03 || Math.abs(group.offset - previous) < 0.01) return;
      }
      last = time;
      this.momentumFrame = win.requestAnimationFrame(tick);
    };
    this.momentumFrame = win.requestAnimationFrame(tick);
  }

  stopMomentum() {
    if (this.momentumFrame === null) return;
    this.view.contentDOM.ownerDocument?.defaultView?.cancelAnimationFrame?.(this.momentumFrame);
    this.momentumFrame = null;
  }

  schedule() {
    // When wrapping is enabled there are no local scrollports to measure.
    // Still run one cleanup pass after switching modes if any state remains.
    if (!this.enabled() && !this.rows.size && !this.groups.size && !this.extents.size && !this.offsets.size) {
      this.ensureCaret = false;
      return;
    }
    // Geometry updates can arrive inside CM's own measure loop. Queue our
    // request outside that loop so a viewport stabilization restart cannot
    // strand it until an unrelated native scroll wakes the editor again.
    if (this.measureFrame !== null) return;
    const win = this.view.contentDOM.ownerDocument?.defaultView;
    const request = () => {
      this.measureFrame = null;
      if (this.destroyed) return;
      this.view.requestMeasure({ key: this, read: () => this.measure(), write: plan => this.apply(plan) });
    };
    if (win?.requestAnimationFrame) this.measureFrame = win.requestAnimationFrame(request);
    else request();
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
      const scrollport = this.nativeBlocks ? row.closest('.aof-native-scroll') : null;
      if (this.nativeBlocks && !scrollport) continue;
      let group = groups.get(key);
      if (!group) {
        const previous = this.groups.get(key);
        group = { key, offset: previous?.offset || 0, width: previous?.width || 0, viewportWidth: (scrollport || row).clientWidth, scrollport, rows: [] };
        groups.set(key, group);
      }
      const box = row.getBoundingClientRect();
      const style = row.ownerDocument.defaultView.getComputedStyle(row);
      const padding = parseFloat(style.paddingRight) || 0;
      let right = box.left;
      let offset = this.nativeBlocks ? 0 : row.scrollLeft;
      if (this.touchMode && !this.nativeBlocks) {
        // CM may split our mark inside syntax spans. A range of the entire row
        // includes those unshifted outer boxes and would inflate the width on
        // every measure. Measure only the positioned fragments, using their
        // current CSS offset (new document keys may not have an offset yet).
        offset = -(parseFloat(style.getPropertyValue('--aof-scroll-offset')) || 0);
        for (const fragment of row.querySelectorAll('.aof-scroll-content')) {
          right = Math.max(right, fragment.getBoundingClientRect().right);
        }
      } else {
        const range = row.ownerDocument.createRange();
        range.selectNodeContents(row);
        right = range.getBoundingClientRect().right;
      }
      group.width = Math.max(group.width, row.clientWidth, Math.ceil(right - box.left + offset + padding));
      this.rowOffsets.set(row, row.scrollLeft);
      if (group.scrollport) this.rowOffsets.set(group.scrollport, group.scrollport.scrollLeft);
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
      const viewport = this.nativeBlocks ? row?.closest('.aof-native-scroll') : row;
      const coords = viewport && this.view.coordsAtPos(pos);
      if (coords) caret = {
        key: row.getAttribute('data-aof-scroll'),
        offset: this.nativeBlocks ? viewport.scrollLeft : this.touchMode
          ? -(parseFloat(row.ownerDocument.defaultView.getComputedStyle(row).getPropertyValue('--aof-scroll-offset')) || 0)
          : row.scrollLeft,
        left: coords.left, right: coords.right, box: viewport.getBoundingClientRect(),
      };
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
    this.view.contentDOM.classList?.toggle('aof-touch-scroll', this.touchMode && !this.nativeBlocks && this.enabled());
    this.view.contentDOM.classList?.toggle('aof-native-blocks', this.nativeBlocks && this.enabled());
    this.scrollports.clear();
    this.rows.clear();
    // Keep offsets of offscreen fences, but release detached DOM references.
    for (const group of this.groups.values()) { group.rows = []; group.scrollport = null; }
    if (!this.enabled()) {
      this.groups.clear();
      this.overscrollingRows = new WeakSet();
    }
    for (const key of this.extents.keys()) {
      if (!this.groups.has(key) && !plan.groups.has(key)) {
        this.view.contentDOM.style.removeProperty(`--aof-block-width-${key}`);
        this.extents.delete(key);
        this.view.contentDOM.style.removeProperty(`--aof-block-offset-${key}`);
        this.offsets.delete(key);
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
      if (group.scrollport) this.scrollports.set(group.scrollport, group);
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

  move(group, offset, sourceRow = null) {
    const width = group.viewportWidth || 0;
    const previous = group.offset;
    group.offset = Math.max(0, Math.min(offset, Math.max(0, group.width - width)));
    if (this.nativeBlocks) {
      if (group.scrollport && this.rowOffsets.get(group.scrollport) !== group.offset) {
        group.scrollport.scrollLeft = group.offset;
        this.rowOffsets.set(group.scrollport, group.offset);
      }
      return;
    }
    if (this.touchMode) {
      // One DOM style write for any number of mounted rows. CM owns the spans;
      // CSS clips the line and shifts all fragments by this same value.
      const value = `${-group.offset}px`;
      if (this.offsets.get(group.key) !== value) {
        this.view.contentDOM.style.setProperty(`--aof-block-offset-${group.key}`, value);
        this.offsets.set(group.key, value);
      }
      if (Math.abs(previous - group.offset) > 0.5) this.view.requestMeasure();
      return;
    }
    // Write-only loop: reading scrollLeft/clientWidth after each preceding
    // write forces repeated layout in a tall fence. Width was read in measure.
    for (const row of group.rows) {
      // A native touch scroll can temporarily overshoot at an edge (notably
      // WebKit rubber-banding). Leave the active scrollport under the browser's
      // control instead of writing the clamped peer offset back into it.
      if (row === sourceRow || this.overscrollingRows.has(row)) continue;
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
    if (this.measureFrame !== null) this.view.contentDOM.ownerDocument?.defaultView?.cancelAnimationFrame?.(this.measureFrame);
    this.measureFrame = null;
    this.touch = null;
    this.cancelTouchMove();
    this.stopMomentum();
    this.view.contentDOM.removeEventListener('scroll', this.onScroll, true);
    this.view.contentDOM.removeEventListener('wheel', this.onWheel);
    this.view.contentDOM.removeEventListener('touchstart', this.onTouchStart);
    this.view.contentDOM.removeEventListener('touchmove', this.onTouchMove);
    this.view.contentDOM.removeEventListener('touchend', this.onTouchEnd);
    this.view.contentDOM.removeEventListener('touchcancel', this.onTouchCancel);
    for (const row of this.rows.keys()) {
      row.scrollLeft = 0;
      this.rowOffsets.set(row, 0);
    }
    for (const key of this.extents.keys()) this.view.contentDOM.style.removeProperty(`--aof-block-width-${key}`);
    for (const key of this.offsets.keys()) this.view.contentDOM.style.removeProperty(`--aof-block-offset-${key}`);
    this.offsets.clear();
    this.view.contentDOM.classList?.remove('aof-touch-scroll', 'aof-native-blocks');
    this.scrollports.clear();
    this.extents.clear();
    this.rows.clear();
    this.groups.clear();
    this.overscrollingRows = new WeakSet();
  }
}

module.exports = { EditorFenceScroll, usesSharedTouchScroll };
