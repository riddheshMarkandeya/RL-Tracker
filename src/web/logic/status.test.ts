import { describe, expect, test } from "vitest";
import type { Status } from "../../shared/schemas/responses";
import { statusLabel } from "./status";

const live = (over: Partial<Status> = {}): Status => ({ connection: "waiting", statsApiOff: false, configProblems: [], ...over });

describe("statusLabel", () => {
  test("names each connection state the way the map does", () => {
    expect(statusLabel({ link: "open", status: live(), stopped: false })).toEqual({ label: "waiting for game", tone: "busy" });
    expect(statusLabel({ link: "open", status: live({ connection: "connected" }), stopped: false })).toEqual({ label: "connected", tone: "ok" });
    expect(statusLabel({ link: "open", status: live({ connection: "recording" }), stopped: false })).toEqual({ label: "recording match", tone: "ok" });
  });

  test("Stats API off outranks the connection; a setup problem explains only the waiting state", () => {
    expect(statusLabel({ link: "open", status: live({ connection: "connected", statsApiOff: true, configProblems: ["no_ini"] }), stopped: false }))
      .toEqual({ label: "Stats API off", tone: "warn" });
    expect(statusLabel({ link: "open", status: live({ configProblems: ["send_rate_off"] }), stopped: false })).toEqual({ label: "setup problem", tone: "warn" });
    // Data is flowing, so the connection is the news; the problem stays for Settings to show.
    expect(statusLabel({ link: "open", status: live({ connection: "recording", configProblems: ["web_port_mismatch"] }), stopped: false }))
      .toEqual({ label: "recording match", tone: "ok" });
  });

  test("before the first status, the stream is still connecting", () => {
    expect(statusLabel({ link: "connecting", status: undefined, stopped: false })).toEqual({ label: "connecting…", tone: "busy" });
    expect(statusLabel({ link: "open", status: undefined, stopped: false })).toEqual({ label: "connecting…", tone: "busy" });
  });

  test("a dropped stream says the tracker isn't running, whatever the last status was", () => {
    expect(statusLabel({ link: "down", status: live({ connection: "recording" }), stopped: false })).toEqual({ label: "tracker not running", tone: "off" });
  });

  test("after Quit in this tab, stopped outranks everything", () => {
    expect(statusLabel({ link: "down", status: live(), stopped: true })).toEqual({ label: "tracker stopped", tone: "off" });
    expect(statusLabel({ link: "open", status: live({ connection: "connected" }), stopped: true })).toEqual({ label: "tracker stopped", tone: "off" });
  });
});
