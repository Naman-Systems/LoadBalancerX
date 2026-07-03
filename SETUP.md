# Setup & Deployment

This covers installing, configuring, running, and deploying LoadBalancerX.
For a feature walkthrough and the demo, see [README.md](README.md).

## Requirements

- Node.js 20 or newer (`node --version`).
- npm (ships with Node).

No database, no external services. All state is in memory.

## Install

```bash
git clone <your-repo-url> loadbalancerx
cd loadbalancerx
npm install
```

## Configure

Edit `config.json`. Every field is documented in the README, the essentials:

- `listenPort` — the port clients send traffic to.
- `adminPort` — the port `/lb-status` is served on (kept separate from proxy traffic).
- `strategy` — `round-robin`, `least-connections`, or `consistent-hashing`.
- `backends` — the `host:port` list to balance across.
- `healthCheck` — probe path, interval, timeout, and the up/down thresholds.

The backend list is static config; there is no dynamic discovery.

## Run in development

Development runs straight from the TypeScript sources via `tsx` — no build step.

```bash
npm run lb                          # uses config.json
npm run lb -- --config=other.json   # point at a different config
```

## Run in production

Compile to plain JavaScript, then run the compiled entry point with Node.

```bash
npm run build          # emits dist/
node dist/src/cli.js   # add --config=... to override the default
```

Put this behind a process manager so it restarts on crash and on boot. A
minimal systemd unit:

```ini
[Unit]
Description=LoadBalancerX
After=network.target

[Service]
WorkingDirectory=/opt/loadbalancerx
ExecStart=/usr/bin/node dist/src/cli.js --config=/opt/loadbalancerx/config.json
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

## Verify it's up

With the LB and its backends running:

```bash
curl http://localhost:8081/lb-status
```

You should get JSON listing the active strategy and each backend's health,
in-flight count, and total requests. A quick end-to-end check:

```bash
curl http://localhost:8080/
```

## Tests

```bash
npm test
```

Runs the unit tests (strategy selection and health thresholds) and the
integration tests (real mock backends behind a real LB).

## Ports & firewall

- `listenPort` (default 8080) must be reachable by clients.
- `adminPort` (default 8081) exposes `/lb-status` — keep it on an internal
  interface or behind firewall rules; it is not authenticated.
- Each backend's port must be reachable from the LB host.

## Troubleshooting

- **`503 no healthy backends available`** — every backend is down or
  unreachable. Check `/lb-status` and confirm each backend answers its
  health path directly.
- **`502 backend connection failed`** — the chosen backend refused the
  connection or timed out mid-request. That failure also counts toward the
  backend's unhealthy threshold.
- **A backend never recovers** — it must pass `recoveryThreshold` consecutive
  probes; confirm its `/health` returns 2xx again.
- **Port already in use** — another process holds `listenPort` or `adminPort`;
  change them in `config.json` or free the port.
