// A tab's connection to the events hub: the SharedWorker when the browser has one, else a hub in
// this page (one stream per tab, the old cost, but still working).
import { browserHub } from "./browser";
import type { HubMessage } from "./hub";

type Listener = (message: HubMessage) => void;
const listeners = new Set<Listener>();
let started = false;

const deliver = (event: MessageEvent<HubMessage>) => {
  for (const listener of listeners) listener(event.data);
};

function startInPage(): void {
  const channel = new MessageChannel();
  channel.port2.onmessage = deliver;
  browserHub().connect(channel.port1);
  console.info("[rlt] events/path", { via: "in_page" });
}

function start(): void {
  if (typeof SharedWorker === "undefined") {
    startInPage();
    return;
  }
  const worker = new SharedWorker(new URL("./worker.ts", import.meta.url), { type: "module", name: "rlt-events" });
  worker.port.onmessage = deliver;
  // A worker that fails to load would leave the header on "connecting…" for good. Fall back once:
  // a later error must not start a second stream.
  worker.addEventListener(
    "error",
    (event) => {
      console.warn("[rlt] events/worker_failed", { message: event.message });
      worker.port.close();
      startInPage();
    },
    { once: true },
  );
  console.info("[rlt] events/path", { via: "shared_worker" });
}

/**
 * Starts the connection on first use; the returned function removes the listener. There is no
 * replay for a listener added later: the hub replays to ports, and today the one listener
 * (useLiveEvents) keeps what it hears in the module-level live store.
 */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (!started) {
    started = true;
    start();
  }
  return () => listeners.delete(listener);
}
