import type { Config } from "../config.js";
import type { BackendState } from "./backendPool.js";
import { RoundRobinStrategy } from "./strategies/roundRobin.js";
import { LeastConnectionsStrategy } from "./strategies/leastConnections.js";
import { ConsistentHashingStrategy } from "./strategies/consistentHashing.js";

export interface RequestContext {
  clientIp: string;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Wraps the three selection strategies behind one call. Round robin and
 * least connections ignore the request context; consistent hashing uses it
 * to derive the ring key.
 */
export class Router {
  private readonly strategy:
    | RoundRobinStrategy
    | LeastConnectionsStrategy
    | ConsistentHashingStrategy;

  constructor(private readonly config: Config) {
    switch (config.strategy) {
      case "round-robin":
        this.strategy = new RoundRobinStrategy();
        break;
      case "least-connections":
        this.strategy = new LeastConnectionsStrategy();
        break;
      case "consistent-hashing":
        this.strategy = new ConsistentHashingStrategy(config.consistentHashing.virtualNodes);
        break;
    }
  }

  select(backends: BackendState[], context: RequestContext): BackendState | null {
    if (this.strategy instanceof ConsistentHashingStrategy) {
      return this.strategy.select(backends, this.hashKey(context));
    }
    return this.strategy.select(backends);
  }

  private hashKey(context: RequestContext): string {
    const { hashKeySource, headerName } = this.config.consistentHashing;
    if (hashKeySource === "header") {
      const value = context.headers[headerName.toLowerCase()];
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
    return context.clientIp;
  }
}
