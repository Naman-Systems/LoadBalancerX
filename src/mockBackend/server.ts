import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

interface MockBackendOptions {
  port: number;
  latencyMs: number;
  failRate: number;
  unhealthyAfterRequests: number | null;
}

function parseArgs(argv: string[]): MockBackendOptions {
  const options: MockBackendOptions = {
    port: 9001,
    latencyMs: 0,
    failRate: 0,
    unhealthyAfterRequests: null,
  };

  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    switch (key) {
      case "port":
        options.port = Number(value);
        break;
      case "latency-ms":
        options.latencyMs = Number(value);
        break;
      case "fail-rate":
        options.failRate = Number(value);
        break;
      case "unhealthy-after-requests":
        options.unhealthyAfterRequests = Number(value);
        break;
    }
  }

  return options;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createMockBackend(options: MockBackendOptions) {
  let requestCount = 0;
  let forcedUnhealthy = false;

  const server = http.createServer(async (req, res) => {
    if (req.url === "/health") {
      const healthy = !forcedUnhealthy;
      res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ healthy }));
      return;
    }

    requestCount += 1;

    if (
      options.unhealthyAfterRequests !== null &&
      requestCount > options.unhealthyAfterRequests
    ) {
      forcedUnhealthy = true;
    }

    if (options.latencyMs > 0) {
      await sleep(options.latencyMs);
    }

    if (Math.random() < options.failRate) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "simulated failure" }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ port: options.port, requestCount }));
  });

  return server;
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  const server = createMockBackend(options);
  server.listen(options.port, () => {
    console.log(
      `mock backend listening on :${options.port} (latency=${options.latencyMs}ms, failRate=${options.failRate})`,
    );
  });
}
