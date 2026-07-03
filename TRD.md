# Technical Requirements — LoadBalancerX

## Stack

- TypeScript on Node.js 20+.
- Node's built-in `http` module for both the proxy and the mock backends —
  no web framework. This project is about the balancing and health-check
  logic, so a framework would only add noise.
- Config is a JSON file (`config.json`). JSON keeps it dependency-free and
  the backend list is easier to manage in a file than as CLI flags.
- Tests with Vitest, run through `tsx` so there's no build step for
  development.

## Decisions worth calling out

### Single source of truth for state
`BackendPool` is the only place backend health, in-flight counts, and request
counts live. Strategies read from it, the health checker and proxy write to
it through narrow methods. Strategies never keep their own parallel state, so
there is no chance of two components disagreeing about whether a backend is
up.

### Live request failures count toward the health threshold
A backend connection failure mid-proxy returns 502 **and** records a failure
against that backend. That failure shares the same consecutive-failure
counter and threshold the periodic probe uses. So a backend that is failing
real traffic can be marked down between probes, not only on the next probe.

This is deliberate, not accidental. The alternative — keeping probe failures
and live failures fully separate — was rejected because it means the LB keeps
sending traffic to a backend it already knows is refusing connections until
the next scheduled probe. Both signals funnel through one `HealthTracker` so
the threshold logic exists in exactly one place.

A successfully completed proxied response resets the failure counter (records
a success), symmetric with the failure path. An application-level 5xx that
still came back over a healthy connection is not treated as a connection
failure — only actual connection errors and timeouts are.

### Health-check timeout is separate from the request timeout
`healthCheck.timeoutMs` and `requestTimeoutMs` are independent config values.
A slow but legitimate proxied request should not look like an unhealthy
backend, and a hung health probe should not block for as long as a normal
request is allowed to run. Reusing one timeout for both would couple two
unrelated concerns.

### In-flight counting is symmetric by construction
Least connections is only correct if every increment has a matching
decrement, including on error and timeout paths — a leak there silently skews
every later decision. Rather than hand-writing `try/finally` at each call
site, all proxying goes through `BackendPool.trackInFlight`, which increments
before and decrements in a `finally`. There is one code path, and it is unit
tested against both success and thrown-error cases.

### Consistent hashing rebuilds only on health changes
The hash ring is built from the healthy backend set. The strategy tracks a
signature of that set and only rebuilds the ring when it changes. So routing
is stable request to request, and removing an unhealthy backend remaps only
that backend's keys — the property that makes consistent hashing worth using
over a plain modulo. This is tested directly on the ring by diffing the
key→backend mapping before and after a removal, not just end to end.

### Hash key source
Default is client IP. A header source (`X-Session-Key` by default) is
supported and falls back to client IP when the header is absent. Client IP is
the sensible v1 default; the header override makes session stickiness easy to
demonstrate.

## Ports

- Proxy listens on `listenPort`.
- `/lb-status` listens on a separate `adminPort` so the admin endpoint can
  never collide with a proxied request path.

## Testing approach

- **Unit** — each strategy's selection is a pure function over pool state and
  is tested without sockets. The health checker takes an injectable probe
  function so thresholds can be tested deterministically.
- **Integration** — real mock backends on ephemeral ports behind a real LB,
  asserting the actual routing distribution and the 502 / health-removal
  behaviour.

## Out of scope (may be promoted later)

- Retries and circuit breaking.
- Weighted backends.
- Passive health checking based purely on live traffic (currently only the
  502 signal feeds in; there is no ejection-on-error-rate logic).
