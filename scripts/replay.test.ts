import { describe, expect, test, vi } from "vitest";
import type { CaptureLine } from "../src/server/recorder/feed";
import { startReplayServer } from "./replay";

const lines: CaptureLine[] = [0, 10, 20].map((t) => ({ t, raw: JSON.stringify({ Event: "UpdateState", Data: { t } }) }));

describe("startReplayServer gate", () => {
  test("holds every frame until the gate opens, then sends them all", async () => {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const replay = startReplayServer({ lines, speed: Infinity, gate });
    const got: string[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${String(replay.port)}`);
    ws.onmessage = (e) => got.push(String(e.data));
    try {
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => { resolve(); };
        ws.onerror = () => { reject(new Error("replay socket failed")); };
      });
      await Bun.sleep(200);
      expect(got).toEqual([]);
      open();
      await replay.done;
      // `done` means sent, not received.
      await vi.waitFor(() => {
        expect(got).toEqual(lines.map((l) => l.raw));
      });
    } finally {
      ws.close();
      await replay.stop();
    }
  });
});
