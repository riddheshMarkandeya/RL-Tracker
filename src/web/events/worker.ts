// The SharedWorker every tab connects to: it owns the one events stream.
import { browserHub } from "./browser";

declare const self: SharedWorkerGlobalScope;

const hub = browserHub();

self.addEventListener("connect", (event) => {
  const port = event.ports[0];
  if (port) hub.connect(port);
});
