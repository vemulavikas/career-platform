import { AppError } from './errors';

/**
 * Concurrency limiter with a bounded queue (backpressure for expensive AI work).
 * At most `max` jobs run at once; up to `maxQueue` more wait; anything beyond that is rejected
 * immediately with 503 instead of piling up unbounded work behind a slow LLM.
 * Per-process: with N replicas the effective limit is N x max.
 */
export class Gate {
  private active = 0;
  private waiters: Array<() => void> = [];

  constructor(private readonly max: number, private readonly maxQueue: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active < this.max) {
      this.active++;
    } else {
      if (this.waiters.length >= this.maxQueue) {
        throw new AppError(503, 'GENERATION_BUSY', 'Resume generation is busy. Please retry in a moment.');
      }
      await new Promise<void>((resolve) => this.waiters.push(resolve)); // release() hands us its slot
    }
    try {
      return await fn();
    } finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.active--;
    }
  }
}
