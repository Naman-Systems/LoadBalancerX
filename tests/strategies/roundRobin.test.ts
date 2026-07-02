import { describe, it, expect } from "vitest";

import { BackendPool } from "../../src/lb/backendPool.js";
import { RoundRobinStrategy } from "../../src/lb/strategies/roundRobin.js";

function poolOf(...addrs: string[]): BackendPool {
  return new BackendPool(addrs);
}

describe("RoundRobinStrategy", () => {
  it("cycles through backends in order and wraps around", () => {
    const pool = poolOf("localhost:1", "localhost:2", "localhost:3");
    const strategy = new RoundRobinStrategy();

    const picks = Array.from({ length: 4 }, () =>
      strategy.select(pool.getAll())?.id,
    );

    expect(picks).toEqual([
      "localhost:1",
      "localhost:2",
      "localhost:3",
      "localhost:1",
    ]);
  });

  it("returns null when no backends are healthy", () => {
    const pool = poolOf("localhost:1", "localhost:2");
    pool.setHealthy("localhost:1", false);
    pool.setHealthy("localhost:2", false);
    const strategy = new RoundRobinStrategy();

    expect(strategy.select(pool.getAll())).toBeNull();
  });

  it("skips an unhealthy backend without breaking the cycle order", () => {
    const pool = poolOf("localhost:1", "localhost:2", "localhost:3");
    pool.setHealthy("localhost:2", false);
    const strategy = new RoundRobinStrategy();

    const picks = Array.from({ length: 4 }, () =>
      strategy.select(pool.getAll())?.id,
    );

    expect(picks).toEqual([
      "localhost:1",
      "localhost:3",
      "localhost:1",
      "localhost:3",
    ]);
  });

  it("brings a recovered backend back into rotation", () => {
    const pool = poolOf("localhost:1", "localhost:2", "localhost:3");
    const strategy = new RoundRobinStrategy();

    pool.setHealthy("localhost:2", false);
    expect(strategy.select(pool.getAll())?.id).toBe("localhost:1");
    expect(strategy.select(pool.getAll())?.id).toBe("localhost:3");

    pool.setHealthy("localhost:2", true);
    const nextTwo = [
      strategy.select(pool.getAll())?.id,
      strategy.select(pool.getAll())?.id,
    ];
    expect(nextTwo).toContain("localhost:2");
  });
});
