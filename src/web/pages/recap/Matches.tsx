// Matches & numbers: every match of the session under the filter, with a totals row. Each row opens
// its match page; the table's box is capped and keeps its header and totals in view.
import { Link } from "react-router";
import type { PlaylistFilter } from "../../../shared/playlist-filter";
import { playlistInfo } from "../../../shared/playlists";
import type { SessionDetail } from "../../../shared/schemas/responses";
import mvpIcon from "../../assets/icons/MVP.png";
import { cx } from "../../components/cx";
import { clock, plural } from "../../logic/format";
import { flagShort, isMyMvp, letter, matchLabel, recapPath, scoreFor } from "../../logic/recap";
import styles from "./Matches.module.css";

/** Stat key, column header, and the header's spelled-out title when it's abbreviated. */
const COLS: readonly (readonly ["score" | "goals" | "assists" | "saves" | "shots" | "demos", string, string?])[] = [
  ["score", "Score"],
  ["goals", "G", "Goals"],
  ["assists", "A", "Assists"],
  ["saves", "Sv", "Saves"],
  ["shots", "Sh", "Shots"],
  ["demos", "Dm", "Demolitions"],
];

const shown = (v: number | null | undefined) => (v == null ? "–" : String(v));

export function Matches({ detail, filter }: { detail: SessionDetail; filter: PlaylistFilter }) {
  const { matches, aggregate: a } = detail;
  const wl = a.wins === null || a.losses === null ? "" : ` · ${String(a.wins)}–${String(a.losses)}`;
  return (
    <section className={styles.panel} aria-labelledby="numbers-heading">
      <h2 id="numbers-heading" className={styles.h2}>Every match · {plural(matches.length, "match", "matches")}{wl}</h2>
      <div className={styles.box}>
        <table className={cx(styles.table, "num")}>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Time</th>
              <th scope="col">Playlist</th>
              <th scope="col">Result</th>
              {COLS.map(([k, label, title]) => <th key={k} scope="col">{title ? <abbr title={title}>{label}</abbr> : label}</th>)}
            </tr>
          </thead>
          <tbody>
            {matches.map((m, i) => {
              const n = i + 1;
              const score = scoreFor(m);
              const mvp = isMyMvp(m);
              const flag = flagShort(m.flags);
              return (
                <tr key={m.guid} className={cx(m.result === "win" && styles.win, m.result === "loss" && styles.loss)}>
                  <td><Link className={styles.open} to={recapPath(detail.key, filter, { match: m.guid })} aria-label={matchLabel(m, n)}>{n}</Link></td>
                  <td>{clock(m.startedAt)}</td>
                  <td>{playlistInfo(m.playlistId).name}</td>
                  <td className={styles.result}>
                    <i>{letter(m.result)}</i> {score}
                    {mvp && <img className={styles.mvp} src={mvpIcon} alt="" />}
                    {flag && <span className={styles.flag} title={flag} aria-hidden="true">⚑</span>}
                  </td>
                  {COLS.map(([k]) => <td key={k}>{shown(m.me?.[k])}</td>)}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={4}>Total</th>
              {COLS.map(([k]) => <td key={k}>{shown(a.totals[k])}</td>)}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className={styles.note}>Click a row to open the match.</p>
    </section>
  );
}
