import { EventEmitter } from "node:events";
import http from "node:http";
import net from "node:net";
import type { IncomingMessage } from "node:http";
import type { DequeuedMessage } from "@trigger.dev/core/v3/schemas";
import { HttpServer } from "@trigger.dev/core/v3/serverOnly";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ContainerPool } from "../pool.js";
import { createConnectRoute } from "./connect.js";
import { createWarmStartGetRoute, createWarmStartPostRoute } from "./warmStart.js";

function mockReq(
  headers: Record<string, string> = {},
  destroyed = false
): IncomingMessage {
  const emitter = new EventEmitter() as any;
  const socketEmitter = new EventEmitter() as any;
  socketEmitter.destroyed = destroyed;
  emitter.socket = socketEmitter;
  emitter.headers = headers;
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

const defaultHeaders = {
  "x-trigger-deployment-id": "deploy_1",
  "x-trigger-deployment-version": "20240101.1",
  "x-trigger-machine-cpu": "0.5",
  "x-trigger-machine-memory": "0.5",
  "x-trigger-workload-controller-id": "ctrl_1",
  "x-trigger-worker-instance-name": "instance_1",
};

function createMockReply() {
  const calls: { method: string; args: any[] }[] = [];
  return {
    calls,
    json(data: unknown, pretty?: boolean, status?: number) {
      calls.push({ method: "json", args: [data, pretty, status] });
    },
    empty(status: number) {
      calls.push({ method: "empty", args: [status] });
    },
  };
}

describe("GET /warm-start handler", () => {
  let pool: ContainerPool;

  beforeEach(() => {
    pool = new ContainerPool({ maxPoolSize: 1000 });
  });

  it("returns 400 when required headers are missing", async () => {
    const route = createWarmStartGetRoute(pool);
    const req = mockReq({});
    const reply = createMockReply();

    await route.handler({ req, res: {} as any, reply });

    expect(reply.calls).toHaveLength(1);
    expect(reply.calls[0]!.method).toBe("json");
    expect(reply.calls[0]!.args[2]).toBe(400);
    expect(reply.calls[0]!.args[0]).toEqual({
      ok: false,
      error: "Missing required headers",
    });
  });

  it("returns 503 when pool is at capacity", async () => {
    const smallPool = new ContainerPool({ maxPoolSize: 0 });
    const route = createWarmStartGetRoute(smallPool);
    const req = mockReq(defaultHeaders);
    const reply = createMockReply();

    await route.handler({ req, res: {} as any, reply });

    expect(reply.calls).toHaveLength(1);
    expect(reply.calls[0]!.method).toBe("json");
    expect(reply.calls[0]!.args[2]).toBe(503);
  });

  it("resolves with DequeuedMessage when POST dispatches a matching run", async () => {
    const route = createWarmStartGetRoute(pool);
    const req = mockReq(defaultHeaders);
    const reply = createMockReply();

    // Start the handler (will block on pool.enqueue)
    const handlerPromise = route.handler({ req, res: {} as any, reply });

    // Let the enqueue register
    await new Promise((r) => setTimeout(r, 10));

    // Dispatch a matching message
    const msg = makeDequeuedMessage();
    const matched = pool.match(msg);
    expect(matched).toBe(true);

    await handlerPromise;

    expect(reply.calls).toHaveLength(1);
    expect(reply.calls[0]!.method).toBe("json");
    expect(reply.calls[0]!.args[0]).toBe(msg);
  });
});

describe("POST /warm-start handler", () => {
  let pool: ContainerPool;

  beforeEach(() => {
    pool = new ContainerPool({ maxPoolSize: 1000 });
  });

  it("returns didWarmStart: true when a matching container is waiting", async () => {
    const route = createWarmStartPostRoute(pool);

    // Enqueue a container
    const req = mockReq(defaultHeaders);
    pool.enqueue({
      deploymentId: "deploy_1",
      deploymentVersion: "20240101.1",
      machineCpu: "0.5",
      machineMemory: "0.5",
      controllerId: "ctrl_1",
      workerInstanceName: "instance_1",
      req,
    });

    await new Promise((r) => setTimeout(r, 10));

    const msg = makeDequeuedMessage();
    const reply = createMockReply();

    await route.handler({ body: { dequeuedMessage: msg }, reply });

    expect(reply.calls).toHaveLength(1);
    expect(reply.calls[0]!.args[0]).toEqual({ didWarmStart: true });
  });

  it("returns didWarmStart: false when pool has no match", async () => {
    const route = createWarmStartPostRoute(pool);
    const msg = makeDequeuedMessage();
    const reply = createMockReply();

    await route.handler({ body: { dequeuedMessage: msg }, reply });

    expect(reply.calls).toHaveLength(1);
    expect(reply.calls[0]!.args[0]).toEqual({ didWarmStart: false });
  });

  it("returns 400 on invalid/missing request body (via bodySchema)", () => {
    const route = createWarmStartPostRoute(pool);

    // The bodySchema is validated by HttpServer before the handler is called.
    // Verify the schema rejects invalid input.
    expect(route.bodySchema).toBeDefined();
    const result = route.bodySchema.safeParse({});
    expect(result.success).toBe(false);

    const result2 = route.bodySchema.safeParse({ dequeuedMessage: "not-valid" });
    expect(result2.success).toBe(false);
  });
});

describe("GET /connect handler", () => {
  it("returns configured connectionTimeoutMs and keepaliveMs values", async () => {
    const route = createConnectRoute();
    const reply = createMockReply();

    await route.handler({ reply });

    expect(reply.calls).toHaveLength(1);
    expect(reply.calls[0]!.method).toBe("json");

    const data = reply.calls[0]!.args[0] as Record<string, unknown>;
    expect(data).toHaveProperty("connectionTimeoutMs");
    expect(data).toHaveProperty("keepaliveMs");
    expect(typeof data.connectionTimeoutMs).toBe("number");
    expect(typeof data.keepaliveMs).toBe("number");
  });
});

describe("Integration: full long-poll flow", () => {
  let server: HttpServer;
  let pool: ContainerPool;
  let port: number;

  beforeEach(async () => {
    pool = new ContainerPool({ maxPoolSize: 1000 });
    // Use port 0 for random available port
    server = new HttpServer({ port: 0, host: "127.0.0.1" });

    server
      .route("/connect", "GET", createConnectRoute())
      .route("/warm-start", "GET", createWarmStartGetRoute(pool))
      .route("/warm-start", "POST", createWarmStartPostRoute(pool));

    await server.start();

    const addr = server.server.address();
    if (typeof addr === "object" && addr !== null) {
      port = addr.port;
    }
  });

  afterEach(async () => {
    await server.stop();
  });

  it("GET registers in pool, POST dispatches, GET resolves with DequeuedMessage", async () => {
    // Start GET long-poll
    const getPromise = fetch(`http://127.0.0.1:${port}/warm-start`, {
      method: "GET",
      headers: defaultHeaders,
    });

    // Wait for the container to register in the pool
    await new Promise((r) => setTimeout(r, 50));
    expect(pool.totalWaiting).toBe(1);

    // POST a matching message
    const msg = makeDequeuedMessage();
    const postRes = await fetch(`http://127.0.0.1:${port}/warm-start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dequeuedMessage: msg }),
    });

    const postBody = await postRes.json();
    expect(postBody).toEqual({ didWarmStart: true });

    // GET should resolve with the dequeued message
    const getRes = await getPromise;
    expect(getRes.status).toBe(200);

    const getBody = await getRes.json();
    expect(getBody.run.id).toBe("run_1");
    expect(getBody.deployment.friendlyId).toBe("deploy_1");
    expect(getBody.backgroundWorker.version).toBe("20240101.1");
  });

  it("GET registers, client disconnects before POST, POST returns didWarmStart: false", async () => {
    // Use a raw TCP socket to send the HTTP request so we can reliably
    // trigger the server-side 'close' event by destroying the socket.
    const rawSocket = net.connect(port, "127.0.0.1");

    await new Promise<void>((resolve) => rawSocket.on("connect", resolve));
    rawSocket.on("error", () => {});

    // Send a raw HTTP/1.1 GET request
    const headerLines = Object.entries(defaultHeaders)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\r\n");
    rawSocket.write(
      `GET /warm-start HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n${headerLines}\r\n\r\n`
    );

    // Wait for the container to register in the pool
    const deadline1 = Date.now() + 3000;
    while (pool.totalWaiting === 0 && Date.now() < deadline1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(pool.totalWaiting).toBe(1);

    // Destroy the TCP socket to simulate client disconnect
    rawSocket.destroy();

    // Poll until the disconnect propagates to the pool
    const deadline2 = Date.now() + 3000;
    while (pool.totalWaiting > 0 && Date.now() < deadline2) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(pool.totalWaiting).toBe(0);

    // POST should find no match
    const msg = makeDequeuedMessage();
    const postRes = await fetch(`http://127.0.0.1:${port}/warm-start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dequeuedMessage: msg }),
    });

    const postBody = await postRes.json();
    expect(postBody).toEqual({ didWarmStart: false });
  }, 10000);
});
