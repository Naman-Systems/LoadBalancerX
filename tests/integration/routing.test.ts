import { describe, it, expect, afterEach } from "vitest";

import {
  buildConfig,
  createLoadBalancer,
  listenProxy,
  startBackend,
  closeBackend,
  get,
  sleep,
  type StartedBackend,
} from "./helpers.js";
import type { LoadBalancer } from "../../src/cli.js";

const backends: StartedBackend[] = [];
let lb: LoadBalancer | null = null;

afterEach(async () => {
  if (lb) {
    await lb.stop();
    lb = null;
  }
  while (backends.length > 0) {
    await closeBackend(backends.pop()!);
  }
});

async function spawnBackends(count: number, latencyMs = 0): Promise<StartedBackend[]> {
  const started = await Promise.all(
    Array.from({ length: count }, () => startBackend({ latencyMs })),
  );
  backends.push(...started);
  return started;
}

describe("round robin routing", () => {
  it("spreads requests evenly across all healthy backends", async () => {
    const pool = await spawnBackends(3);
    lb = createLoadBalancer(buildConfig("round-robin", pool.map((b) => b.id)));
    const port = await listenProxy(lb);

    const counts = new Map<number, number>();
    for (let i = 0; i < 30; i++) {
      const res = await get(port);
      expect(res.status).toBe(200);
      counts.set(res.backendPort!, (counts.get(res.backendPort!) ?? 0) + 1);
    }

    for (const backend of pool) {
      expect(counts.get(backend.port)).toBe(10);
    }
  });
});

describe("least connections routing", () => {
  it("sends fewer requests to a slower backend under concurrency", async () => {
    const [fast1, fast2] = await spawnBackends(2, 0);
    const [slow] = await spawnBackends(1, 120);
    lb = createLoadBalancer(
      buildConfig("least-connections", [fast1.id, fast2.id, slow.id]),
    );
    const port = await listenProxy(lb);

    const counts = new Map<number, number>();
    const fire = async () => {
      const res = await get(port);
      counts.set(res.backendPort!, (counts.get(res.backendPort!) ?? 0) + 1);
    };
    // fire in concurrent waves so the slow backend stays busy
    for (let wave = 0; wave < 15; wave++) {
      await Promise.all(Array.from({ length: 6 }, fire));
    }

    const slowCount = counts.get(slow.port) ?? 0;
    const fastCount = (counts.get(fast1.port) ?? 0) + (counts.get(fast2.port) ?? 0);
    expect(fastCount).toBeGreaterThan(slowCount);
  });
});

describe("consistent hashing routing", () => {
  it("routes the same session key to the same backend", async () => {
    const pool = await spawnBackends(3);
    lb = createLoadBalancer(buildConfig("consistent-hashing", pool.map((b) => b.id)));
    const port = await listenProxy(lb);

    const first = await get(port, "/", { "X-Session-Key": "user-42" });
    for (let i = 0; i < 10; i++) {
      const res = await get(port, "/", { "X-Session-Key": "user-42" });
      expect(res.backendPort).toBe(first.backendPort);
    }
  });
});

describe("failure handling", () => {
  it("returns 502 when the chosen backend connection fails", async () => {
    const [dead] = await spawnBackends(1);
    const deadId = dead.id;
    await closeBackend(backends.pop()!); // kill it but keep it in the config

    lb = createLoadBalancer(buildConfig("round-robin", [deadId]));
    // stop the health checker from pulling it out so we hit the live 502 path
    lb.checker.stop();
    const port = await listenProxy(lb);

    const res = await get(port);
    expect(res.status).toBe(502);
  });

  it("drops an unhealthy backend from rotation via the health checker", async () => {
    const healthy = (await spawnBackends(1))[0];
    const flaky = await startBackend({ unhealthyAfterRequests: 0 });
    backends.push(flaky);

    lb = createLoadBalancer(buildConfig("round-robin", [healthy.id, flaky.id]));
    const port = await listenProxy(lb);
    lb.checker.start();

    // fire enough requests that round robin hits the flaky backend and
    // flips its /health to unhealthy
    for (let i = 0; i < 6; i++) {
      await get(port);
    }
    // give the checker a few intervals to notice and remove it
    await sleep(700);

    const results = new Set<number>();
    for (let i = 0; i < 10; i++) {
      const res = await get(port);
      results.add(res.backendPort!);
    }

    expect(results.has(healthy.port)).toBe(true);
    expect(results.has(flaky.port)).toBe(false);
  });
});
