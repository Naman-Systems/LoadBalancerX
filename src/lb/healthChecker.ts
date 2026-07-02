import http from "node:http";

import type { HealthCheckConfig } from "../config.js";
import type { BackendPool, BackendState } from "./backendPool.js";
import type { HealthTracker } from "./healthState.js";

export type ProbeFn = (backend: BackendState) => Promise<boolean>;

/**
 * Sends a lightweight GET to a backend's health path with its own timeout,
 * kept separate from the proxy request timeout so a slow real request can't
 * be confused with an unhealthy backend and vice versa.
 */
function httpProbe(path: string, timeoutMs: number): ProbeFn {
  return (backend) =>
    new Promise((resolve) => {
      const req = http.request(
        { host: backend.host, port: backend.port, method: "GET", path, timeout: timeoutMs },
        (res) => {
          const ok = res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300;
          res.resume(); // drain so the socket can be reused/closed
          resolve(ok);
        },
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
}

export class HealthChecker {
  private timer: NodeJS.Timeout | null = null;
  private readonly probe: ProbeFn;

  constructor(
    private readonly pool: BackendPool,
    private readonly health: HealthTracker,
    config: HealthCheckConfig,
    probe?: ProbeFn,
  ) {
    this.probe = probe ?? httpProbe(config.path, config.timeoutMs);
    this.intervalMs = config.intervalMs;
  }

  private readonly intervalMs: number;

  start(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => {
      void this.probeOnce();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async probeOnce(): Promise<void> {
    await Promise.all(
      this.pool.getAll().map(async (backend) => {
        const ok = await this.probe(backend);
        if (ok) {
          this.health.recordSuccess(backend.id);
        } else {
          this.health.recordFailure(backend.id);
        }
      }),
    );
  }
}
