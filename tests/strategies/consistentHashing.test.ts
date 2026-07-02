import { describe, it, expect } from "vitest";

import { BackendPool } from "../../src/lb/backendPool.js";
import { HashRing } from "../../src/lb/strategies/hashRing.js";
import { ConsistentHashingStrategy } from "../../src/lb/strategies/consistentHashing.js";

function sampleKeys(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `key-${i}`);
}

describe("HashRing", () => {
  it("returns null when the ring is empty", () => {
    const ring = new HashRing(50);
    expect(ring.get("anything")).toBeNull();
  });

  it("maps the same key to the same backend while the ring is stable", () => {
    const ring = new HashRing(100);
    ring.add("a");
    ring.add("b");
    ring.add("c");

    for (const key of sampleKeys(100)) {
      expect(ring.get(key)).toBe(ring.get(key));
    }
  });

  it("spreads keys across all backends", () => {
    const ring = new HashRing(200);
    ring.add("a");
    ring.add("b");
    ring.add("c");

    const seen = new Set(sampleKeys(1000).map((k) => ring.get(k)));
    expect(seen).toEqual(new Set(["a", "b", "c"]));
  });

  it("only remaps keys that were on the removed backend", () => {
    const ring = new HashRing(150);
    ring.add("a");
    ring.add("b");
    ring.add("c");

    const keys = sampleKeys(2000);
    const before = new Map(keys.map((k) => [k, ring.get(k)]));

    ring.remove("b");
    const after = new Map(keys.map((k) => [k, ring.get(k)]));

    for (const key of keys) {
      const wasOnB = before.get(key) === "b";
      if (wasOnB) {
        // its new home is some other backend
        expect(after.get(key)).not.toBe("b");
      } else {
        // untouched backends keep their keys
        expect(after.get(key)).toBe(before.get(key));
      }
    }
  });

  it("re-adding a backend restores its original key mapping", () => {
    const ring = new HashRing(150);
    ring.add("a");
    ring.add("b");
    ring.add("c");

    const keys = sampleKeys(1000);
    const original = new Map(keys.map((k) => [k, ring.get(k)]));

    ring.remove("b");
    ring.add("b");
    const restored = new Map(keys.map((k) => [k, ring.get(k)]));

    for (const key of keys) {
      expect(restored.get(key)).toBe(original.get(key));
    }
  });
});

describe("ConsistentHashingStrategy", () => {
  function poolOf(...addrs: string[]): BackendPool {
    return new BackendPool(addrs);
  }

  it("routes the same key to the same backend", () => {
    const pool = poolOf("localhost:1", "localhost:2", "localhost:3");
    const strategy = new ConsistentHashingStrategy(100);

    const first = strategy.select(pool.getAll(), "session-abc")?.id;
    const second = strategy.select(pool.getAll(), "session-abc")?.id;

    expect(first).toBeDefined();
    expect(second).toBe(first);
  });

  it("excludes an unhealthy backend and only moves its keys", () => {
    const pool = poolOf("localhost:1", "localhost:2", "localhost:3");
    const strategy = new ConsistentHashingStrategy(150);
    const keys = sampleKeys(500);

    const before = new Map(
      keys.map((k) => [k, strategy.select(pool.getAll(), k)?.id]),
    );

    pool.setHealthy("localhost:2", false);
    const after = new Map(
      keys.map((k) => [k, strategy.select(pool.getAll(), k)?.id]),
    );

    for (const key of keys) {
      if (before.get(key) === "localhost:2") {
        expect(after.get(key)).not.toBe("localhost:2");
      } else {
        expect(after.get(key)).toBe(before.get(key));
      }
    }
  });

  it("returns null when nothing is healthy", () => {
    const pool = poolOf("localhost:1");
    pool.setHealthy("localhost:1", false);
    const strategy = new ConsistentHashingStrategy(100);

    expect(strategy.select(pool.getAll(), "key")).toBeNull();
  });
});
