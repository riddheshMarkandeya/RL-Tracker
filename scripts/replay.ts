// A fake Stats API: serves a capture or fixture over WebSocket with its recorded gaps, so the
// tracker can be run against a real stream without the game.
// `bun run scripts/replay.ts <file> [--speed N] [--port P]`, then start the tracker with
// STATS_API_URL=ws://127.0.0.1:<P>.
import { readFileSync } from "node:fs";
import { readCapture, type CaptureLine } from "../src/server/recorder/feed";
import { STATS_API_PORT } from "../src/shared/constants";

export interface ReplayOptions {
  lines: readonly CaptureLine[];
  /** Recorded gaps are divided by this; Infinity sends everything at once. */
  speed?: number;
  /** 0 picks a free port. */
  port?: number;
  /** When given, a client is accepted at once (it sees the game as running) but gets no frames until this resolves. */
  gate?: Promise<void>;
}

/** Streams `lines` to each client that connects, then leaves the socket open. */
export function startReplayServer({ lines, speed = 1, port = 0, gate }: ReplayOptions) {
  let finished: () => void = () => undefined;
  const done = new Promise<void>((resolve) => (finished = resolve));
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch(req, srv) {
      return srv.upgrade(req) ? undefined : new Response("Stats API replay: connect with a WebSocket", { status: 426 });
    },
    websocket: {
      // The socket is left open after the last frame, and a gated one is silent until released;
      // Bun's default idle timeout would close either.
      idleTimeout: 0,
      async open(ws) {
        await gate;
        let owed = 0;
        let prevT: number | null = null;
        for (const line of lines) {
          owed += prevT === null ? 0 : (line.t - prevT) / speed;
          prevT = line.t;
          // Timers are coarse; small gaps are saved up and slept together.
          if (owed >= 4) {
            await Bun.sleep(owed);
            owed = 0;
          }
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(line.raw);
        }
        finished();
      },
      message() {
        // The game ignores what clients send; so does the replay.
      },
    },
  });
  // Only a unix-socket server has no port.
  if (server.port === undefined) throw new Error("replay server has no port");
  return { port: server.port, done, stop: () => server.stop(true) };
}

function parseArgs(argv: readonly string[]): { file: string; speed: number; port: number } {
  const [file, ...rest] = argv;
  if (!file) throw new Error("usage: bun run scripts/replay.ts <file> [--speed N] [--port P]");
  const flag = (name: string, fallback: number) => {
    const i = rest.indexOf(name);
    if (i === -1) return fallback;
    const value = Number(rest[i + 1]);
    if (!(value > 0)) throw new Error(`${name} needs a positive number, got ${String(rest[i + 1])}`);
    return value;
  };
  return { file, speed: flag("--speed", 1), port: flag("--port", STATS_API_PORT) };
}

if (import.meta.main) {
  const { file, speed, port } = parseArgs(process.argv.slice(2));
  const lines = readCapture(readFileSync(file, "utf8"));
  const replay = startReplayServer({ lines, speed, port });
  console.log(`replaying ${String(lines.length)} frames from ${file} at ${String(speed)}x on ws://127.0.0.1:${String(replay.port)}`);
  void replay.done.then(() => {
    console.log("replay finished; Ctrl+C to stop");
  });
}
