import { describe, it, expect } from "vitest";

import { BackendPool } from "../src/lb/backendPool.js";
import { HealthTracker } from "../src/lb/healthState.js";
import { HealthChecker } from "../src/lb/healthChecker.js";
import type { HealthCheckConfig } from "../src/config.js";

const config: HealthCheckConfig = {
  path: "/health",
  intervalMs: 1000,
  timeoutMs: 500,
  failureThreshold: 3,
  recoveryThreshold: 2,
};

function setup(probeResult: (id: string) => boolean) {
  const pool = new BackendPool(["localhost:1", "localhost:2"]);
  const health = new HealthTracker(pool, config);
  const checker = new HealthChecker(pool, health, config, async (backend) =>
    probeResult(backend.id),
  );
  return { pool, checker };
}

describe("HealthChecker", () => {
  it("marks a backend unhealthy only after the failure threshold", async () => {
    const { pool, checker } = setup((id) => id !== "localhost:1");

    await checker.probeOnce();
    await checker.probeOnce();
    expect(pool.get("localhost:1").healthy).toBe(true);

    await checker.probeOnce();
    expect(pool.get("localhost:1").healthy).toBe(false);
    expect(pool.get("localhost:2").healthy).toBe(true);
  });

  it("does not flap on a single failed probe", async () => {
    let failNext = false;
    const { pool, checker } = setup(() => !failNext);

    failNext = true;
    await checker.probeOnce();
    failNext = false;
    await checker.probeOnce();
    await checker.probeOnce();

    expect(pool.get("localhost:1").healthy).toBe(true);
  });

  it("brings a backend back after the recovery threshold of successes", async () => {
    let healthy = false;
    const { pool, checker } = setup(() => healthy);

    await checker.probeOnce();
    await checker.probeOnce();
    await checker.probeOnce();
    expect(pool.get("localhost:1").healthy).toBe(false);

    healthy = true;
    await checker.probeOnce();
    expect(pool.get("localhost:1").healthy).toBe(false); // one success, not enough
    await checker.probeOnce();
    expect(pool.get("localhost:1").healthy).toBe(true);
  });

  it("probes every backend on each pass", async () => {
    const probed = new Set<string>();
    const pool = new BackendPool(["localhost:1", "localhost:2", "localhost:3"]);
    const health = new HealthTracker(pool, config);
    const checker = new HealthChecker(pool, health, config, async (backend) => {
      probed.add(backend.id);
      return true;
    });

    await checker.probeOnce();

    expect(probed).toEqual(new Set(["localhost:1", "localhost:2", "localhost:3"]));
  });
});
