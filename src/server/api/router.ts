// A small route table: paths like "/api/sessions/:key", matched segment by segment.

export interface Route<H> {
  method: "GET" | "POST";
  path: string;
  handler: H;
}

export type RouteMatch<H> =
  | { kind: "found"; handler: H; path: string; params: Record<string, string> }
  | { kind: "not_found" }
  | { kind: "method_not_allowed" };

/** The params when the path fits the pattern, else null. */
function fit(pattern: string, segments: readonly string[]): Record<string, string> | null {
  const parts = pattern.split("/");
  if (parts.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (const [i, part] of parts.entries()) {
    const seg = segments[i] ?? "";
    if (part.startsWith(":")) {
      if (seg === "") return null;
      params[part.slice(1)] = seg;
    } else if (part !== seg) return null;
  }
  return params;
}

/** Literal segments first: the earliest segment where one route has a literal and the other a :param decides. */
function bySpecificity(a: string, b: string): number {
  const [pa, pb] = [a.split("/"), b.split("/")];
  for (const [i, x] of pa.entries()) {
    const xParam = x.startsWith(":");
    const yParam = (pb[i] ?? "").startsWith(":");
    if (xParam !== yParam) return xParam ? 1 : -1;
  }
  return 0;
}

export function matchRoute<H>(routes: readonly Route<H>[], method: string, pathname: string): RouteMatch<H> {
  let segments: string[];
  try {
    segments = pathname.split("/").map(decodeURIComponent);
  } catch {
    return { kind: "not_found" }; // a malformed %-escape names no route
  }
  const fits = routes.flatMap((r) => {
    const params = fit(r.path, segments);
    return params ? [{ route: r, params }] : [];
  });
  const [best] = fits.filter((f) => f.route.method === method).sort((a, b) => bySpecificity(a.route.path, b.route.path));
  if (best) return { kind: "found", handler: best.route.handler, path: best.route.path, params: best.params };
  return fits.length ? { kind: "method_not_allowed" } : { kind: "not_found" };
}
