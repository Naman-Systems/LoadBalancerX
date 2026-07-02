import type { BackendPool } from "./backendPool.js";

export interface HealthThresholds {
  failureThreshold: number;
  recoveryThreshold: number;
}

export type HealthTransition = "marked-unhealthy" | "marked-healthy" | "none";

/**
 * Owns the up/down state machine for backends. Both the periodic health
 * checker and the proxy's mid-request error path funnel their signals
 * through here, so a live 502 counts toward the same failure threshold as a
 * failed probe (a deliberate design choice - see TRD). Consecutive counters
 * and thresholds are evaluated in one place to keep the two callers in sync.
 */
export class HealthTracker {
  constructor(
    private readonly pool: BackendPool,
    private readonly thresholds: HealthThresholds,
  ) {}

  recordFailure(id: string): HealthTransition {
    const backend = this.pool.get(id);
    this.pool.recordFailure(id);
    if (backend.healthy && backend.consecutiveFailures >= this.thresholds.failureThreshold) {
      this.pool.setHealthy(id, false);
      return "marked-unhealthy";
    }
    return "none";
  }

  recordSuccess(id: string): HealthTransition {
    const backend = this.pool.get(id);
    this.pool.recordSuccess(id);
    if (!backend.healthy && backend.consecutiveSuccesses >= this.thresholds.recoveryThreshold) {
      this.pool.setHealthy(id, true);
      return "marked-healthy";
    }
    return "none";
  }
}
