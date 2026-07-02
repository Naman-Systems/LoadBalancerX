import { describe, it, expect } from "vitest";

import { BackendPool } from "../../src/lb/backendPool.js";
import { LeastConnectionsStrategy } from "../../src/lb/strategies/leastConnections.js";

function poolOf(...addrs: string[]): BackendPool {
  return new BackendPool(addrs);
}

describe("LeastConnectionsStrategy", () => {
  it("routes to the backend with the fewest in-flight requests", () => {
    const pool = poolOf("localhost:1", "localhost:2", "localhost:3");
    pool.incrementInFlight("localhost:1");
    pool.incrementInFlight("localhost:1");
    pool.incrementInFlight("localhost:2");
    const strategy = new LeastConnectionsStrategy();

    expect(strategy.select(pool.getAll())?.id).toBe("localhost:3");
  });

  it("breaks ties by list order", () => {
    const pool = poolOf("localhost:1", "localhost:2", "localhost:3");
    const strategy = new LeastConnectionsStrategy();

    expect(strategy.select(pool.getAll())?.id).toBe("localhost:1");
  });

  it("ignores unhealthy backends even if they have the lowest count", () => {
    const pool = poolOf("localhost:1", "localhost:2");
    pool.incrementInFlight("localhost:2");
    pool.setHealthy("localhost:1", false);
    const strategy = new LeastConnectionsStrategy();

    expect(strategy.select(pool.getAll())?.id).toBe("localhost:2");
  });

  it("returns null when nothing is healthy", () => {
    const pool = poolOf("localhost:1");
    pool.setHealthy("localhost:1", false);
    const strategy = new LeastConnectionsStrategy();

    expect(strategy.select(pool.getAll())).toBeNull();
  });
});

describe("BackendPool.trackInFlight", () => {
  it("increments during the request and decrements after it succeeds", async () => {
    const pool = poolOf("localhost:1");

    const result = await pool.trackInFlight("localhost:1", async () => {
      expect(pool.get("localhost:1").inFlight).toBe(1);
      return "ok";
    });

    expect(result).toBe("ok");
    expect(pool.get("localhost:1").inFlight).toBe(0);
  });

  it("decrements even when the request throws", async () => {
    const pool = poolOf("localhost:1");

    await expect(
      pool.trackInFlight("localhost:1", async () => {
        expect(pool.get("localhost:1").inFlight).toBe(1);
        throw new Error("connection dropped");
      }),
    ).rejects.toThrow("connection dropped");

    expect(pool.get("localhost:1").inFlight).toBe(0);
  });

  it("keeps the count symmetric across many mixed success/error requests", async () => {
    const pool = poolOf("localhost:1");

    for (let i = 0; i < 50; i++) {
      const shouldFail = i % 3 === 0;
      try {
        await pool.trackInFlight("localhost:1", async () => {
          if (shouldFail) throw new Error("boom");
        });
      } catch {
        // expected for the failing third of requests
      }
    }

    expect(pool.get("localhost:1").inFlight).toBe(0);
  });

  it("never drops below zero on an unbalanced decrement", () => {
    const pool = poolOf("localhost:1");
    pool.decrementInFlight("localhost:1");
    expect(pool.get("localhost:1").inFlight).toBe(0);
  });
});
