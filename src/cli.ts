import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadConfig, type Config } from "./config.js";
import { BackendPool } from "./lb/backendPool.js";
import { HealthTracker } from "./lb/healthState.js";
import { HealthChecker } from "./lb/healthChecker.js";
import { Router } from "./lb/router.js";
import { ProxyServer } from "./lb/server.js";
import { StatusServer } from "./lb/statusServer.js";

function configPathFromArgs(argv: string[]): string {
  const flag = argv.find((a) => a.startsWith("--config="));
  const relative = flag ? flag.split("=")[1] : "config.json";
  return path.resolve(relative);
}

export interface LoadBalancer {
  config: Config;
  pool: BackendPool;
  health: HealthTracker;
  router: Router;
  proxy: ProxyServer;
  checker: HealthChecker;
  status: StatusServer;
  stop(): Promise<void>;
}

export function createLoadBalancer(config: Config): LoadBalancer {
  const pool = new BackendPool(config.backends);
  const health = new HealthTracker(pool, config.healthCheck);
  const router = new Router(config);
  const checker = new HealthChecker(pool, health, config.healthCheck);
  const proxy = new ProxyServer({ config, pool, router, health });
  const status = new StatusServer({ pool, strategy: config.strategy });

  return {
    config,
    pool,
    health,
    router,
    proxy,
    checker,
    status,
    async stop() {
      checker.stop();
      await Promise.all([proxy.close(), status.close()]);
    },
  };
}

export function startLoadBalancer(configPath: string): LoadBalancer {
  const config = loadConfig(configPath);
  const lb = createLoadBalancer(config);

  lb.proxy.listen(config.listenPort, () => {
    console.log(
      `load balancer listening on :${config.listenPort} (strategy=${config.strategy}, backends=${config.backends.length})`,
    );
  });
  lb.checker.start();
  lb.status.listen(config.adminPort, () => {
    console.log(`admin status endpoint on :${config.adminPort}/lb-status`);
  });

  return lb;
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  startLoadBalancer(configPathFromArgs(process.argv.slice(2)));
}
