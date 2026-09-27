export class StagedMutationController {
  constructor({ delayMs = 5000, timers = globalThis } = {}) {
    this.delayMs = delayMs;
    this.timers = timers;
    this.pending = null;
  }

  stage({ restore, commit, onCommit, onUndo, onFailure }) {
    this.cancel();
    const timer = this.timers.setTimeout(async () => {
      const current = this.pending;
      this.pending = null;
      try {
        await commit();
        onCommit?.();
      } catch (error) {
        onFailure?.(current.restore, error);
      }
    }, this.delayMs);
    this.pending = { restore, timer, onUndo };
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
