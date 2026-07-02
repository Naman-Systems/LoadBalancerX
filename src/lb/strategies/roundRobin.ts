import type { BackendState } from "../backendPool.js";

/**
 * Cycles through the full backend list in order, skipping unhealthy ones,
 * without letting skipped backends disturb the cycle position for later
 * picks.
 */
export class RoundRobinStrategy {
  private cursor = 0;

  select(allBackends: BackendState[]): BackendState | null {
    const healthy = allBackends.filter((b) => b.healthy);
    if (healthy.length === 0) {
      return null;
    }

    const startIndex = this.cursor % allBackends.length;
    for (let i = 0; i < allBackends.length; i++) {
      const candidate = allBackends[(startIndex + i) % allBackends.length];
      if (candidate.healthy) {
        this.cursor = (startIndex + i + 1) % allBackends.length;
        return candidate;
      }
    }

    return null;
  }
}
