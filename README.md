# LoadBalancerX

A small configurable HTTP load balancer that sits in front of a pool of
backend servers and spreads requests across them using one of three
strategies: round robin, least connections, or consistent hashing. It runs
active health checks so unhealthy backends get pulled out of rotation and
added back once they recover.

This is a portfolio project to demonstrate the core load-balancing
algorithms and failure handling, not a production load balancer.

```
                         ┌──────────────────────────┐
   client requests  ───▶ │        LoadBalancerX      │
                         │                            │
                         │  pick a healthy backend    │
                         │  per the active strategy    │
                         └───────────┬────────────────┘
                                     │ proxy + stream response back
                 ┌───────────────────┼───────────────────┐
                 ▼                   ▼                   ▼
          ┌────────────┐     ┌────────────┐     ┌────────────┐
          │ backend A  │     │ backend B  │     │ backend C  │
          │  /health   │     │  /health   │     │  /health   │
          └────────────┘     └────────────┘     └────────────┘
                 ▲                   ▲                   ▲
                 └──── periodic health probes ──────────┘
```

## Quickstart

You need Node.js 20+.

```bash
npm install
```

Open four terminals (or background the first three). Start three mock
backends:

```bash
npm run mock-backend -- --port=9001 --latency-ms=10
npm run mock-backend -- --port=9002 --latency-ms=10
npm run mock-backend -- --port=9003 --latency-ms=200   # deliberately slow
```

Start the load balancer (uses `config.json` by default):

```bash
npm run lb
```

Fire some traffic through it and watch the distribution:

```bash
npm run loadgen -- --url=http://localhost:8080/ --requests=300
```

Check live state at any time:

```bash
curl http://localhost:8081/lb-status
```

## Trying each strategy

Edit the `strategy` field in `config.json` (or point the LB at a different
file with `npm run lb -- --config=other.json`) and restart it.

- **round-robin** — even split across all healthy backends.
- **least-connections** — favours whichever backend has the fewest requests
  in flight. With the slow backend above, you will see it receive far fewer
  requests than the two fast ones.
- **consistent-hashing** — routes by a key (client IP, or the
  `X-Session-Key` header if you set `hashKeySource` to `header`). The same
  key always lands on the same backend while the pool is stable.

To see consistent hashing stick sessions:

```bash
npm run loadgen -- --url=http://localhost:8080/ --requests=300 --session-keys=10
```

## Watching health checks

Start a backend that goes unhealthy after it serves one request:

```bash
npm run mock-backend -- --port=9002 --unhealthy-after-requests=0
```

Send a request through the LB, then poll `/lb-status`. Within
`failureThreshold × intervalMs` the backend flips to `healthy: false` and
stops receiving traffic. Restart it and it comes back within
`recoveryThreshold × intervalMs`.

## Config

`config.json`:

```jsonc
{
  "listenPort": 8080,           // proxy port
  "adminPort": 8081,            // /lb-status port (kept separate)
  "strategy": "round-robin",    // round-robin | least-connections | consistent-hashing
  "backends": ["localhost:9001", "localhost:9002", "localhost:9003"],
  "requestTimeoutMs": 30000,    // proxied request timeout
  "healthCheck": {
    "path": "/health",
    "intervalMs": 2000,
    "timeoutMs": 1000,          // separate from requestTimeoutMs on purpose
    "failureThreshold": 3,      // consecutive fails before marking down
    "recoveryThreshold": 2      // consecutive passes before marking up
  },
  "consistentHashing": {
    "virtualNodes": 100,
    "hashKeySource": "client-ip", // or "header"
    "headerName": "x-session-key"
  }
}
```

## Mock backend flags

| Flag | Meaning |
|------|---------|
| `--port` | port to listen on |
| `--latency-ms` | fixed delay before responding |
| `--fail-rate` | probability (0–1) of returning a 500 |
| `--unhealthy-after-requests` | flip `/health` to unhealthy after N requests |

## Tests

```bash
npm test
```

Unit tests cover each strategy's selection logic and the health-check
thresholds. Integration tests spin up real mock backends behind the LB and
assert the routing behaviour end to end.

## Docs

- [SETUP.md](SETUP.md) — install, configure, run, and deploy.
- [PRD.md](PRD.md) — what it does and why.
- [TRD.md](TRD.md) — technical decisions, including the ones worth calling out.
- [ARCHITECTURE.md](ARCHITECTURE.md) — how the pieces fit together, with diagrams.
