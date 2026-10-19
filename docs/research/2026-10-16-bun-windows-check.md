# Bun on Windows: Vitest, Playwright, Task Scheduler — research note

Date: 2026-10-16. Feeds: WP2's Bun check (ADR `docs/decisions/2026-10-16-bun-runtime.md`).
Installed: Bun 1.4.3, Node 24.14.1. Gathered by a research agent from primary sources; "inference"
marks the agent's own reading. The local spike results are in the ADR, not here.

## 1. Vitest under Bun
Source-stated:
- The Bun 1.4 release blog: "Vitest runs under Bun, including `--coverage`, with both the threads
  and forks pools" (https://bun.com/blog/bun-v1.4). No Windows-specific detail in the part read.
- Bun issue #4145 "Support Vitest": a comment of 2026-08-20 says "Shipped in 1.4!". Earlier
  failures were hangs, mostly gone with `pool: 'forks'`. No Windows discussion
  (https://github.com/oven-sh/bun/issues/4145).
- Vitest rewrote Bun-only builtins (`bun:sqlite`) to `node:bun:sqlite` (Vitest #8925). Fixed by
  Vitest PR #9117, merged 2025-11-27; Vitest 5 is past it.
- V8 coverage fails on Bun (`node:inspector` missing); a Vitest maintainer recommended Istanbul.
  This conflicts with the Bun blog's `--coverage` claim.
- Fallback: `bun test`, the Jest-compatible built-in runner (https://bun.com/docs/test/runtime-behavior).

Inference: `bun --bun vitest run` with `pool: 'forks'` should work; unconfirmed on Windows.

## 2. Playwright under Bun
- Bun 1.4 blog claims `playwright test` runs on Bun, including Chromium on Windows.
- Playwright's maintainer closed microsoft/playwright #27139 as "not planned" (2023-09-18): not
  officially supported. Later comments report success (Playwright 1.62.1 on Bun 1.4.2, 2026-09).
- A 2025-04 Windows report said `chromium.launch` hangs on Bun 1.2.10 (oven-sh/bun #2492).

Inference: Node stays the supported Playwright runner; Node 24 is already installed.

## 3. Task Scheduler and a long-running `bun.exe`
Source-stated:
- RestartOnFailure restarts "if the task fails for any reason"; `Count` and `Interval` must both
  be set. "Fails" is never defined
  (https://learn.microsoft.com/en-us/windows/win32/taskschd/taskschedulerschema-restartonfailure-settingstype-element).
- A Microsoft forum answer (community, not a primary doc) says only a failure to *start* is
  retried, not a launched program returning an error code.
- ExecutionTimeLimit: "By default, a task will be stopped 72 hours after it starts to run"; `PT0S`
  means unlimited
  (https://learn.microsoft.com/en-us/windows/win32/taskschd/tasksettings-executiontimelimit).
- `bun build --compile --windows-hide-console` hides the console of a compiled exe
  (https://bun.com/docs/bundler/executables). Nothing documented on stdout/stderr then.
- A child spawned from a console-less app gets its own console window unless `windowsHide: true`
  (https://bun.com/docs/lint/rules/bun/no-console-window-flash).

Inference: set `PT0S`; don't rely on RestartOnFailure for crash recovery until tested; plain
`bun.exe` is a console app, so a window shows without a hidden launch.

## Open questions (for the spike)
- Vitest 5 + Bun 1.4.3 on Windows with a `bun:sqlite` test.
- Does a nonzero exit after launch trigger RestartOnFailure?
- Do stdout/stderr writes throw with no console?
