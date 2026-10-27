// Calls to the tracker's API. Responses are parsed with the same Zod schemas the server is typed by.
import type { z } from "zod";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /**
     * The server's `{error}` code, or: `http` (an error with no code), `network` (no answer; status 0),
     * `bad_body` (a 2xx that isn't JSON), `bad_shape` (JSON the schema rejects).
     */
    readonly code: string,
  ) {
    super(`API ${String(status)} ${code}`);
  }
}

export interface ApiDeps {
  fetchFn: (input: string, init?: RequestInit) => Promise<Response>;
  warn: (message: string, detail?: unknown) => void;
}

// A request that hangs would leave a query loading, or a confirm on "sending", for good.
const TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;

// Bound at call time, so a test or the page can swap fetch out.
const browser: ApiDeps = { fetchFn: (input, init) => fetch(input, init), warn: (message, detail) => { console.warn(message, detail); } };

async function errorCode(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") return body.error;
  } catch {
    // Not every error is JSON (the write check answers plain "Forbidden").
  }
  return "http";
}

function noAnswer(path: string, deps: ApiDeps, error: unknown): ApiError {
  deps.warn("[rlt] api/network", { path, error: String(error) });
  return new ApiError(0, "network");
}

/** fetch with the timeout; no answer or a non-2xx becomes a logged ApiError. */
async function request(path: string, deps: ApiDeps, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await deps.fetchFn(path, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    // fetch rejects only when there's no HTTP answer at all: the tracker is down, or the timeout hit.
    throw noAnswer(path, deps, error);
  }
  if (res.ok) return res;
  deps.warn("[rlt] api/failed", { path, status: res.status });
  throw new ApiError(res.status, await errorCode(res));
}

/** A 2xx body parsed with the schema; one that isn't JSON or doesn't fit is a logged ApiError. */
async function parseBody<S extends z.ZodType>(res: Response, path: string, schema: S, deps: ApiDeps): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await res.json();
  } catch (error) {
    // The timeout also covers reading the body.
    if (error instanceof DOMException && error.name === "TimeoutError") throw noAnswer(path, deps, error);
    // A 2xx that isn't JSON: e.g. a dev server answering an unknown path with index.html.
    deps.warn("[rlt] api/bad_body", { path, status: res.status });
    throw new ApiError(res.status, "bad_body");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    deps.warn("[rlt] api/bad_shape", { path, issues: parsed.error.issues.map((i) => i.path.join(".")) });
    throw new ApiError(res.status, "bad_shape");
  }
  return parsed.data;
}

export async function getJson<S extends z.ZodType>(path: string, schema: S, deps: ApiDeps = browser): Promise<z.infer<S>> {
  return parseBody(await request(path, deps), path, schema, deps);
}

export async function post(path: string, headers: Record<string, string>, deps: ApiDeps = browser): Promise<Response> {
  return request(path, deps, { method: "POST", headers });
}

/** A POST whose answer the page uses. */
export async function postJson<S extends z.ZodType>(path: string, headers: Record<string, string>, schema: S, deps: ApiDeps = browser): Promise<z.infer<S>> {
  return parseBody(await post(path, headers, deps), path, schema, deps);
}

/** TanStack Query's retry rule: retry only failures that can pass next time (no answer, a 5xx). */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES) return false;
  return !(error instanceof ApiError) || error.status === 0 || error.status >= 500;
}
