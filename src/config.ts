import { readFileSync } from "node:fs";

export const STRATEGIES = ["round-robin", "least-connections", "consistent-hashing"] as const;
export type StrategyName = (typeof STRATEGIES)[number];

export const HASH_KEY_SOURCES = ["client-ip", "header"] as const;
export type HashKeySource = (typeof HASH_KEY_SOURCES)[number];

export interface HealthCheckConfig {
  path: string;
  intervalMs: number;
  timeoutMs: number;
  failureThreshold: number;
  recoveryThreshold: number;
}

export interface ConsistentHashingConfig {
  virtualNodes: number;
  hashKeySource: HashKeySource;
  headerName: string;
}

export interface Config {
  listenPort: number;
  adminPort: number;
  strategy: StrategyName;
  backends: string[];
  requestTimeoutMs: number;
  healthCheck: HealthCheckConfig;
  consistentHashing: ConsistentHashingConfig;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

const DEFAULT_HEALTH_CHECK: HealthCheckConfig = {
  path: "/health",
  intervalMs: 2000,
  timeoutMs: 1000,
  failureThreshold: 3,
  recoveryThreshold: 2,
};

const DEFAULT_CONSISTENT_HASHING: ConsistentHashingConfig = {
  virtualNodes: 100,
  hashKeySource: "client-ip",
  headerName: "x-session-key",
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`invalid config: ${message}`);
  }
}

export function parseConfig(raw: unknown): Config {
  assert(typeof raw === "object" && raw !== null, "must be a JSON object");
  const obj = raw as Record<string, unknown>;

  assert(typeof obj.listenPort === "number", "listenPort must be a number");
  assert(typeof obj.adminPort === "number", "adminPort must be a number");
  assert(
    STRATEGIES.includes(obj.strategy as StrategyName),
    `strategy must be one of ${STRATEGIES.join(", ")}`,
  );
  assert(
    Array.isArray(obj.backends) && obj.backends.length > 0,
    "backends must be a non-empty array",
  );
  for (const backend of obj.backends) {
    assert(typeof backend === "string", "each backend must be a host:port string");
  }

  const healthCheck = { ...DEFAULT_HEALTH_CHECK, ...(obj.healthCheck as object) };
  const consistentHashing = {
    ...DEFAULT_CONSISTENT_HASHING,
    ...(obj.consistentHashing as object),
  };
  assert(
    HASH_KEY_SOURCES.includes(consistentHashing.hashKeySource),
    `consistentHashing.hashKeySource must be one of ${HASH_KEY_SOURCES.join(", ")}`,
  );

  const requestTimeoutMs =
    typeof obj.requestTimeoutMs === "number"
      ? obj.requestTimeoutMs
      : DEFAULT_REQUEST_TIMEOUT_MS;

  return {
    listenPort: obj.listenPort,
    adminPort: obj.adminPort,
    strategy: obj.strategy as StrategyName,
    backends: obj.backends as string[],
    requestTimeoutMs,
    healthCheck,
    consistentHashing,
  };
}

export function loadConfig(filePath: string): Config {
  const contents = readFileSync(filePath, "utf-8");
  return parseConfig(JSON.parse(contents));
}
