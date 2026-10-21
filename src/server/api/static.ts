// The built dashboard. A file under the static dir is served as is; any other path without a file
// extension gets index.html, so the web app's client-side routes load on a refresh or a pasted link.
import { statSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve } from "node:path";

const notFound = (text = "not found") => new Response(text, { status: 404 });

/** The file a path names under the dir, or null when it would leave the dir (or can't be decoded). */
function inside(dir: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  // "." first, so a decoded "C:/..." or "\\server\..." stays relative to the dir instead of replacing it.
  const file = resolve(dir, `.${decoded}`);
  const rel = relative(dir, file);
  // relative() gives an absolute path when the file is on another drive.
  return rel.startsWith("..") || isAbsolute(rel) ? null : file;
}

function isFile(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
  } catch {
    // Any other stat failure (a name too long, say) is a path we can't serve either.
    return false;
  }
}

function send(path: string): Response {
  const file = Bun.file(path);
  return new Response(file, { headers: { "content-type": file.type } });
}

export function serveStatic(staticDir: string | null, pathname: string): Response {
  if (staticDir === null) return notFound("dashboard not built");
  const file = inside(staticDir, pathname);
  if (file === null) return notFound();
  if (isFile(file)) return send(file);
  // A missing asset (one left over from an older build, say) is a 404, not the app as HTML.
  if (extname(file) !== "") return notFound();
  const index = join(staticDir, "index.html");
  return isFile(index) ? send(index) : notFound("dashboard not built");
}
