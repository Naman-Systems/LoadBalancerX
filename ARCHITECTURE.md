# Architecture — LoadBalancerX

## Components

```
                    ┌──────────────────────────────────────────────┐
                    │                  cli.ts                       │
                    │   loads config, wires everything together     │
                    └───────────────────┬──────────────────────────┘
                                        │
        ┌───────────────┬───────────────┼───────────────┬───────────────┐
        ▼               ▼               ▼               ▼               ▼
  ┌───────────┐  ┌─────────────┐  ┌───────────┐  ┌──────────────┐ ┌───────────┐
  │ProxyServer│  │HealthChecker│  │  Router   │  │ StatusServer │ │BackendPool│
  │           │  │             │  │           │  │              │ │           │
  │ proxies   │  │ probes      │  │ picks the │  │ /lb-status   │ │ the state │
  │ requests  │  │ /health     │  │ strategy  │  │ JSON view    │ │ everyone  │
  └─────┬─────┘  └──────┬──────┘  └─────┬─────┘  └──────┬───────┘ └─────▲─────┘
        │               │               │               │               │
        │ reads pool,   │ writes health │ reads pool    │ reads pool    │
        │ writes counts │ via tracker   │               │               │
        └───────────────┴───────────────┴───────────────┴───────────────┘
                                    │
                             ┌──────┴───────┐
                             │ HealthTracker│  up/down state machine,
                             │              │  shared by checker + proxy
                             └──────────────┘
```

`BackendPool` is the single source of truth. Everything reads from it;
`HealthTracker` and the proxy are the only writers of health / count state.

## Request flow (proxy path)

1. A request arrives on the proxy port.
2. `Router.select` is handed the full backend list and each strategy filters
   for health itself. For consistent hashing it also derives the request's
   hash key.
3. If no backend is healthy, respond `503`.
4. Otherwise bump the backend's request count, then run the proxy inside
   `BackendPool.trackInFlight` so the in-flight count is incremented before
   and decremented after — even on error.
5. Open an upstream request to the chosen backend, stream the client request
   in, stream the response back out.
6. On a completed response, record a health success for the backend.
7. On a connection error or timeout, respond `502` and record a health
   failure (which can trip the unhealthy threshold — see below).

## Health check state machine

Each backend is either up or down. Transitions are driven by consecutive
results, from both the periodic probe and live request outcomes, funnelled
through `HealthTracker`:

```
                     failure (probe or live 502)
                     consecutiveFailures += 1
                  ┌───────────────────────────────┐
                  │                               │
                  ▼                               │
            ┌──────────┐   failures >=       ┌──────────┐
            │          │   failureThreshold  │          │
            │    UP    │────────────────────▶│   DOWN   │
            │ (routed) │                     │(skipped) │
            │          │◀────────────────────│          │
            └──────────┘   successes >=      └──────────┘
                  │        recoveryThreshold      ▲
                  │                               │
                  └───────────────────────────────┘
                     success resets failure count
                     (and vice versa)

  A success zeroes the failure counter and a failure zeroes the success
  counter, so only *consecutive* results count. One blip never flips state.
```

While UP, the backend is in every strategy's selection pool. The moment it
goes DOWN it is excluded — each strategy is handed the full backend list and
filters out the unhealthy ones itself, so the change takes effect on the very
next request, not on some later refresh. Round robin in particular needs the
whole list to keep its cursor stable while skipping the backends that are
down.

## Consistent hash ring

Each backend is placed at `virtualNodes` points around a 32-bit ring (the
points come from hashing `backendId#0`, `backendId#1`, …). Virtual nodes
smooth out the distribution so one backend doesn't own a huge contiguous arc.

A request key is hashed to a point on the ring and walks clockwise to the
first backend point it hits.

```
                     0 / 2^32
                        │
            k2 ●        │        ○ B-vnode
                 ╲      │      ╱
        A-vnode ○  ╲    │    ╱  ○ C-vnode
                    ╲   │   ╱
      key k1 ───▶    ╲  │  ╱
        walks         ╲ │ ╱
        clockwise      ╲│╱
        to next  ───────●───────  ○ A-vnode
        backend        ╱│╲
        point         ╱ │ ╲
                     ╱  │  ╲
            C-vnode ○   │   ○ B-vnode
                        │
              ● = request key   ○ = backend virtual node
```

When a backend goes unhealthy the ring is rebuilt from the remaining healthy
set. Only keys that fell on the removed backend's arcs move; every other key
still walks clockwise to the same backend it did before. The strategy detects
a change by comparing a signature of the healthy set, so the ring is rebuilt
only when membership actually changes, not on every request.

## Why the state is centralised

If each strategy kept its own idea of which backends were healthy, or its own
in-flight counters, the health checker and the strategy could drift out of
sync — the checker marks a backend down but a strategy keeps sending it
traffic, or a leaked in-flight count quietly biases least connections. Keeping
one `BackendPool` and one `HealthTracker`, with narrow mutation methods,
removes that whole class of bug.
