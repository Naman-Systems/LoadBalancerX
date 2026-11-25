import http from "node:http";
import type { AddressInfo } from "node:net";

import type { Config } from "../config.js";
import type { BackendPool, BackendState } from "./backendPool.js";
import type { HealthTracker } from "./healthState.js";
import { Router, type RequestContext } from "./router.js";

interface ProxyServerDeps {
  config: Config;
  pool: BackendPool;
  router: Router;
  health: HealthTracker;
}

function contextFromRequest(req: http.IncomingMessage): RequestContext {
  return {
    clientIp: req.socket.remoteAddress ?? "unknown",
    headers: req.headers,
  };
}

export class ProxyServer {
  private readonly server: http.Server;

  constructor(private readonly deps: ProxyServerDeps) {
    this.server = http.createServer((req, res) => this.handle(req, res));
  }

  listen(port: number, onListening?: () => void): void {
    this.server.listen(port, onListening);
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  address(): AddressInfo | null {
    const addr = this.server.address();
    return typeof addr === "object" ? addr : null;
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const context = contextFromRequest(req);
    const backend = this.deps.router.select(this.deps.pool.getAll(), context);

    if (backend === null) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "no healthy backends available" }));
      return;
    }

    this.deps.pool.incrementRequestCount(backend.id);
    void this.deps.pool.trackInFlight(backend.id, () => this.proxy(backend, req, res));
  }

  private proxy(
    backend: BackendState,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      const failConnection = () => {
        if (settled) {
          return;
        }
        this.deps.health.recordFailure(backend.id);
        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "backend connection failed" }));
        } else {
          res.destroy();
        }
        finish();
      };

      const upstream = http.request(
        {
          host: backend.host,
          port: backend.port,
          method: req.method,
          path: req.url,
          headers: req.headers,
          timeout: this.deps.config.requestTimeoutMs,
        },
        (upstreamRes) => {
          res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
          upstreamRes.pipe(res);
          upstreamRes.on("end", () => {
            if (!settled) {
              this.deps.health.recordSuccess(backend.id);
            }
            finish();
          });
          upstreamRes.on("error", failConnection);
        },
      );

      upstream.on("error", failConnection);
      upstream.on("timeout", () => {
        upstream.destroy();
        failConnection();
      });

      req.pipe(upstream);
    });
  }
}
