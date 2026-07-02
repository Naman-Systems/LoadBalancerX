import type { BackendState } from "../backendPool.js";

/**
 * Routes to the healthy backend with the fewest in-flight requests.
 * Ties are broken by list order (the first backend seen wins), which
 * keeps selection deterministic and testable.
 */
export class LeastConnectionsStrategy {
  select(allBackends: BackendState[]): BackendState | null {
    let chosen: BackendState | null = null;
    for (const backend of allBackends) {
      if (!backend.healthy) {
        continue;
      }
      if (chosen === null || backend.inFlight < chosen.inFlight) {
        chosen = backend;
      }
    }
    return chosen;
  }
}
