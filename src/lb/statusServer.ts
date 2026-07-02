import http from "node:http";

import type { StrategyName } from "../config.js";
import type { BackendPool } from "./backendPool.js";

interface StatusServerDeps {
  pool: BackendPool;
  strategy: StrategyName;
}

/**
 * Admin endpoint on its own port so it never collides with proxied paths.
 * GET /lb-status returns the live view of each backend's health and counts.
 */
export class StatusServer {
  private readonly server: http.Server;

  constructor(private readonly deps: StatusServerDeps) {
    this.server = http.createServer((req, res) => this.handle(req, res));
  }

  listen(port: number, onListening?: () => void): void {
    this.server.listen(port, onListening);
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.url !== "/lb-status") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }

    const body = {
      strategy: this.deps.strategy,
      backends: this.deps.pool.getAll().map((b) => ({
        id: b.id,
        healthy: b.healthy,
        inFlight: b.inFlight,
        requestCount: b.requestCount,
        consecutiveFailures: b.consecutiveFailures,
        consecutiveSuccesses: b.consecutiveSuccesses,
      })),
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body, null, 2));
  }
}
