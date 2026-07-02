import type { BackendState } from "../backendPool.js";
import { HashRing } from "./hashRing.js";

/**
 * Routes a request to a backend by hashing a per-request key (client IP or
 * a configured header) onto a ring. The same key lands on the same backend
 * as long as the healthy set is stable. Only when a backend drops out or
 * comes back is the ring rebuilt, and only the affected keys move.
 */
export class ConsistentHashingStrategy {
  private ring: HashRing;
  private currentHealthySignature = "";

  constructor(private readonly virtualNodes: number = 100) {
    this.ring = new HashRing(virtualNodes);
  }

  select(allBackends: BackendState[], key: string): BackendState | null {
    const healthy = allBackends.filter((b) => b.healthy);
    this.syncRing(healthy);

    const chosenId = this.ring.get(key);
    if (chosenId === null) {
      return null;
    }
    return healthy.find((b) => b.id === chosenId) ?? null;
  }

  private syncRing(healthy: BackendState[]): void {
    const signature = healthy
      .map((b) => b.id)
      .sort()
      .join(",");
    if (signature === this.currentHealthySignature) {
      return;
    }

    this.ring = new HashRing(this.virtualNodes);
    for (const backend of healthy) {
      this.ring.add(backend.id);
    }
    this.currentHealthySignature = signature;
  }
}
