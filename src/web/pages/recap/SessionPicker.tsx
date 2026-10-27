// The session picker: « ‹ › » step by month and by session (the server names each target), and a
// list of the open session's month.
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import { Link, useLocation } from "react-router";
import { monthOf } from "../../../shared/periods";
import type { PlaylistFilter } from "../../../shared/playlist-filter";
import type { SessionDetail, SessionSummary } from "../../../shared/schemas/responses";
import { dayLabel, durationText, monthLabel, ordinal, plural, timeRange } from "../../logic/format";
import { groupByDay, monthRange, strip } from "../../logic/picker";
import { recapPath, type RecapView } from "../../logic/recap";
import { useSessionList } from "../../queries";
import styles from "./SessionPicker.module.css";

const STRIP_MAX = 24;

/** The picker's targets open on this page of the other session: a match page opens its Matches & numbers. */
type PageView = Exclude<RecapView, { match: string }>;

export function SessionPicker({
  detail,
  filter,
  view,
  buttonRef: button,
}: {
  detail: SessionDetail;
  filter: PlaylistFilter;
  view: PageView;
  buttonRef: RefObject<HTMLButtonElement | null>;
}) {
  const [open, setOpen] = useState(false);
  // Any navigation that keeps the picker mounted (to a cached session, Back, Forward, the filter)
  // closes the list. Kept as the last location seen, not derived from where it was opened: derived, coming
  // Forward to that entry again would reopen it.
  const { key: at } = useLocation();
  const [seenAt, setSeenAt] = useState(at);
  if (seenAt !== at) {
    setSeenAt(at);
    setOpen(false);
  }
  const nav = useRef<HTMLDivElement>(null);
  const popId = useId();
  const summary = detail.summary;
  const closeToButton = useCallback(() => {
    setOpen(false);
    button.current?.focus();
  }, [button]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeToButton();
    };
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !nav.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, closeToButton]);

  return (
    <div className={styles.nav} ref={nav}>
      <Step to={detail.prevMonth} filter={filter} view={view} label="Previous month" icon="months-back" />
      <Step to={detail.prev} filter={filter} view={view} label="Previous session" icon="back" />
      {/* The page's h1 names the session; the button inside it opens the list (as an accordion header does). */}
      <h1 className={styles.heading}>
        <button
          ref={button}
          type="button"
          className={styles.pick}
          aria-expanded={open}
          aria-controls={popId}
          onClick={() => { setOpen((o) => !o); }}
        >
          <span className="visually-hidden">Recap: </span>
          <b>{dayLabel(detail.day)}</b> <span className={styles.muted}>{timeRange(detail.startedAt, detail.endedAt)}</span>
          {summary && summary.ofDay > 1 && <span className={styles.chip}>{ordinal(summary.ordinal)} of {summary.ofDay} that day</span>}
        </button>
      </h1>
      <Step to={detail.next} filter={filter} view={view} label="Next session" icon="on" />
      <Step to={detail.nextMonth} filter={filter} view={view} label="Next month" icon="months-on" />
      {open && <MonthList id={popId} month={monthOf(detail.day)} currentKey={detail.key} filter={filter} view={view} onPick={closeToButton} />}
    </div>
  );
}

// Lucide's chevron-left/right and chevrons-left/right.
const PATHS = {
  "months-back": ["m11 17-5-5 5-5", "m18 17-5-5 5-5"],
  back: ["m15 18-6-6 6-6"],
  on: ["m9 18 6-6-6-6"],
  "months-on": ["m6 17 5-5-5-5", "m13 17 5-5-5-5"],
} as const;

function Step({ to, filter, view, label, icon }: { to: string | null; filter: PlaylistFilter; view: PageView; label: string; icon: keyof typeof PATHS }) {
  const glyph = (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[icon].map((d) => <path key={d} d={d} />)}
    </svg>
  );
  return to === null ? (
    <button type="button" className={styles.step} disabled aria-label={label} title={label}>{glyph}</button>
  ) : (
    <Link className={styles.step} to={recapPath(to, filter, view)} aria-label={label} title={label}>{glyph}</Link>
  );
}

function MonthList({ id, month, currentKey, filter, view, onPick }: { id: string; month: string; currentKey: string; filter: PlaylistFilter; view: PageView; onPick: () => void }) {
  const { from, to } = monthRange(month);
  const list = useSessionList(filter, from, to);
  const pop = useRef<HTMLDivElement>(null);

  // Opening puts focus on the open session's row once the list arrives, else on its first row.
  const listed = list.data !== undefined;
  useEffect(() => {
    if (listed) (pop.current?.querySelector<HTMLElement>("[aria-current=true]") ?? pop.current?.querySelector<HTMLElement>("a"))?.focus();
  }, [listed]);

  return (
    <div id={id} ref={pop} className={styles.pop}>
      <h2 className={styles.sec}>{monthLabel(month)}</h2>
      {list.isError && <p className={styles.note}>Couldn't load this month's sessions.</p>}
      {list.data?.length === 0 && <p className={styles.note}>No sessions under this filter this month.</p>}
      {list.data && groupByDay(list.data).map((g) => (
        <section key={g.day} aria-label={dayLabel(g.day)}>
          <h3 className={styles.day}>{dayLabel(g.day)}</h3>
          {g.sessions.map((s) => <Row key={s.key} s={s} current={s.key === currentKey} filter={filter} view={view} onPick={onPick} />)}
        </section>
      ))}
    </div>
  );
}

function Row({ s, current, filter, view, onPick }: { s: SessionSummary; current: boolean; filter: PlaylistFilter; view: PageView; onPick: () => void }) {
  const { squares, more } = strip(s.results, STRIP_MAX);
  return (
    <Link className={styles.row} to={recapPath(s.key, filter, view)} aria-current={current} onClick={onPick}>
      <span>{timeRange(s.startedAt, s.endedAt)}</span>
      <span className="num">{s.wins}–{s.losses}</span>
      <span className={styles.sm}>{plural(s.matches, "match", "matches")} · {durationText(s.endedAt - s.startedAt)}</span>
      <span className={styles.wls} aria-hidden="true">
        {squares.map((r, i) => <i key={i} className={r === "win" ? styles.w : r === "loss" ? styles.l : undefined} />)}
        {more > 0 && <span>+{more}</span>}
      </span>
    </Link>
  );
}
