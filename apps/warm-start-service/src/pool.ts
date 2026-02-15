import type { IncomingMessage } from "node:http";
import type { DequeuedMessage } from "@trigger.dev/core/v3/schemas";

export type PoolKey = string;

export interface WaitingContainer {
  deploymentId: string;
  deploymentVersion: string;
  machineCpu: string;
  machineMemory: string;
  controllerId: string;
  workerInstanceName: string;
  resolve: (message: DequeuedMessage) => void;
  reject: (reason: Error) => void;
  enqueuedAt: number;
  req: IncomingMessage;
  /** Detach the socket close listener (set after enqueue) */
  detachCloseListener?: () => void;
}

export interface PoolStats {
  totalWaiting: number;
  byKey: Record<string, number>;
  matchCount: number;
  missCount: number;
  totalEnqueued: number;
  totalDisconnected: number;
}

export interface ContainerPoolOptions {
  maxPoolSize: number;
}

function makeKey(
  deploymentId: string,
  deploymentVersion: string,
  cpu: string,
  memory: string
): PoolKey {
  return `${deploymentId}:${deploymentVersion}:${cpu}:${memory}`;
}

export class ContainerPool {
  private pool = new Map<PoolKey, WaitingContainer[]>();
  private maxPoolSize: number;
  private matchCount = 0;
  private missCount = 0;
  private totalEnqueued = 0;
  private totalDisconnected = 0;

  constructor(options: ContainerPoolOptions) {
    this.maxPoolSize = options.maxPoolSize;
  }

  get totalWaiting(): number {
    let count = 0;
    for (const entries of this.pool.values()) {
      count += entries.length;
    }
    return count;
  }

  enqueue(container: {
    deploymentId: string;
    deploymentVersion: string;
    machineCpu: string;
    machineMemory: string;
    controllerId: string;
    workerInstanceName: string;
    req: IncomingMessage;
  }): Promise<DequeuedMessage> {
    if (this.totalWaiting >= this.maxPoolSize) {
      return Promise.reject(new Error("Pool is at max capacity"));
    }

    return new Promise<DequeuedMessage>((resolve, reject) => {
      const key = makeKey(
        container.deploymentId,
        container.deploymentVersion,
        container.machineCpu,
        container.machineMemory
      );

      const entry: WaitingContainer = {
        ...container,
        resolve,
        reject,
        enqueuedAt: Date.now(),
      };

      const queue = this.pool.get(key);
      if (queue) {
        queue.push(entry);
      } else {
        this.pool.set(key, [entry]);
      }

      this.totalEnqueued++;

      let settled = false;
      const onClose = () => {
        if (settled) return;
        settled = true;
        this.remove(key, entry);
        this.totalDisconnected++;
        reject(new Error("Client disconnected"));
      };

      // Listen on the underlying socket rather than the request stream.
      // HttpServer's getJsonBody() consumes the Readable, which causes
      // req's 'close' to fire immediately (stream ended), not when the
      // TCP connection actually drops. req.socket.on('close') fires
      // reliably when the client disconnects.
      const target = container.req.socket ?? container.req;
      target.on("close", onClose);

      entry.detachCloseListener = () => {
        settled = true;
        target.removeListener("close", onClose);
      };
    });
  }

  match(dequeuedMessage: DequeuedMessage): boolean {
    // Use friendlyId (not id) because the supervisor passes
    // deployment.friendlyId as TRIGGER_DEPLOYMENT_ID to runners.
    const deploymentId = dequeuedMessage.deployment.friendlyId ?? "unknown";
    const deploymentVersion = dequeuedMessage.backgroundWorker.version;
    const cpu = String(dequeuedMessage.run.machine.cpu);
    const memory = String(dequeuedMessage.run.machine.memory);
    const key = makeKey(deploymentId, deploymentVersion, cpu, memory);

    const queue = this.pool.get(key);
    if (!queue || queue.length === 0) {
      this.missCount++;
      return false;
    }

    // FIFO: iterate from front, skip destroyed sockets
    while (queue.length > 0) {
      const entry = queue.shift()!;

      if (entry.req.socket && (entry.req.socket as any).destroyed) {
        // Skip dead connections - already cleaned up or will be
        continue;
      }

      // Live connection found - detach close listener and resolve
      entry.detachCloseListener?.();
      entry.resolve(dequeuedMessage);
      this.matchCount++;

      // Clean up empty queue
      if (queue.length === 0) {
        this.pool.delete(key);
      }

      return true;
    }

    // All containers in queue had destroyed sockets
    this.pool.delete(key);
    this.missCount++;
    return false;
  }

  remove(key: PoolKey, entry: WaitingContainer): void {
    const queue = this.pool.get(key);
    if (!queue) return;

    const index = queue.indexOf(entry);
    if (index !== -1) {
      queue.splice(index, 1);
    }

    if (queue.length === 0) {
      this.pool.delete(key);
    }
  }

  stats(): PoolStats {
    const byKey: Record<string, number> = {};
    for (const [key, entries] of this.pool.entries()) {
      byKey[key] = entries.length;
    }

    return {
      totalWaiting: this.totalWaiting,
      byKey,
      matchCount: this.matchCount,
      missCount: this.missCount,
      totalEnqueued: this.totalEnqueued,
      totalDisconnected: this.totalDisconnected,
    };
  }
}
