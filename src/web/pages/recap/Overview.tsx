// The recap's Overview, sections 1–4: scorebug, the change against the 30-day average, the tiles
// and the match cards. Sections 5–8 follow below them.
import { playlistInfo } from "../../../shared/playlists";
import type { MyMatchWire, SessionDetail, SessionSummary } from "../../../shared/schemas/responses";
import mvpIcon from "../../assets/icons/MVP.png";
import { cx } from "../../components/cx";
import { clock, dayLabel, durationText, plural } from "../../logic/format";
import { isDense, letter, pct, resultWord, scoreFor, tilesFor, winPctDelta } from "../../logic/recap";
import styles from "./Overview.module.css";

export function Overview({ detail, summary }: { detail: SessionDetail; summary: SessionSummary }) {
  return (
    <>
      <Scorebug detail={detail} summary={summary} />
      <Headline detail={detail} />
      <MatchCards matches={detail.matches} />
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

function MatchCards({ matches }: { matches: MyMatchWire[] }) {
  return (
    <section aria-labelledby="matches-heading">
      <div className={styles.cardsHead}>
        <h2 id="matches-heading" className={styles.h2}>Matches</h2>
        <span className={styles.muted}>Results in order</span>
      </div>
      <ol className={cx(styles.cards, isDense(matches.length) && styles.dense)}>
        {matches.map((m, i) => {
          const score = scoreFor(m);
          const mvp = m.me !== null && m.mvpKey === m.me.playerKey;
          const playlist = playlistInfo(m.playlistId).name;
          const label = [`Match ${String(i + 1)}`, clock(m.startedAt), resultWord(m.result), score, playlist, mvp && "MVP", m.flagged && "flagged: a check failed on this match"].filter(Boolean).join(", ");
          return (
            <li key={m.guid} className={cx(styles.card, m.result === "win" && styles.win, m.result === "loss" && styles.loss, m.flagged && styles.flagged)} aria-label={label}>
              <span className={styles.t} aria-hidden="true">#{i + 1} · {clock(m.startedAt)}</span>
              <b className="num" aria-hidden="true"><i>{letter(m.result)}</i> {score}</b>
              <span className={styles.p} aria-hidden="true" title={playlist}>{playlist}</span>
              {mvp && <img className={styles.mvp} src={mvpIcon} alt="" />}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
