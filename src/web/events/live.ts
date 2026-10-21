// The header's live state: the stream link, the latest status, and whether this tab sent Quit. It
// is pushed, never fetched, so it lives in a small store rather than the query cache.
import { useSyncExternalStore } from "react";
import type { Status } from "../../shared/schemas/responses";
import type { Link } from "../logic/status";

export interface LiveState {
  link: Link;
  status: Status | undefined;
  stopped: boolean;
}

let state: LiveState = { link: "connecting", status: undefined, stopped: false };
const listeners = new Set<() => void>();

export const live = {
  get: (): LiveState => state,
  set: (patch: Partial<LiveState>): void => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  },
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useLive(): LiveState {
  return useSyncExternalStore(live.subscribe, live.get);
}
