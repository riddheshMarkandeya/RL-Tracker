// The tracker's HTTP server on loopback. Binding its port first is the single-instance guard; for
// now it only serves the shutdown endpoint, and the dashboard (WP5a) adds its routes here.
import { DASHBOARD_HOST } from "../shared/constants";
import type { Logger } from "./log";

export const SHUTDOWN_HEADER = "X-RLTracker-Shutdown";

export class PortTakenError extends Error {
  constructor(readonly port: number, options?: ErrorOptions) {
    super(`port ${String(port)} is already in use`, options);
    this.name = "PortTakenError";
  }
}

export interface HostOptions {
  port: number;
  /** Called after the 202 is sent, so the answer goes out before teardown. */
  onShutdown: () => void;
  logger: Logger;
}

export interface Host {
  port: number;
  stop(): void;
}

/** Binds the port (throws PortTakenError if another process holds it) and starts serving. */
export function startHost({ port, onShutdown, logger }: HostOptions): Host {
  // Filled once bound: port 0 (tests) only knows its real port then.
  const allowedHosts = new Set<string>();

  function handle(req: Request): Response {
    // A page on another site can resolve its own name to 127.0.0.1 (DNS rebinding) and then talk
    // to us as same-origin, custom headers included; its Host header still names its own site.
    const host = req.headers.get("host") ?? "";
    if (!allowedHosts.has(host)) {
      logger.warn("host", "bad_host", { host, path: new URL(req.url).pathname });
      return new Response("Forbidden", { status: 403 });
    }
    const { pathname } = new URL(req.url);
    if (req.method === "POST" && pathname === "/api/shutdown") {
      // A cross-site form or fetch can't add a custom header without a CORS preflight, which is never answered.
      if (req.headers.get(SHUTDOWN_HEADER) !== "1") {
        logger.warn("host", "shutdown_rejected", { origin: req.headers.get("origin") });
        return new Response("Forbidden", { status: 403 });
      }
      logger.info("host", "shutdown_requested");
      setTimeout(onShutdown, 0);
      return new Response("Stopping", { status: 202 });
    }
    return new Response("Not found", { status: 404 });
  }

  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({ hostname: DASHBOARD_HOST, port, fetch: handle });
  } catch (err) {
    if ((err as { code?: unknown }).code === "EADDRINUSE") throw new PortTakenError(port, { cause: err });
    throw err;
  }
  // Only a unix-socket server has no port.
  const bound = server.port ?? port;
  allowedHosts.add(`${DASHBOARD_HOST}:${String(bound)}`).add(`localhost:${String(bound)}`);
  logger.info("host", "listening", { port: bound });
  return {
    port: bound,
    stop: () => {
      void server.stop(true);
    },
  };
}
