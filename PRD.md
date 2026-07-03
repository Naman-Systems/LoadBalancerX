# Product Requirements — LoadBalancerX

## What this is

A configurable HTTP load balancer in front of a pool of backend servers. It
distributes requests using a selectable strategy and keeps the pool healthy
by probing backends and routing around the ones that are down.

It is a portfolio project. The goal is to show the core algorithms and the
failure handling working correctly and observably, not to compete with nginx
or Envoy.

## Who it's for

Me, as an interview/portfolio piece, and anyone reading the code who wants a
compact, readable example of the three classic balancing strategies plus
active health checking.

## Goals

- One LB process, a configurable backend pool, and a strategy that is
  swappable via config rather than hardcoded.
- All three strategies implemented correctly:
  - round robin
  - least connections
  - consistent hashing
- Active health checks that mark backends up/down and affect routing in real
  time.
- A mock backend pool that can simulate latency, failures, and going
  unhealthy, so the behaviour above is demonstrable.
- A status endpoint exposing live health and per-backend counts.
- A load-generation script that makes the distribution differences visible.

## Non-goals

- No TLS termination.
- No dynamic backend discovery — the backend list is static config.
- No persistence or metrics database — counters are in memory only.
- No HTTP/2, no circuit breakers, no retry policies.

## User-facing behaviour

### Round robin
Requests cycle through the healthy backends in order and wrap around.
Unhealthy backends are skipped without breaking the rotation for the rest.

### Least connections
Each request goes to the healthy backend with the fewest in-flight requests,
ties broken by config order. This visibly favours faster / less-loaded
backends when one is slower than the others.

### Consistent hashing
Requests are hashed by a key (client IP, or the `X-Session-Key` header when
configured) onto a ring of backends. The same key routes to the same backend
while the pool is stable. When a backend leaves or rejoins, only the keys
that belonged to it move.

### Health checks
The LB probes each backend's `/health` on an interval. N consecutive
failures mark a backend down; M consecutive successes bring it back. A blip
does not cause flapping. A backend that fails a live request (connection
error mid-proxy) also counts toward the failure threshold, not just the
periodic probe.

### Observability
`GET /lb-status` on the admin port returns JSON with the active strategy and,
per backend: health state, in-flight count, and total requests routed.

## Acceptance criteria

- Round robin across 3 backends produces an even split over N requests.
- Least connections sends fewer requests to a deliberately slow backend.
- Consistent hashing keeps a key on one backend while stable, and remaps only
  the affected keys when a backend is removed (covered by a unit test that
  diffs the mapping).
- A degraded backend is marked unhealthy within `failureThreshold × interval`
  and excluded from routing; it recovers within
  `recoveryThreshold × interval`.
- `/lb-status` reflects live health and counts.
- A backend connection failure mid-request returns 502 and is not silently
  swallowed.
- Every strategy and the health checker have unit tests; routing has at least
  one integration test per strategy.
- The README quickstart runs the whole demo in a few minutes from a fresh
  clone.
