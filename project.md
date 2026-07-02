# req.md — LoadBalancerX

## 1. Overview

A configurable load balancer that sits in front of a pool of mock backend
servers (spun up locally for demo purposes) and distributes incoming HTTP
requests using one of three pluggable strategies: round robin,
least-connections, and consistent hashing. Includes active health checks
that pull unhealthy backends out of rotation and add them back once
recovered. Portfolio project demonstrating core load-balancing algorithms
and failure handling, not a production LB replacement.

## 2. Goals

- One LB process, configurable backend pool, configurable strategy.
- Three strategies implemented correctly and swappable at runtime/config,
  not hardcoded to one.
- Active health checks (periodic probe) that mark backends up/down and
  affect routing decisions in real time.
- Mock backend pool: simple HTTP servers that can simulate latency,
  failure, and load (for least-connections/health-check demo purposes).
- Observable: LB exposes its own status endpoint showing current backend
  states and basic routing stats (request counts per backend).
- Demonstrable via a load-generation script that shows distribution
  differs visibly by strategy.

## 3. Non-Goals

- No TLS termination.
- No dynamic backend discovery (service registry, DNS-based) — static
  config list of backends is fine.
- No persistence/metrics database — in-memory counters only.
- Not a production-grade LB (no HTTP/2, no advanced retry/circuit-breaker
  policies) — those are explicitly out of scope unless promoted in TRD.

## 4. Strategies

### 4.1 Round Robin
- Cycle through healthy backends in order, one request each, wrap around.
- Must skip unhealthy backends without breaking the cycle order for the
  rest.

### 4.2 Least Connections
- Track in-flight (active, not-yet-completed) request count per backend.
- Route each new request to the healthy backend with the lowest current
  count; tie-break deterministically (e.g. first in list order).
- Must correctly decrement on response completion *and* on
  error/timeout/connection drop — a leak here silently breaks the
  algorithm, so this needs explicit test coverage.

### 4.3 Consistent Hashing
- Hash ring built from backend identifiers (e.g. host:port), with
  configurable virtual nodes per backend (default e.g. 100) to smooth
  distribution.
- Requests hashed by a configurable key (e.g. client IP, or a header like
  `X-Session-Key` if present, falling back to client IP) to a point on the
  ring, routed to the nearest backend clockwise.
- When a backend is removed (unhealthy) or added (recovered), only the
  keys mapped to that backend's ring segment should move — must be
  demonstrated/tested, not just assumed (this is the whole point of
  consistent hashing vs naive hashing).

## 5. Health Checks

- Active probing: LB periodically (configurable interval, e.g. every 2s)
  sends a lightweight HTTP request (e.g. `GET /health`) to each backend.
- Failure threshold: N consecutive failed checks marks a backend unhealthy
  (configurable, default e.g. 3) — avoid flapping on a single blip.
- Recovery threshold: M consecutive successful checks marks it healthy
  again (configurable, default e.g. 2).
- Unhealthy backends are excluded from all three strategies' selection
  pools immediately on state change, not just on next request.
- Health check itself must have its own timeout, separate from normal
  request timeouts, so a hung health check doesn't block the checker loop.

## 6. Mock Backend Pool

- Simple HTTP servers (own small app), each configurable via CLI/env:
  - `--port`
  - `--latency-ms` (fixed or jittered, to simulate real variance)
  - `--fail-rate` (0–1, probability of returning 5xx, for health check /
    failure demo)
  - `--unhealthy-after-requests` (optional: go unhealthy after N requests,
    to script a recovery demo)
- A `/health` endpoint reflecting current simulated health state.
- A normal `/` (or similar) endpoint that responds after the configured
  latency, to exercise least-connections meaningfully.

## 7. LB Core

### 7.1 Config
- List of backend `host:port` entries.
- Strategy selection (`round-robin` | `least-connections` |
  `consistent-hashing`).
- Health check interval, thresholds, timeout.
- Listen port for the LB itself.
- Consistent hashing: virtual node count, hash key source.

### 7.2 Request Flow
- LB accepts incoming HTTP request, selects backend per active strategy
  (only from healthy pool), proxies the request, streams response back.
- On backend connection failure mid-request: return `502`, and treat as a
  health check failure signal too (counts toward the unhealthy threshold,
  not just the periodic probe) — this should be explicit in TRD as a
  design decision, not accidental.

### 7.3 Status/Observability Endpoint
- `GET /lb-status` (or similar, on a separate admin port to avoid
  colliding with proxied paths) returning JSON: each backend's current
  health state, request count routed to it, current in-flight count
  (relevant for least-connections), and active strategy.

## 8. Tech Stack

- TypeScript on Node.js. `http`/`net` is fine to use here (this project is
  about LB algorithms and health-check logic, not protocol-from-scratch
  work like BasicsRawHTTP) — use Node's built-in `http` module or a
  minimal framework, whichever is faster to build cleanly; prefer no
  heavy framework dependency.
- CLI/config via a config file (JSON/YAML) or CLI flags — config file
  preferred since backend pool lists get unwieldy as flags.
- Tests: Vitest. Unit tests per strategy (pure selection logic, mockable
  backend health/connection-count state) plus integration tests spinning
  up the LB + a small mock backend pool and asserting routing distribution
  matches the expected algorithm behavior.

## 9. Repo Structure (proposed)

```
loadbalancerx/
├── src/
│   ├── lb/
│   │   ├── server.ts          # main proxy server
│   │   ├── strategies/
│   │   │   ├── roundRobin.ts
│   │   │   ├── leastConnections.ts
│   │   │   └── consistentHashing.ts
│   │   ├── healthChecker.ts
│   │   ├── backendPool.ts     # shared state: health, conn counts, stats
│   │   └── statusServer.ts    # /lb-status admin endpoint
│   ├── mockBackend/
│   │   └── server.ts          # configurable mock backend
│   ├── config.ts
│   └── cli.ts
├── tests/
│   ├── strategies/
│   │   ├── roundRobin.test.ts
│   │   ├── leastConnections.test.ts
│   │   └── consistentHashing.test.ts
│   ├── healthChecker.test.ts
│   └── integration/
│       └── routing.test.ts
├── scripts/
│   └── loadgen.ts              # simple load generator/demo driver
├── prep/                       # gitignored, interview notes
├── README.md
├── PRD.md
├── TRD.md
├── ARCHITECTURE.md
├── CLAUDE.md
├── package.json
├── tsconfig.json
└── .gitignore
```

## 10. Build Order (bottom-up, branch-per-feature)

1. `feat/mock-backend` — configurable mock backend server (latency,
   fail-rate, health endpoint), standalone, no LB yet.
2. `feat/backend-pool-state` — shared state module: backend list, health
   flags, in-flight counts, request counters. Pure logic, no networking.
3. `feat/round-robin` — round robin strategy against pool state, unit
   tested in isolation.
4. `feat/least-connections` — least-connections strategy, with explicit
   tests for increment/decrement correctness including error paths.
5. `feat/consistent-hashing` — hash ring implementation, virtual nodes,
   minimal-remapping test on backend add/remove.
6. `feat/lb-proxy-server` — wire one strategy at a time into a real
   proxying HTTP server.
7. `feat/health-checker` — periodic probing, thresholds, wired to mark
   pool state, confirmed it affects live routing.
8. `feat/status-endpoint` — `/lb-status` admin endpoint.
9. `feat/loadgen-demo` — script to fire N requests and print distribution
   per backend, runnable against each strategy for a clear before/after
   comparison.
10. `feat/docs-polish` — README quickstart, ASCII diagrams (hash ring,
    health check state machine), demo recording.

Each branch: small, mergeable, plain-English commit messages, no AI
attribution, no Conventional Commits prefixes.

## 11. Acceptance Criteria

- Running the LB with 3 mock backends under round robin shows even
  distribution (within rounding) across N requests via `loadgen`.
- Least-connections visibly favors a faster/less-loaded backend when one
  mock backend is configured with higher latency — demonstrable via
  `loadgen` output or `/lb-status` counts.
- Consistent hashing: same key always routes to the same backend while
  pool is stable; removing one backend remaps only that backend's keys,
  verified by a test comparing routing tables before/after removal.
- Killing/degrading a mock backend (high fail-rate) results in it being
  marked unhealthy within (threshold × interval) and excluded from
  routing; recovering it brings it back in within (recovery threshold ×
  interval).
- `/lb-status` accurately reflects live health and per-backend counts.
- Backend connection failure mid-request returns `502` to the client and
  is not silently swallowed.
- All three strategies and the health checker have unit tests; routing
  behavior has at least one integration test per strategy.
- README quickstart runs LB + mock pool + loadgen demo in under 5 minutes
  from a fresh clone.

## 12. Open Questions (resolve before/during TRD)

- Hash key source for consistent hashing: client IP only, or support a
  request header override? Recommend client IP for v1, header as stretch.
- Should health-check failures from live request errors (mid-request
  502s) count toward the unhealthy threshold alongside periodic probe
  failures, or stay fully separate? Recommend combined, but must be an
  explicit TRD decision, not implicit.
- Config file format: JSON or YAML? Recommend JSON for zero extra
  dependency, since this is Node/TS already.

  Project Summary

A configurable load balancer (round robin, least-connections, consistent
hashing) sitting in front of a mock backend pool, with active health checks.
Portfolio project demonstrating LB algorithms and failure handling. See
req.md, PRD.md, TRD.md, ARCHITECTURE.md for full detail. This file is
about how to work, not what to build.

Language / Stack

TypeScript on Node.js. Node's built-in http/net modules are fine here
(unlike BasicsRawHTTP, this project is about LB algorithms and health-check
logic, not protocol-from-scratch work) — avoid heavy framework dependencies,
keep it lean. Default to TypeScript/Node.js or plain JS for all code unless
explicitly told otherwise.

Build Order (bottom-up, branch-per-feature)

Follow the order in req.md §10. Strategy logic must be built and unit
tested as pure functions against shared pool state before wiring into a
real proxying server — don't build the proxy first and bolt algorithms on
after.


mock-backend
backend-pool-state
round-robin
least-connections
consistent-hashing
lb-proxy-server
health-checker
status-endpoint
loadgen-demo
docs-polish


Git Conventions


Branch per feature: feat/<name> matching the build order above.
Commit messages: plain English, human-sounding. No AI attribution
(no "Generated with Claude", no co-author tags). No Conventional Commits
prefixes (feat:, fix: etc) — just describe what changed.

Good: fix least-connections count leaking on backend timeout
Bad: fix: resolve connection count decrement bug on timeout



Small, focused commits over large dumps.


Folder Rules


prep/ is gitignored — interview notes, scratch notes on hash ring
math, anything not meant for the public repo. Create it locally, never
commit it.
backendPool.ts is the single source of truth for backend health and
in-flight counts — strategies read from it, the health checker writes to
it, nothing else mutates state directly. Don't let strategy files keep
their own parallel state.


Code Style


Each strategy is a pure selection function where possible: given current
pool state, return the chosen backend. Keep them testable without
spinning up real sockets.
Least-connections: increment/decrement must be symmetric and tested
explicitly for the error/timeout path, not just the happy path — this is
the easiest place for a silent bug to hide.
Consistent hashing: virtual nodes and ring lookup logic should be
isolated enough to unit test minimal-remapping behavior directly (build
ring, remove a backend, diff the key→backend mapping) rather than only
testing it via end-to-end request routing.
Health checker timeout must be independent from normal proxied-request
timeouts — don't reuse the same timeout config for both.

  also .claude folder should not be psuhd to github
