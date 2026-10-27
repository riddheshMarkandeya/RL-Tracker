// One match of the session: the session's match list on the side, then the match's header, its flag
// note, the scoreboard (every player, from the match's own query), its goal map and your extras.
import { useEffect, useLayoutEffect, useRef } from "react";
import { Link } from "react-router";
import { aggregate } from "../../../shared/aggregate";
import type { PlaylistFilter } from "../../../shared/playlist-filter";
import { playlistInfo } from "../../../shared/playlists";
import type { MatchDetail, MyMatchWire, SessionDetail } from "../../../shared/schemas/responses";
import { ApiError } from "../../api";
import mvpIcon from "../../assets/icons/MVP.png";
import { cx } from "../../components/cx";
import { GoalMap } from "../../components/GoalMap";
import { filterValue } from "../../logic/filter-options";
import { clock } from "../../logic/format";
import { flagLines, flagShort, isMyMvp, letter, matchLabel, recapPath, resultWord, scoreboardTeams, scoreFor, type ScoreTeam } from "../../logic/recap";
import { useMatchDetail } from "../../queries";
import { ExtrasSection } from "./Overview";
import styles from "./MatchView.module.css";

export function MatchView({ detail, filter, guid }: { detail: SessionDetail; filter: PlaylistFilter; guid: string }) {
  const i = detail.matches.findIndex((m) => m.guid === guid);
  const m = detail.matches[i];
  return (
    <div className={styles.split}>
      <Rail detail={detail} filter={filter} guid={guid} />
      <div className={styles.detail}>
        {m ? <Match detail={detail} m={m} n={i + 1} /> : <NotInView detail={detail} filter={filter} guid={guid} />}
      </div>
    </div>
  );
}

function Rail({ detail, filter, guid }: { detail: SessionDetail; filter: PlaylistFilter; guid: string }) {
  const box = useRef<HTMLElement>(null);
  // Keeps the open match in view: centred in the list's own scroll box, so the page doesn't move.
  useLayoutEffect(() => {
    const b = box.current;
    const open = b?.querySelector<HTMLElement>("[aria-current=page]");
    if (!b || !open) return;
    b.scrollTop += open.getBoundingClientRect().top - b.getBoundingClientRect().top - (b.clientHeight - open.offsetHeight) / 2;
  }, [guid]);

  return (
    <nav ref={box} className={styles.rail} aria-label="Matches" data-nav="rail">
      <Link className={styles.all} to={recapPath(detail.key, filter, "matches")}>
        ← All matches<span className={styles.meta}>full numbers table</span>
      </Link>
      <ol>
        {detail.matches.map((m, i) => {
          const mvp = isMyMvp(m);
          const flag = flagShort(m.flags);
          const score = scoreFor(m);
          const playlist = playlistInfo(m.playlistId).name;
          return (
            <li key={m.guid}>
              <Link
                className={cx(styles.row, m.result === "win" && styles.win, m.result === "loss" && styles.loss)}
                to={recapPath(detail.key, filter, { match: m.guid })}
                aria-current={m.guid === guid ? "page" : undefined}
                aria-label={matchLabel(m, i + 1)}
              >
                <i aria-hidden="true">{letter(m.result)}</i>
                <span aria-hidden="true">
                  {playlist} <span className="num">{score}</span>
                  {mvp && <img className={styles.ico} src={mvpIcon} alt="" />}
                  <span className={styles.meta}>#{i + 1} · {clock(m.startedAt)}</span>
                </span>
                <span className={styles.flag} title={flag ?? undefined} aria-hidden="true">{flag && "⚑"}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Match({ detail, m, n }: { detail: SessionDetail; m: MyMatchWire; n: number }) {
  const mvp = isMyMvp(m);
  const lines = flagLines(m.flags, m.result);
  const goals = detail.goals.filter((g) => g.matchGuid === m.guid);
  return (
    <>
      <div className={styles.panel}>
        <div className={styles.kpis}>
          <h2 className={styles.title}>
            <span className="visually-hidden">Match {n}: </span>
            <i className={cx(m.result === "win" && styles.winText, m.result === "loss" && styles.lossText)} aria-hidden="true">{letter(m.result)}</i>
            <span className="visually-hidden">{resultWord(m.result)} </span>
            <b className="num">{scoreFor(m) ?? "–"}</b>
          </h2>
          <div>
            <b>{playlistInfo(m.playlistId).name}</b>
            <div className={styles.meta}>{clock(m.startedAt)} · match {n}</div>
          </div>
          {mvp && (
            <span className={styles.chip}>
              <img className={styles.ico} src={mvpIcon} alt="" />MVP{m.flags.includes("mvp_inferred") && " (inferred)"}
            </span>
          )}
        </div>
      </div>
      {lines.length > 0 && (
        <div className={styles.callout} role="note" aria-label="Flagged">
          {lines.map((l) => <p key={l}>{l}</p>)}
        </div>
      )}
      <Scoreboard guid={m.guid} />
      {goals.length > 0 && (
        <section aria-labelledby="match-goals-heading">
          <h2 id="match-goals-heading" className={styles.sec}>Where the goals came from</h2>
          <div className={styles.panel}>
            {/* The session's matches, so each mark's title numbers its match as the cards do. */}
            <GoalMap matches={detail.matches} goals={goals} viewKey={m.guid} />
          </div>
        </section>
      )}
      <ExtrasSection agg={aggregate([m])} matches={[m]} heading="Your match" />
    </>
  );
}

const TEAM_LABEL: Record<ScoreTeam["side"], string> = { yours: "Your team", opponents: "Opponents", blue: "Blue", orange: "Orange", unknown: "Unknown team" };
const TEAM_TONE: Record<ScoreTeam["side"], string | undefined> = { yours: styles.blue, opponents: styles.orange, blue: styles.blue, orange: styles.orange, unknown: undefined };

function Scoreboard({ guid }: { guid: string }) {
  const full = useMatchDetail(guid);
  const data = full.data;
  const me = data?.players.find((p) => p.isMe);
  const teams = data ? scoreboardTeams(data.players, me?.teamNum ?? null) : [];
  const noTeam = teams.find((t) => t.side === "unknown")?.players.length ?? 0;

  // Unseen in real data: a player with no team. They're listed apart; the warn says where.
  useEffect(() => {
    if (noTeam > 0) console.warn("[rlt] recap/player_no_team", { guid, count: noTeam });
  }, [guid, noTeam]);

  if (full.isError && !data) return <p className={styles.meta}>Couldn't load the scoreboard.</p>;
  if (!data) return <div className={styles.loading} role="status"><span className="visually-hidden">Loading the scoreboard…</span></div>;
  if (!teams.length) return null;
  return (
    <section aria-labelledby="scoreboard-heading">
      <h2 id="scoreboard-heading" className="visually-hidden">Scoreboard</h2>
      <div className={styles.teams}>
        {teams.map((t) => <Team key={t.side} team={t} winner={data.match.winnerTeamNum} />)}
      </div>
    </section>
  );
}

function Team({ team, winner }: { team: ScoreTeam; winner: number | null }) {
  const outcome = team.teamNum === null || winner === null ? "" : team.teamNum === winner ? " · won" : " · lost";
  return (
    <div className={cx(styles.panel, styles.team, TEAM_TONE[team.side])}>
      <h3 className={styles.h3}>{TEAM_LABEL[team.side]}{outcome}</h3>
      <table className={cx(styles.table, "num")}>
        <thead>
          <tr>
            <th scope="col">Player</th><th scope="col">Score</th><th scope="col"><abbr title="Goals">G</abbr></th>
            <th scope="col"><abbr title="Assists">A</abbr></th><th scope="col"><abbr title="Saves">Sv</abbr></th><th scope="col"><abbr title="Shots">Sh</abbr></th>
          </tr>
        </thead>
        <tbody>
          {team.players.map((p) => <PlayerRow key={p.playerKey} p={p} />)}
        </tbody>
      </table>
    </div>
  );
}

function PlayerRow({ p }: { p: MatchDetail["players"][number] }) {
  return (
    <tr className={cx(p.isMe && styles.me)}>
      <th scope="row">{p.name}{p.isMe && " (you)"}{p.isBot && <span className={styles.meta}> bot</span>}</th>
      <td>{p.score}</td><td>{p.goals}</td><td>{p.assists}</td><td>{p.saves}</td><td>{p.shots}</td>
    </tr>
  );
}

/** A match page for a guid this session's list doesn't hold under the filter. */
function NotInView({ detail, filter, guid }: { detail: SessionDetail; filter: PlaylistFilter; guid: string }) {
  const full = useMatchDetail(guid);
  const status = full.error instanceof ApiError ? full.error.status : full.error ? "network" : null;
  const elsewhere = full.data?.sessionKey ?? null;
  const f = filterValue(filter);

  // Tells a stale link (another session, or gone) from a filter that leaves the match out, and both
  // from a lookup that failed.
  useEffect(() => {
    if (!full.isPending) console.warn("[rlt] recap/match_not_in_view", { session: detail.key, guid, filter: f, sessionKey: elsewhere, status });
  }, [detail.key, guid, f, elsewhere, status, full.isPending]);

  if (full.isPending) return <div className={styles.loading} role="status"><span className="visually-hidden">Looking for this match…</span></div>;
  const heading = status === 404 ? "This match isn't here any more." : status !== null ? "Couldn't look up this match." : "This match isn't in this view.";
  return (
    <div className={styles.panel}>
      <h2 className={styles.h3}>{heading}</h2>
      <ul className={styles.links}>
        {elsewhere !== null && elsewhere !== detail.key && <li><Link to={recapPath(elsewhere, filter, { match: guid })}>Open it in its own session</Link></li>}
        {elsewhere === detail.key && filter !== "everything" && <li><Link to={recapPath(detail.key, "everything", { match: guid })}>Show it under every playlist</Link></li>}
        <li><Link to={recapPath(detail.key, filter, "matches")}>All matches in this session</Link></li>
      </ul>
    </div>
  );
}
