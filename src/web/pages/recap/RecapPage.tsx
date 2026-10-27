// The recap routes. `/recap` finds the newest session under the filter and moves to it; a session's
// page shows the picker, the playlist filter and the Overview. The filter lives in `?filter=`.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, NavigationType, useNavigate, useNavigationType, useParams, useSearchParams } from "react-router";
import type { PlaylistFilter as Filter } from "../../../shared/playlist-filter";
import { ApiError } from "../../api";
import { EmptyState } from "../../components/EmptyState";
import { PlaylistFilter } from "../../components/PlaylistFilter";
import { filterValue, parseFilter } from "../../logic/filter-options";
import { recapPath } from "../../logic/recap";
import { useLatestSession, useSessionDetail } from "../../queries";
import { Overview } from "./Overview";
import { SessionPicker } from "./SessionPicker";
import styles from "./RecapPage.module.css";

function useRecapFilter(): Filter {
  const [params] = useSearchParams();
  const raw = params.get("filter");
  const { filter, bad } = parseFilter(raw);
  useEffect(() => {
    if (bad) console.warn("[rlt] recap/bad_filter", { value: raw });
  }, [bad, raw]);
  return filter;
}

/** The h1 of a state with no session to name, so every page has one. */
const Title = () => <h1 className={styles.title}>Recap</h1>;

/** A state with nothing to recap. */
function Notice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <>
      <Title />
      <EmptyState title={title}>{children}</EmptyState>
    </>
  );
}

const LOADING_DELAY_MS = 150;

/** The pulse and its announcement show only past a short delay, so a quick load doesn't flash. */
function Loading() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => { setShown(true); }, LOADING_DELAY_MS);
    return () => { clearTimeout(t); };
  }, []);
  // The live region is there from the start, so the text added to it is announced.
  return (
    <>
      <Title />
      <div className={styles.loading} role="status">
        {shown && <><div className={styles.pulse} /><span className="visually-hidden">Loading the session…</span></>}
      </div>
    </>
  );
}

const NOT_ENOUGH = "Not enough data yet. Play a match with the tracker running and its recap appears here.";

export function RecapIndex() {
  const filter = useRecapFilter();
  const navigate = useNavigate();
  const latest = useLatestSession(filter);

  if (latest.data?.session) return <Navigate to={recapPath(latest.data.session.key, filter)} replace />;
  if (latest.isError) return <Notice title="Couldn't load the recap. Is the tracker running?" />;
  if (!latest.data) return <Loading />;
  // Nothing under this filter: an empty history, or a filter that misses everything played.
  const { playlistsPresent } = latest.data;
  if (!playlistsPresent.length) return <Notice title={NOT_ENOUGH} />;
  return (
    <>
      <Title />
      <div className={styles.bar}>
        <PlaylistFilter value={filter} present={playlistsPresent} onChange={(f) => { void navigate(recapPath(null, f)); }} />
      </div>
      <EmptyState title="No matches under this filter yet." />
    </>
  );
}

export function RecapSession() {
  const { session = "" } = useParams();
  const filter = useRecapFilter();
  const navigate = useNavigate();
  const detail = useSessionDetail(session, filter);
  const pickerButton = useRef<HTMLButtonElement>(null);
  const filterSelect = useRef<HTMLSelectElement>(null);
  const ready = detail.data !== undefined;
  const navigation = useNavigationType();
  const shownFilter = filterValue(filter);
  const seen = useRef<{ session: string; filter: string } | null>(null);

  // While a session loads, the loading state replaces the controls, so the one used loses focus to
  // the page. Once a session is on screen, focus that fell there goes to the picker, the h1 naming
  // the session; after a filter change (not Back or Forward), back to the filter, as arrowing through
  // a closed select changes it on each key. Focus anywhere else, or arriving on the page, is left be.
  useEffect(() => {
    if (!ready) return;
    const last = seen.current;
    seen.current = { session, filter: shownFilter };
    if (last === null || document.activeElement !== document.body) return;
    const filterChange = navigation !== NavigationType.Pop && last.session === session && last.filter !== shownFilter;
    console.debug("[rlt] recap/focus", { to: filterChange ? "filter" : "picker", navigation, session, filter: shownFilter });
    (filterChange ? filterSelect : pickerButton).current?.focus();
  }, [ready, session, shownFilter, navigation]);

  const gone = detail.error instanceof ApiError && detail.error.status === 404;
  // A failed refetch keeps the session on screen, unless the session is gone.
  if (detail.isError && (gone || !detail.data)) {
    return (
      <Notice title={gone ? "This session isn't here any more." : "Couldn't load this session. Is the tracker running?"}>
        <p><Link to={recapPath(null, filter)}>Go to the latest session</Link></p>
      </Notice>
    );
  }
  // Waits for the session rather than showing the last one, whose controls would act on old data.
  if (!detail.data) return <Loading />;

  const d = detail.data;
  return (
    <div data-session={d.key}>
      <div className={styles.bar}>
        <SessionPicker detail={d} filter={filter} buttonRef={pickerButton} />
        <PlaylistFilter value={filter} present={d.playlistsPresent} selectRef={filterSelect} onChange={(f) => { void navigate(recapPath(session, f)); }} />
      </div>
      {d.summary ? <Overview detail={d} summary={d.summary} /> : <EmptyState title="No matches under this filter in this session." />}
    </div>
  );
}
