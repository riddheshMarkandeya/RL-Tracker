// The Trends page: the period controls and year strip, the period's title line, then its stats
// line, the six tiles and the two charts. The state lives in the query string. The controls and the
// title line are built from the URL and the seasons alone, so they stay mounted while a period
// loads and focus stays on the control used; only the stats, tiles and charts wait for the period.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { dayOf, periodRange, shiftDay } from "../../../shared/periods";
import { EmptyState } from "../../components/EmptyState";
import { Loading } from "../../components/Loading";
import { useNow } from "../../components/useNow";
import { chartMode } from "../../logic/trend-chart";
import { ENOUGH_MATCHES, parseTrends, patchTrends, stripYear, trendsPath, type TrendsState } from "../../logic/trends";
import { usePeriod, usePlayedDays, useSeasons, useSettings } from "../../queries";
import { MetricTiles } from "./MetricTiles";
import { PeriodControls } from "./PeriodControls";
import { PeriodHeader, StatsLine } from "./PeriodHeader";
import { TrendChart } from "./TrendChart";
import styles from "./Trends.module.css";
import { WinLossChart } from "./WinLossChart";

const Title = () => <h1 className="visually-hidden">Trends</h1>;

const NOT_ENOUGH = `Not enough data yet. Trends appear once you've played ${String(ENOUGH_MATCHES)} matches with the tracker running.`;

function useTrendsState(): TrendsState {
  const [params] = useSearchParams();
  const query = params.toString();
  const { trendsFilter } = useSettings();
  const { state, bad } = useMemo(() => parseTrends(new URLSearchParams(query), trendsFilter), [query, trendsFilter]);
  const badKey = bad.join(",");
  useEffect(() => {
    if (badKey) console.warn("[rlt] trends/bad_param", { params: badKey, query });
  }, [badKey, query]);
  return state;
}

export function TrendsPage() {
  const state = useTrendsState();
  const navigate = useNavigate();
  const now = useNow();
  const today = dayOf(now);
  const seasons = useSeasons();
  const range = seasons.data ? periodRange(state.spec, { now, seasons: seasons.data }) : null;
  // The period's first and last day; all time starts at your first match under the filter.
  const lastDay = range ? dayOf(range.to - 1) : today;
  const year = stripYear(state.year, lastDay, today);
  const played = usePlayedDays(year, state.filter);
  const { rollingWindow } = useSettings();
  const period = usePeriod(state.spec, state.filter, today, rollingWindow);
  const firstDay = played.data?.firstDay ?? null;
  const fromDay = range && range.from !== null ? dayOf(range.from) : (period.data?.firstDay ?? null);
  const days = fromDay !== null && range && range.to > (range.from ?? -Infinity) ? { from: fromDay, last: lastDay < fromDay ? fromDay : lastDay } : null;

  const go = (patch: Partial<TrendsState>) => { void navigate(trendsPath(patchTrends(state, patch))); };

  // Logged when the chart's mode or its inputs change, so the console says why By match was shown.
  const chart = period.data ? chartMode(state.x, period.data.buckets, period.data.rolling.length) : null;
  const rolling = period.data?.rolling.length;
  const [mode, auto, withData] = [chart?.mode, chart?.auto, chart?.withData];
  useEffect(() => {
    if (mode !== undefined) console.debug("[rlt] trends/chart", { mode, auto, withData, rolling });
  }, [mode, auto, withData, rolling]);
  // A day with matches but no session to open has no link; the server's fallback should rule it out.
  // Joined, so the effect's dependency is a value that only changes when the days do.
  const orphans = period.data?.bucket === "day" ? period.data.buckets.filter((b) => b.stats.matches > 0 && b.session === null).map((b) => b.day).join(",") : "";
  useEffect(() => {
    if (orphans) console.warn("[rlt] trends/day_no_session", { days: orphans.split(",") });
  }, [orphans]);

  // The filter's options are the period's playlists; kept from the last load, so the select stays
  // mounted (and focused) while the next period loads.
  const [present, setPresent] = useState<number[] | null>(null);
  const loaded = period.data?.playlistsPresent;
  if (loaded && loaded !== present) setPresent(loaded);

  // A control that disables itself (› reaching this week) keeps focus but can't be used; focus that
  // lands there, or falls to the page, goes to the period's title instead.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const shown = trendsPath(state);
  useEffect(() => {
    const at = document.activeElement;
    const lost = at === document.body || (at instanceof HTMLButtonElement && at.disabled);
    if (!lost || !titleRef.current) return;
    console.debug("[rlt] trends/focus", { to: "title", path: shown });
    titleRef.current.focus();
  }, [shown]);

  if (seasons.isError || (played.isError && !played.data)) {
    return (
      <>
        <Title />
        <EmptyState title="Couldn't load your trends. Is the tracker running?" />
      </>
    );
  }
  if (!seasons.data || !played.data) {
    return (
      <>
        <Title />
        <Loading label="Loading your trends…" className={styles.loading} />
      </>
    );
  }
  if (played.data.totalMatches < ENOUGH_MATCHES) {
    return (
      <>
        <Title />
        <EmptyState title={NOT_ENOUGH} />
      </>
    );
  }

  const ctx = { today, seasons: seasons.data, firstDay };
  return (
    <>
      <Title />
      <PeriodControls
        state={state}
        today={today}
        seasons={seasons.data}
        year={year}
        firstDay={firstDay}
        playedDays={played.data.days}
        selected={days && { from: days.from, to: shiftDay(days.last, 1) }}
        present={present}
        onPeriod={(spec, keepYear) => { go({ spec, year: keepYear ? state.year : null }); }}
        onFilter={(filter) => { go({ filter }); }}
        onYear={(y) => { go({ year: y }); }}
      />
      {range === null ? (
        <EmptyState title="This season isn't in the season table." />
      ) : (
        <>
          <PeriodHeader spec={state.spec} range={range} days={days} ctx={ctx} view={period.data} titleRef={titleRef} onStep={(spec) => { go({ spec, year: null }); }} />
          {period.isError && !period.data ? (
            <EmptyState title="Couldn't load this period. Is the tracker running?" />
          ) : !period.data ? (
            <Loading label="Loading the period…" className={styles.loading} />
          ) : period.data.aggregate.matches === 0 ? (
            <EmptyState title="No matches in this period with these filters." />
          ) : (
            <>
              <StatsLine view={period.data} />
              <MetricTiles view={period.data} metric={state.metric} onMetric={(metric) => { go({ metric }); }} />
              {chart && <TrendChart view={period.data} size={rollingWindow} metric={state.metric} chart={chart} seasons={seasons.data} onX={(x) => { go({ x }); }} />}
              <WinLossChart view={period.data} state={state} seasons={seasons.data} />
            </>
          )}
        </>
      )}
    </>
  );
}
