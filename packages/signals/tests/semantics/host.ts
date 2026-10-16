import { MessageChannel } from "node:worker_threads";

/** Each callback runs in its own host task, without replacing native jobs. */
export class HostTasks {
  private channel = new MessageChannel();
  private callbacks: Array<() => void> = [];
  constructor(private begin?: () => void) {
    this.channel.port1.on("message", () => this.callbacks.shift()!());
  }
  run<T>(fn: () => T): Promise<T> {
    return new Promise((resolve, reject) => {
      this.callbacks.push(() => {
        try {
          this.begin?.();
          resolve(fn());
        } catch (e) {
          reject(e);
        }
      });
      this.channel.port2.postMessage(0);
    });
  }
  async drain(): Promise<void> {
    // The continuation of run() alone is a microtask, not a drain barrier.
    await this.run(() => {});
  }
  close() {
    this.channel.port1.close();
    this.channel.port2.close();
  }
}
