import { abortReason } from "../media/process.js";

/** FIFO counting semaphore whose waiters leave the queue when their signal aborts. */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly capacity: number) {}

  async acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) throw abortReason(signal);
    if (this.active < this.capacity) {
      this.active += 1;
      return this.releaser();
    }

    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        const index = this.waiters.indexOf(grant);
        if (index !== -1) this.waiters.splice(index, 1);
        reject(abortReason(signal));
      };
      const grant = () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      };
      this.waiters.push(grant);
      signal.addEventListener("abort", onAbort, { once: true });
    });
    return this.releaser();
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) next();
      else this.active -= 1;
    };
  }
}
