import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { DequeuedMessage } from "@trigger.dev/core/v3/schemas";
import { describe, it, expect, beforeEach } from "vitest";
import { ContainerPool } from "./pool.js";

function mockReq(destroyed = false): IncomingMessage {
  const emitter = new EventEmitter() as any;
  const socketEmitter = new EventEmitter() as any;
  socketEmitter.destroyed = destroyed;
  emitter.socket = socketEmitter;
  return emitter as IncomingMessage;
}

function makeDequeuedMessage(overrides?: {
  deploymentId?: string;
  version?: string;
  cpu?: number;
  memory?: number;
}): DequeuedMessage {
  return {
    version: "1" as const,
    snapshot: {
      id: "snap_1",
      friendlyId: "snap_1",
      executionStatus: "EXECUTING",
      description: "test",
      createdAt: new Date(),
    },
    dequeuedAt: new Date(),
    completedWaitpoints: [],
    backgroundWorker: {
      id: "worker_1",
      friendlyId: "worker_1",
      version: overrides?.version ?? "20240101.1",
    },
    deployment: {
      friendlyId: overrides?.deploymentId ?? "deploy_1",
    },
    run: {
      id: "run_1",
      friendlyId: "run_1",
      isTest: false,
      machine: {
        name: "small-1x",
        cpu: overrides?.cpu ?? 0.5,
        memory: overrides?.memory ?? 0.5,
        centsPerMs: 0,
      },
      attemptNumber: 1,
      masterQueue: "queue_1",
      traceContext: {},
    },
    environment: {
      id: "env_1",
      type: "PRODUCTION",
    },
    organization: {
      id: "org_1",
    },
    project: {
      id: "proj_1",
    },
  } as DequeuedMessage;
}

function enqueueContainer(
  pool: ContainerPool,
  overrides?: {
    deploymentId?: string;
    deploymentVersion?: string;
    machineCpu?: string;
    machineMemory?: string;
    req?: IncomingMessage;
  }
) {
  const req = overrides?.req ?? mockReq();
  const promise = pool.enqueue({
    deploymentId: overrides?.deploymentId ?? "deploy_1",
    deploymentVersion: overrides?.deploymentVersion ?? "20240101.1",
    machineCpu: overrides?.machineCpu ?? "0.5",
    machineMemory: overrides?.machineMemory ?? "0.5",
    controllerId: "ctrl_1",
    workerInstanceName: "instance_1",
    req,
  });
  return { promise, req };
}

describe("ContainerPool", () => {
  let pool: ContainerPool;

  beforeEach(() => {
    pool = new ContainerPool({ maxPoolSize: 1000 });
  });

  describe("Core matching", () => {
    it("returns false when pool is empty", () => {
      const msg = makeDequeuedMessage();
      expect(pool.match(msg)).toBe(false);
    });

    it("returns true and resolves enqueued promise with DequeuedMessage", async () => {
      const { promise } = enqueueContainer(pool);
      const msg = makeDequeuedMessage();

      const matched = pool.match(msg);
      expect(matched).toBe(true);

      const result = await promise;
      expect(result).toBe(msg);
    });

    it("does not match when deploymentId differs", () => {
      enqueueContainer(pool, { deploymentId: "deploy_A" });
      const msg = makeDequeuedMessage({ deploymentId: "deploy_B" });

      expect(pool.match(msg)).toBe(false);
    });

    it("does not match when deploymentVersion differs", () => {
      enqueueContainer(pool, { deploymentVersion: "v1" });
      const msg = makeDequeuedMessage({ version: "v2" });

      expect(pool.match(msg)).toBe(false);
    });

    it("does not match when machine cpu or memory differs", () => {
      enqueueContainer(pool, { machineCpu: "1", machineMemory: "2" });
      const msg = makeDequeuedMessage({ cpu: 0.5, memory: 0.5 });

      expect(pool.match(msg)).toBe(false);
    });
  });

  describe("FIFO and multi-key", () => {
    it("matches longest-waiting container first (FIFO)", async () => {
      const first = enqueueContainer(pool);
      const second = enqueueContainer(pool);
      const msg = makeDequeuedMessage();

      pool.match(msg);

      const result = await first.promise;
      expect(result).toBe(msg);
      // second should still be pending (not resolved)
      expect(pool.totalWaiting).toBe(1);
    });

    it("maintains separate queues per key", () => {
      enqueueContainer(pool, { deploymentId: "A", deploymentVersion: "v1", machineCpu: "0.5", machineMemory: "0.5" });
      enqueueContainer(pool, { deploymentId: "B", deploymentVersion: "v1", machineCpu: "0.5", machineMemory: "0.5" });

      const stats = pool.stats();
      expect(Object.keys(stats.byKey)).toHaveLength(2);
      expect(stats.totalWaiting).toBe(2);
    });

    it("one match resolves only the first of multiple on same key", async () => {
      const first = enqueueContainer(pool);
      const second = enqueueContainer(pool);
      const msg = makeDequeuedMessage();

      pool.match(msg);

      const result = await first.promise;
      expect(result).toBe(msg);
      expect(pool.totalWaiting).toBe(1);

      // Second is still waiting
      const stats = pool.stats();
      expect(stats.matchCount).toBe(1);
    });
  });

  describe("Disconnect and safety", () => {
    it("removes container from pool when socket emits close event", async () => {
      const { promise, req } = enqueueContainer(pool);
      // Catch the rejection so it doesn't become unhandled
      promise.catch(() => {});
      expect(pool.totalWaiting).toBe(1);

      (req.socket as any).emit("close");

      // Give microtask time to process
      await new Promise((r) => setTimeout(r, 0));
      expect(pool.totalWaiting).toBe(0);
    });

    it("skips containers with destroyed sockets, continues to next live one", async () => {
      const deadReq = mockReq(false);
      const first = enqueueContainer(pool, { req: deadReq });
      const second = enqueueContainer(pool);

      // Simulate socket destruction after enqueue
      (deadReq.socket as any).destroyed = true;

      const msg = makeDequeuedMessage();
      const matched = pool.match(msg);

      expect(matched).toBe(true);
      const result = await second.promise;
      expect(result).toBe(msg);
    });

    it("detaches socket close listener after successful match", async () => {
      const { promise, req } = enqueueContainer(pool);
      const msg = makeDequeuedMessage();

      pool.match(msg);
      await promise;

      // Socket close after match should NOT inflate totalDisconnected
      const statsBefore = pool.stats();
      (req.socket as any).emit("close");
      await new Promise((r) => setTimeout(r, 0));
      const statsAfter = pool.stats();

      expect(statsAfter.totalDisconnected).toBe(statsBefore.totalDisconnected);
    });

    it("enqueue-then-immediate-disconnect: promise rejects, pool count returns to zero", async () => {
      const { promise, req } = enqueueContainer(pool);

      // Immediately disconnect
      (req.socket as any).emit("close");

      await expect(promise).rejects.toThrow("Client disconnected");
      expect(pool.totalWaiting).toBe(0);
    });
  });

  describe("Backpressure", () => {
    it("rejects enqueue when pool is at max capacity", async () => {
      const smallPool = new ContainerPool({ maxPoolSize: 2 });

      enqueueContainer(smallPool);
      enqueueContainer(smallPool);

      await expect(
        smallPool.enqueue({
          deploymentId: "deploy_1",
          deploymentVersion: "20240101.1",
          machineCpu: "0.5",
          machineMemory: "0.5",
          controllerId: "ctrl_1",
          workerInstanceName: "instance_1",
          req: mockReq(),
        })
      ).rejects.toThrow("Pool is at max capacity");
    });

    it("allows enqueue after disconnect frees a slot", async () => {
      const smallPool = new ContainerPool({ maxPoolSize: 1 });

      const { promise, req } = enqueueContainer(smallPool);
      // Catch the rejection so it doesn't become unhandled
      promise.catch(() => {});
      expect(smallPool.totalWaiting).toBe(1);

      // Disconnect to free the slot
      (req.socket as any).emit("close");
      await new Promise((r) => setTimeout(r, 0));
      expect(smallPool.totalWaiting).toBe(0);

      // Should now allow a new enqueue
      enqueueContainer(smallPool);
      expect(smallPool.totalWaiting).toBe(1);
    });
  });

  describe("Stats", () => {
    it("reports correct totalWaiting, matchCount, missCount after operations", () => {
      const msg = makeDequeuedMessage();

      // Miss on empty pool
      pool.match(msg);
      expect(pool.stats().missCount).toBe(1);

      // Enqueue and match
      enqueueContainer(pool);
      pool.match(msg);

      const stats = pool.stats();
      expect(stats.matchCount).toBe(1);
      expect(stats.missCount).toBe(1);
      expect(stats.totalWaiting).toBe(0);
      expect(stats.totalEnqueued).toBe(1);
    });

    it("byKey breakdown reflects current pool state", () => {
      enqueueContainer(pool, { deploymentId: "A", deploymentVersion: "v1", machineCpu: "1", machineMemory: "2" });
      enqueueContainer(pool, { deploymentId: "A", deploymentVersion: "v1", machineCpu: "1", machineMemory: "2" });
      enqueueContainer(pool, { deploymentId: "B", deploymentVersion: "v2", machineCpu: "0.5", machineMemory: "0.5" });

      const stats = pool.stats();
      expect(stats.byKey["A:v1:1:2"]).toBe(2);
      expect(stats.byKey["B:v2:0.5:0.5"]).toBe(1);
      expect(stats.totalWaiting).toBe(3);
    });
  });
});
