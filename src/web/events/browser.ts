// The hub wired to the browser's EventSource and timers, for the worker and the in-page fallback alike.
import { createHub } from "./hub";

export const browserHub = () =>
  createHub({
    openSource: () => new EventSource("/api/events"),
    setTimer: (fn, ms) => { setTimeout(fn, ms); },
    warn: (message, detail) => { console.warn(message, detail); },
  });
