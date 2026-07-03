import http from "node:http";

interface LoadgenOptions {
  url: string;
  requests: number;
  concurrency: number;
  sessionKeys: number;
}

function parseArgs(argv: string[]): LoadgenOptions {
  const options: LoadgenOptions = {
    url: "http://localhost:8080/",
    requests: 300,
    concurrency: 20,
    sessionKeys: 0,
  };

  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    switch (key) {
      case "url":
        options.url = value;
        break;
      case "requests":
        options.requests = Number(value);
        break;
      case "concurrency":
        options.concurrency = Number(value);
        break;
      case "session-keys":
        options.sessionKeys = Number(value);
        break;
    }
  }

  return options;
}

interface Outcome {
  backendPort: number | null;
  status: number;
}

function fireOne(url: string, sessionKey: string | null): Promise<Outcome> {
  return new Promise((resolve) => {
    const headers: Record<string, string> = {};
    if (sessionKey !== null) {
      headers["X-Session-Key"] = sessionKey;
    }

    const req = http.request(url, { method: "GET", headers }, (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        let backendPort: number | null = null;
        try {
          backendPort = JSON.parse(raw).port ?? null;
        } catch {
          backendPort = null;
        }
        resolve({ backendPort, status: res.statusCode ?? 0 });
      });
    });
    req.on("error", () => resolve({ backendPort: null, status: 0 }));
    req.end();
  });
}

async function run(options: LoadgenOptions): Promise<void> {
  const perBackend = new Map<string, number>();
  const perStatus = new Map<number, number>();
  let sent = 0;

  const worker = async (workerId: number): Promise<void> => {
    while (true) {
      const index = sent;
      if (index >= options.requests) {
        return;
      }
      sent += 1;

      const sessionKey =
        options.sessionKeys > 0 ? `session-${index % options.sessionKeys}` : null;
      const outcome = await fireOne(options.url, sessionKey);

      const backendLabel =
        outcome.backendPort !== null ? `backend:${outcome.backendPort}` : "no-backend";
      perBackend.set(backendLabel, (perBackend.get(backendLabel) ?? 0) + 1);
      perStatus.set(outcome.status, (perStatus.get(outcome.status) ?? 0) + 1);
    }
  };

  const started = Date.now();
  await Promise.all(
    Array.from({ length: options.concurrency }, (_, i) => worker(i)),
  );
  const elapsedMs = Date.now() - started;

  console.log(`\nsent ${options.requests} requests to ${options.url}`);
  console.log(`concurrency ${options.concurrency}, took ${elapsedMs}ms\n`);

  console.log("distribution by backend:");
  for (const [label, count] of [...perBackend.entries()].sort()) {
    const pct = ((count / options.requests) * 100).toFixed(1);
    const bar = "#".repeat(Math.round(count / options.requests * 40));
    console.log(`  ${label.padEnd(16)} ${String(count).padStart(5)}  ${pct.padStart(5)}%  ${bar}`);
  }

  console.log("\nstatus codes:");
  for (const [status, count] of [...perStatus.entries()].sort()) {
    const label = status === 0 ? "error/no-response" : String(status);
    console.log(`  ${label.padEnd(16)} ${String(count).padStart(5)}`);
  }
}

run(parseArgs(process.argv.slice(2))).catch((err) => {
  console.error(err);
  process.exit(1);
});
