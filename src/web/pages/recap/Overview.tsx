// The recap's Overview: scorebug, the change against the 30-day average, the tiles, the match cards,
// then per-game stats, what stood out, by playlist, the goal map, extras and highlights.
import { useId } from "react";
import { Link } from "react-router";
import type { PlaylistFilter } from "../../../shared/playlist-filter";
import { playlistInfo } from "../../../shared/playlists";
import type { AggregateWire, MyMatchWire, SessionDetail, SessionSummary } from "../../../shared/schemas/responses";
import assistIcon from "../../assets/icons/Assist.png";
import demoIcon from "../../assets/icons/Demolition.png";
import goalIcon from "../../assets/icons/Goal.png";
import mvpIcon from "../../assets/icons/MVP.png";
import saveIcon from "../../assets/icons/Save.png";
import shotIcon from "../../assets/icons/Shot.png";
import { cx } from "../../components/cx";
import { GoalMap } from "../../components/GoalMap";
import { clock, dayLabel, decimal, durationText, plural } from "../../logic/format";
import {
  extrasCards,
  highlights,
  isDense,
  isMyMvp,
  letter,
  matchLabel,
  pct,
  perGameCards,
  playlistRows,
  recapPath,
  scoreFor,
  stoodOut,
  tilesFor,
  winPctDelta,
  type IconName,
  type Vs,
} from "../../logic/recap";
import styles from "./Overview.module.css";

export function Overview({ detail, summary, filter }: { detail: SessionDetail; summary: SessionSummary; filter: PlaylistFilter }) {
  const matchPath = (guid: string) => recapPath(detail.key, filter, { match: guid });
  return (
    <>
      <Scorebug detail={detail} summary={summary} />
      <Headline detail={detail} />
      <MatchCards matches={detail.matches} matchPath={matchPath} />
      <PerGame detail={detail} />
      <StandoutAndPlaylists detail={detail} />
      {detail.goals.length > 0 && (
        <section aria-labelledby="goals-heading">
          <h2 id="goals-heading" className={styles.sec}>Where the goals came from</h2>
          <div className={styles.panel}>
            <GoalMap matches={detail.matches} goals={detail.goals} viewKey={detail.key} hrefFor={matchPath} />
          </div>
        </section>
      )}
      <ExtrasSection agg={detail.aggregate} matches={detail.matches} heading="Extras" />
    </>
  );
}

function Scorebug({ detail, summary }: { detail: SessionDetail; summary: SessionSummary }) {
  const winPct = detail.aggregate.winPct;
  return (
    <div className={styles.bug} role="img" aria-label={`${plural(summary.wins, "win")}, ${plural(summary.losses, "loss", "losses")}`}>
      <div className={styles.side}><span>WINS</span><b className="num">{summary.wins}</b></div>
      <div className={styles.mid}>
        <span>{dayLabel(detail.day).toUpperCase()}</span>
        <b>{durationText(detail.endedAt - detail.startedAt)}</b>
        <span className="num">{winPct !== null && `${String(pct(winPct))}% · `}{plural(summary.matches, "MATCH", "MATCHES")}</span>
      </div>
      <div className={cx(styles.side, styles.right)}><b className="num">{summary.losses}</b><span>LOSSES</span></div>
    </div>
  );
}

function Headline({ detail }: { detail: SessionDetail }) {
  const delta = winPctDelta(detail.aggregate, detail.baseline);
  const tiles = tilesFor(detail.aggregate, detail.baseline);
  return (
    <div className={styles.sub}>
      {delta && (
        <p className={styles.delta}>
          {delta.points === 0 ? (
            "Level with your 30-day win %"
          ) : (
            <span className={delta.points > 0 ? styles.up : styles.down}>{delta.points > 0 ? "▲" : "▼"} {Math.abs(delta.points)} pts win % vs your 30-day average</span>
          )}{" "}
          <span className={styles.muted}>({delta.avg}%)</span>
        </p>
      )}
      {tiles.length > 0 && (
        <ul className={styles.tiles}>
          {tiles.map((t) => (
            <li key={t.id}>
              <b className="num">
                {t.id === "mvps" && <img className={styles.ico} src={mvpIcon} alt="" />}
                {t.value}
                {t.vs && (
                  <small className={t.vs.dir === "up" ? styles.up : t.vs.dir === "down" ? styles.down : styles.muted}>
                    {t.vs.dir === "up" ? "▲" : t.vs.dir === "down" ? "▼" : "="} avg {t.vs.avg}
                  </small>
                )}
              </b>
              <span>{t.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MatchCards({ matches, matchPath }: { matches: MyMatchWire[]; matchPath: (guid: string) => string }) {
  return (
    <section aria-labelledby="matches-heading">
      <div className={styles.cardsHead}>
        <h2 id="matches-heading" className={styles.h2}>Matches</h2>
        <span className={styles.muted}>Results in order</span>
      </div>
      <ol className={cx(styles.cards, isDense(matches.length) && styles.dense)}>
        {matches.map((m, i) => {
          const score = scoreFor(m);
          const mvp = isMyMvp(m);
          const playlist = playlistInfo(m.playlistId).name;
          return (
            <li key={m.guid}>
              <Link to={matchPath(m.guid)} className={cx(styles.card, m.result === "win" && styles.win, m.result === "loss" && styles.loss, m.flags.length > 0 && styles.flagged)} aria-label={matchLabel(m, i + 1)}>
                <span className={styles.t} aria-hidden="true">#{i + 1} · {clock(m.startedAt)}</span>
                <b className="num" aria-hidden="true"><i>{letter(m.result)}</i> {score}</b>
                <span className={styles.p} aria-hidden="true" title={playlist}>{playlist}</span>
                {mvp && <img className={styles.mvp} src={mvpIcon} alt="" />}
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const ICONS: Record<IconName, string> = { Goal: goalIcon, Assist: assistIcon, Save: saveIcon, Shot: shotIcon, Demolition: demoIcon };

/** "▲ 12%" with the direction in words for screen readers, or "≈ 30-day avg". */
function VsText({ vs }: { vs: Vs }) {
  if (vs.dir === "same") return <span className={styles.muted}>≈ 30-day avg</span>;
  return (
    <span className={vs.dir === "up" ? styles.up : styles.down}>
      <span aria-hidden="true">{vs.dir === "up" ? "▲" : "▼"}</span>
      <span className="visually-hidden">{vs.dir}</span> {Math.abs(vs.pct)}%
    </span>
  );
}

function PerGame({ detail }: { detail: SessionDetail }) {
  const cards = perGameCards(detail.aggregate, detail.baseline);
  if (!cards.length) return null;
  const hasBase = detail.baseline.matches > 0;
  return (
    <section aria-labelledby="per-game-heading">
      <h2 id="per-game-heading" className={styles.sec}>{hasBase ? "Per game vs your 30-day average" : "Per game"}</h2>
      <ul className={styles.grid}>
        {cards.map((c) => (
          <li key={c.id} className={styles.stat}>
            <span className={styles.lbl}>{c.icon && <img className={styles.sIco} src={ICONS[c.icon]} alt="" />}{c.label}</span>
            <b className="num">{decimal(c.perGame)}<small> /game</small></b>
            {c.vs && <span className={styles.vs}><VsText vs={c.vs} />{c.vs.dir !== "same" && <span className={styles.muted}> vs 30-day avg</span>}</span>}
            <span className={cx(styles.muted, styles.small, "num")}>{c.total} total</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StandoutAndPlaylists({ detail }: { detail: SessionDetail }) {
  const stood = stoodOut(detail.aggregate, detail.baseline);
  const rows = playlistRows(detail.byPlaylist);
  if (stood === null && rows === null) return null;
  return (
    <div className={styles.grid2}>
      {stood !== null && (
        <section className={styles.panel} aria-labelledby="stood-out-heading">
          <h2 id="stood-out-heading" className={styles.h2}>What stood out</h2>
          {stood.length === 0 ? (
            <p className={styles.muted}>Close to your 30-day average on every stat.</p>
          ) : (
            <ul className={styles.stand}>
              {stood.map((s) => (
                <li key={s.id}>
                  {s.icon ? <img className={styles.bIco} src={ICONS[s.icon]} alt="" /> : <span />}
                  <div>
                    <b className="num">{decimal(s.perGame)} {s.label.toLowerCase()} per game</b>
                    <div className="num"><VsText vs={s.vs} /> <span className={styles.muted}>vs 30-day avg ({decimal(s.avg)})</span></div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {rows !== null && (
        <section className={styles.panel} aria-labelledby="by-playlist-heading">
          <h2 id="by-playlist-heading" className={styles.h2}>By playlist</h2>
          <table className={cx(styles.table, "num")}>
            <thead><tr><th scope="col">Playlist</th><th scope="col">W–L</th><th scope="col">Win %</th><th scope="col">Goals/g</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.playlistId)}>
                  <th scope="row">{r.name}</th>
                  <td>{r.wins === null || r.losses === null ? "–" : `${String(r.wins)}–${String(r.losses)}`}</td>
                  <td>{r.winPct === null ? "–" : `${String(r.winPct)}%`}</td>
                  <td>{r.goalsPerGame === null ? "–" : decimal(r.goalsPerGame)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

/** The extras tiles and highlights over these matches; the Overview's "Extras", a match page's "Your match". */
export function ExtrasSection({ agg: a, matches, heading }: { agg: AggregateWire; matches: MyMatchWire[]; heading: string }) {
  const id = useId();
  const cards = extrasCards(a, matches);
  const hl = highlights(a.statfeed);
  if (!cards.length && !hl.length) return null;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className={styles.sec}>{heading}</h2>
      {a.extrasMatches > 0 && a.extrasMatches < a.matches && (
        <p className={cx(styles.muted, styles.small)}>Over {a.extrasMatches} of {plural(a.matches, "match", "matches")}.</p>
      )}
      {cards.length > 0 && (
        <ul className={styles.grid}>
          {cards.map((c) => (
            <li key={c.id} className={styles.stat}>
              <span className={styles.lbl}>{c.label}</span>
              <b className="num">{c.value}{c.unit && <small>{c.unit === "%" ? "%" : ` ${c.unit}`}</small>}</b>
              {c.sub && <span className={cx(styles.muted, styles.small)}>{c.sub}</span>}
            </li>
          ))}
        </ul>
      )}
      {hl.length > 0 && (
        <>
          <h3 className={styles.h3}>Highlights</h3>
          <ul className={styles.grid}>
            {hl.map((h) => (
              <li key={h.event} className={styles.stat}>
                <span className={styles.lbl}>{h.label}</span>
                <b className="num">{h.count}</b>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
