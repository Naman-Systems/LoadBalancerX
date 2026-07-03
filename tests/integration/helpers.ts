import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { createMockBackend, type MockBackendOptions } from "../../src/mockBackend/server.js";
import { createLoadBalancer, type LoadBalancer } from "../../src/cli.js";
import type { Config, StrategyName } from "../../src/config.js";

export interface StartedBackend {
  server: Server;
  port: number;
  id: string;
}

export function startBackend(overrides: Partial<MockBackendOptions> = {}): Promise<StartedBackend> {
  const options: MockBackendOptions = {
    port: 0,
    latencyMs: 0,
    failRate: 0,
    unhealthyAfterRequests: null,
    ...overrides,
  };
  const server = createMockBackend(options);
  return new Promise((resolve) => {
    server.listen(0, () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, port, id: `localhost:${port}` });
    });
  });
}

export function closeBackend(backend: StartedBackend): Promise<void> {
  return new Promise((resolve) => backend.server.close(() => resolve()));
}

export function buildConfig(strategy: StrategyName, backendIds: string[]): Config {
  return {
    listenPort: 0,
    adminPort: 0,
    strategy,
    backends: backendIds,
    requestTimeoutMs: 2000,
    healthCheck: {
      path: "/health",
      intervalMs: 200,
      timeoutMs: 200,
      failureThreshold: 2,
      recoveryThreshold: 2,
    },
    consistentHashing: {
      virtualNodes: 100,
      hashKeySource: "header",
      headerName: "x-session-key",
    },
  };
}

export function listenProxy(lb: LoadBalancer): Promise<number> {
  return new Promise((resolve) => {
    lb.proxy.listen(0, () => resolve(lb.proxy.address()!.port));
  });
}

export { createLoadBalancer };

export interface Response {
  status: number;
  body: string;
  backendPort: number | null;
}

export async function get(
  port: number,
  path = "/",
  headers: Record<string, string> = {},
): Promise<Response> {
  const res = await fetch(`http://localhost:${port}${path}`, { headers });
  const body = await res.text();
  let backendPort: number | null = null;
  try {
    backendPort = JSON.parse(body).port ?? null;
  } catch {
    backendPort = null;
  }
  return { status: res.status, body, backendPort };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
