export class StagedMutationController {
  constructor({ delayMs = 5000, timers = globalThis } = {}) {
    this.delayMs = delayMs;
    this.timers = timers;
    this.pending = null;
    this.commits = Promise.resolve();
  }

  enqueue(current) {
    this.commits = this.commits.then(() => current.commit())
      .then(() => current.onCommit?.(), error => current.onFailure?.(current.restore, error));
    return this.commits;
  }

  stage({ restore, commit, onCommit, onUndo, onFailure }) {
    // A second action commits the first; it must never silently discard it.
    this.flush();
    const timer = this.timers.setTimeout(() => {
      const current = this.pending;
      this.pending = null;
      return this.enqueue(current);
    }, this.delayMs);
    this.pending = { restore, timer, commit, onCommit, onUndo, onFailure };
  }

  flush() {
    if (!this.pending) return;
    const current = this.pending;
    this.pending = null;
    this.timers.clearTimeout(current.timer);
    this.enqueue(current);
  }

  undo() {
    if (!this.pending) return null;
    const current = this.pending;
    this.timers.clearTimeout(current.timer);
    this.pending = null;
    current.onUndo?.(current.restore);
    return current.restore;
  }

  cancel() {
    if (this.pending?.timer) this.timers.clearTimeout(this.pending.timer);
    this.pending = null;
  }
}
