// The share card: a 360×480 image of the session, copied or saved at 3× (1080×1440) to send to
// friends. It opens in a dialog from the recap's bar; its name and mood line come from two more
// queries, so the card waits for both to settle before it can be exported.
import { toBlob } from "html-to-image";
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { filterValue, type PlaylistFilter } from "../../../shared/playlist-filter";
import type { SessionDetail, SessionSummary } from "../../../shared/schemas/responses";
import { cx } from "../../components/cx";
import { plural } from "../../logic/format";
import { formLine, LINE_MIN, PAD, shareCard, shareFilename, type ShareCardView } from "../../logic/share-card";
import { useMatchDetail, useRemarks, useSettings } from "../../queries";
import styles from "./ShareCard.module.css";

interface Props {
  detail: SessionDetail;
  summary: SessionSummary;
  filter: PlaylistFilter;
}

/** The bar's Share button and its dialog; what's inside, and its queries, exist only while open. */
export function ShareButton(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const show = () => {
    console.debug("[rlt] share/open", { key: props.detail.key, filter: filterValue(props.filter), matches: props.summary.matches });
    dialog.current?.showModal();
    setOpen(true);
  };
  return (
    <>
      <button type="button" className={styles.btn} aria-haspopup="dialog" onClick={show}>Share</button>
      {/* closedby="any": the browser's own light dismiss, a click outside or Esc. */}
      <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} closedby="any" onClose={() => { setOpen(false); }}>
        {open && <ShareDialog {...props} titleId={titleId} onClose={() => dialog.current?.close()} />}
      </dialog>
    </>
  );
}

const errorText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));
type Kind = "copy" | "download";
const FAILED = { render: "Couldn't make the image", clipboard: "Couldn't copy, try Download", save: "Couldn't save the image" } as const;

function ShareDialog({ detail, summary, filter, titleId, onClose }: Props & { titleId: string; onClose: () => void }) {
  const f = filterValue(filter);
  // Picked at opening: a match landing while the card is open would refetch, and blank it, for the
  // same name.
  const [guid] = useState(() => detail.matches.findLast((m) => m.me !== null)?.guid ?? "");
  // No match of yours to name you from: nothing to fetch, and a disabled query never settles.
  const match = useMatchDetail(guid, guid !== "");
  const settings = useSettings();
  const withMood = settings.remarks && settings.moodLine;
  // Mood off: nothing to fetch, and a disabled query stays pending, so it isn't waited for.
  const remarks = useRemarks(detail.key, filter, withMood);
  const ready = (guid === "" || !match.isPending) && (!withMood || !remarks.isPending);
  // Once drawn, the card stays: a reload greys the buttons rather than unmount it mid-export.
  const [shown, setShown] = useState(false);
  if (ready && !shown) setShown(true);
  const name = match.data?.players.find((p) => p.isMe)?.name ?? null;
  const view = shareCard({ detail, summary, filter, name, mood: withMood ? (remarks.data?.mood.text ?? null) : null, units: settings });
  const card = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  // Keyed on what's missing, so a refetch with the same gap doesn't warn again.
  const nullKey = view.nullStats.join(",");
  useEffect(() => {
    if (nullKey) console.warn("[rlt] share/null_stat", { key: detail.key, filter: f, stats: nullKey.split(",") });
  }, [nullKey, detail.key, f]);
  const noName = ready && name === null;
  const nameError = match.error ? errorText(match.error) : null;
  useEffect(() => {
    if (noName) console.warn("[rlt] share/no_name", { key: detail.key, guid, error: nameError });
  }, [noName, detail.key, guid, nameError]);
  // A failed refetch that leaves the cached mood on the card isn't a missing mood.
  const moodError = remarks.isError && !remarks.data ? errorText(remarks.error) : null;
  useEffect(() => {
    if (moodError !== null) console.warn("[rlt] share/no_mood", { key: detail.key, filter: f, error: moodError });
  }, [moodError, detail.key, f]);

  // Always 3×, whatever the screen's own pixel ratio.
  const render = async (): Promise<Blob> => {
    if (!card.current) throw new Error("no card");
    const blob = await toBlob(card.current, { pixelRatio: 3 });
    if (!blob) throw new Error("empty blob");
    return blob;
  };

  const run = async (kind: Kind) => {
    if (busy) return;
    setBusy(true);
    setStatus("");
    const t0 = performance.now();
    const png = render();
    // Marked as handled now: on a failure it's read again below, since a denied copy can throw
    // before the render has settled, and only the render's outcome tells which step failed.
    png.catch(() => undefined);
    try {
      if (kind === "copy") {
        // The promise goes in as is, so Chrome still counts the write as part of the click.
        await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      } else {
        const url = URL.createObjectURL(await png);
        const a = document.createElement("a");
        a.href = url;
        a.download = shareFilename(detail, filter);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); }, 1000);
      }
      console.info("[rlt] share/export", { kind, ms: Math.round(performance.now() - t0), bytes: (await png).size });
      setStatus(kind === "copy" ? "Copied" : "Saved");
    } catch (e) {
      const [step, error] = await png.then(() => [kind === "copy" ? "clipboard" : "save", e] as const, (r: unknown) => ["render", r] as const);
      console.warn("[rlt] share/export_failed", { kind, step, error: errorText(error), ms: Math.round(performance.now() - t0) });
      setStatus(FAILED[step]);
    } finally {
      setBusy(false);
    }
  };

  const off = !ready || busy;
  return (
    <div className={styles.body}>
      <div className={styles.head}>
        <h2 id={titleId}>Share this session</h2>
        <button type="button" className={styles.close} aria-label="Close" autoFocus onClick={onClose}>×</button>
      </div>
      <div className={styles.frame}>
        {shown ? <Card view={view} cardRef={card} /> : <div className={styles.placeholder} role="status">Making the card…</div>}
      </div>
      <div className={styles.actions}>
        {/* aria-disabled, not disabled: a disabled button drops keyboard focus mid-export. */}
        <button type="button" className={styles.btn} aria-disabled={off} onClick={() => { if (!off) void run("copy"); }}>Copy image</button>
        <button type="button" className={styles.btn} aria-disabled={off} onClick={() => { if (!off) void run("download"); }}>Download PNG</button>
        <span className={styles.status} aria-live="polite">{status}</span>
      </div>
    </div>
  );
}

/** The card's inner width: 360 less 22px padding each side. */
const LINE_W = 316;

function Card({ view, cardRef }: { view: ShareCardView; cardRef: RefObject<HTMLDivElement | null> }) {
  const slot = useRef<HTMLDivElement>(null);
  const [lineH, setLineH] = useState(LINE_MIN);
  // The line takes the height the text leaves: its slot is the card's one growing row, at least
  // LINE_MIN, and the drawing follows the slot's size.
  useLayoutEffect(() => {
    const el = slot.current;
    if (!el) return;
    // Floored, not clientHeight's rounding, which can make the drawing a fraction taller than its slot.
    const fit = () => { setLineH(Math.floor(el.getBoundingClientRect().height)); };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => { ro.disconnect(); };
  }, []);
  const line = formLine(view.results, LINE_W, lineH);
  return (
    <div ref={cardRef} className={styles.card} role="img" aria-label={`${plural(view.wins, "win")}, ${plural(view.losses, "loss", "losses")}${view.label === null ? "" : ` · ${view.label}`}`}>
      <div className={styles.top}>
        <div className={styles.meta}>
          {view.name !== null && <b data-part="name">{view.name}</b>}
          {view.when}
          {view.live && <> <span className={styles.live}>● live</span></>}
        </div>
        {view.label !== null && <span className={styles.pill} data-part="pill">{view.label}</span>}
      </div>
      <div className={cx(styles.hero, view.smallRecord && styles.small)}>
        <div className={cx(styles.rec, "num")}>
          <span className={styles.w}>{view.wins}</span><span className={styles.dash}>–</span><span className={styles.l}>{view.losses}</span>
        </div>
        {view.winPct !== null && <div className={styles.pct}><b className="num">{view.winPct}%</b>win rate</div>}
      </div>
      <div ref={slot} className={styles.slot} style={{ minHeight: LINE_MIN }}>
        <svg className={styles.line} width={LINE_W} height={lineH} viewBox={`0 0 ${String(LINE_W)} ${String(lineH)}`} data-part="line">
          <line className={styles.zero} x1={PAD} x2={LINE_W - PAD} y1={line.zeroY} y2={line.zeroY} />
          <polyline className={styles.path} points={line.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} />
          {line.dots.map((d, i) => <circle key={i} className={styles[d.kind]} cx={d.x} cy={d.y} r={d.kind === "none" ? d.r * 0.9 : d.r} />)}
        </svg>
      </div>
      {/* Unquoted, as on the Overview: some lines open with a quote of their own. */}
      {view.mood !== null && <div className={styles.mood} data-part="mood">{view.mood}</div>}
      <div className={styles.grid}>
        {view.tiles.map((t) => (
          <div key={t.id} className={styles.tile} data-tile={t.id}>
            <div className={cx(styles.v, "num")}>{t.value}</div>
            <div className={styles.k}>{t.label}</div>
            {t.sub !== null && <div className={styles.s}>{t.sub}</div>}
          </div>
        ))}
      </div>
      {view.stood && <div className={styles.callout}><b>{view.stood.label}:</b> {view.stood.text}</div>}
      <div className={styles.bottom}><div className={styles.footer} data-part="footer">RL Tracker</div></div>
    </div>
  );
}
