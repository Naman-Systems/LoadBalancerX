export interface BackendState {
  id: string; // host:port
  host: string;
  port: number;
  healthy: boolean;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  inFlight: number;
  requestCount: number;
}

function parseBackendAddr(addr: string): { host: string; port: number } {
  const [host, portStr] = addr.split(":");
  const port = Number(portStr);
  if (!host || Number.isNaN(port)) {
    throw new Error(`invalid backend address: ${addr}`);
  }
  return { host, port };
}

/**
 * Single source of truth for backend health and load state.
 * Strategies read from it, the health checker writes to it.
 * Nothing else should mutate state directly.
 */
export class BackendPool {
  private backends: Map<string, BackendState> = new Map();

  constructor(backendAddrs: string[]) {
    for (const addr of backendAddrs) {
      const { host, port } = parseBackendAddr(addr);
      this.backends.set(addr, {
        id: addr,
        host,
        port,
        healthy: true,
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        inFlight: 0,
        requestCount: 0,
      });
    }
  }

  getAll(): BackendState[] {
    return [...this.backends.values()];
  }

  getHealthy(): BackendState[] {
    return this.getAll().filter((b) => b.healthy);
  }

  get(id: string): BackendState {
    const backend = this.backends.get(id);
    if (!backend) {
      throw new Error(`unknown backend: ${id}`);
    }
    return backend;
  }

  incrementInFlight(id: string): void {
    this.get(id).inFlight += 1;
  }

  decrementInFlight(id: string): void {
    const backend = this.get(id);
    backend.inFlight = Math.max(0, backend.inFlight - 1);
  }

  /**
   * Wraps a request against a backend so the in-flight count is always
   * incremented before and decremented after, even if the request throws
   * (connection drop, timeout, 5xx). Least-connections relies on this
   * symmetry - a missed decrement on the error path silently skews every
   * later routing decision, so all proxying goes through here.
   */
  async trackInFlight<T>(id: string, run: () => Promise<T>): Promise<T> {
    this.incrementInFlight(id);
    try {
      return await run();
    } finally {
      this.decrementInFlight(id);
    }
  }

  incrementRequestCount(id: string): void {
    this.get(id).requestCount += 1;
  }

  setHealthy(id: string, healthy: boolean): void {
    this.get(id).healthy = healthy;
  }

  recordFailure(id: string): void {
    const backend = this.get(id);
    backend.consecutiveFailures += 1;
    backend.consecutiveSuccesses = 0;
  }

  recordSuccess(id: string): void {
    const backend = this.get(id);
    backend.consecutiveSuccesses += 1;
    backend.consecutiveFailures = 0;
  }
}
