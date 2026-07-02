import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadConfig } from "./config.js";
import { BackendPool } from "./lb/backendPool.js";
import { HealthTracker } from "./lb/healthState.js";
import { HealthChecker } from "./lb/healthChecker.js";
import { Router } from "./lb/router.js";
import { ProxyServer } from "./lb/server.js";

function configPathFromArgs(argv: string[]): string {
  const flag = argv.find((a) => a.startsWith("--config="));
  const relative = flag ? flag.split("=")[1] : "config.json";
  return path.resolve(relative);
}

export function startLoadBalancer(configPath: string) {
  const config = loadConfig(configPath);
  const pool = new BackendPool(config.backends);
  const health = new HealthTracker(pool, config.healthCheck);
  const router = new Router(config);
  const checker = new HealthChecker(pool, health, config.healthCheck);

  const proxy = new ProxyServer({ config, pool, router, health });
  proxy.listen(config.listenPort, () => {
    console.log(
      `load balancer listening on :${config.listenPort} (strategy=${config.strategy}, backends=${config.backends.length})`,
    );
  });
  checker.start();

  return { config, pool, health, router, proxy, checker };
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  startLoadBalancer(configPathFromArgs(process.argv.slice(2)));
}
