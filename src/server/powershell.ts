export interface CommandResult {
  /** Null when the process was killed. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Runs a program in a hidden window, killed after `timeoutMs`: a hung WMI query, toast or registry
 * read must never hold up the poll that awaits it. Throws only when the program can't be started.
 */
export async function runCommand(argv: string[], timeoutMs: number): Promise<CommandResult> {
  const proc = Bun.spawn(argv, { windowsHide: true, stdout: "pipe", stderr: "pipe", timeout: timeoutMs });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code: proc.signalCode === null ? code : null, stdout, stderr, timedOut: proc.signalCode !== null };
}

/** `runCommand` for a PowerShell script. */
export function runPowerShell(script: string, timeoutMs: number): Promise<CommandResult> {
  return runCommand(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], timeoutMs);
}
