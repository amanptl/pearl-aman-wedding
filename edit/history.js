// Undo/redo with coalescing. Entries store JSON snapshots of the whole draft (small: ~20KB).
export function createHistory(limit = 100, windowMs = 800) {
  let undoStack = [];
  let redoStack = [];
  return {
    /** Record a change. Same `key` within windowMs (or force) merges into the previous entry. */
    push(before, after, label, key = null, { force = false, now = Date.now() } = {}) {
      const top = undoStack[undoStack.length - 1];
      if (key && top && top.key === key && (force || now - top.t < windowMs) && !redoStack.length) {
        top.after = after;
        top.t = now;
        if (top.before === top.after) undoStack.pop();
      } else {
        undoStack.push({ before, after, label, key, t: now });
        if (undoStack.length > limit) undoStack.shift();
      }
      redoStack = [];
    },
    undo() { const e = undoStack.pop(); if (!e) return null; redoStack.push(e); return e; },
    redo() { const e = redoStack.pop(); if (!e) return null; undoStack.push(e); return e; },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    labels: () => ({ undo: undoStack.at(-1)?.label, redo: redoStack.at(-1)?.label }),
    clear() { undoStack = []; redoStack = []; },
  };
}
