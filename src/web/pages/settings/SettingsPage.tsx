// The Settings page: Appearance, Defaults and Remarks, one row per setting. Each change saves at
// once and the row says so ("✓ Saved", or "Couldn't save · Retry"); controls show the stored value,
// so a failed save leaves the old one. Each section resets to its defaults.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { groupFilter, THEMES, type SectionId, type Settings, type SettingsPatch } from "../../../shared/schemas/settings";
import { ApiError } from "../../api";
import { cx } from "../../components/cx";
import { EmptyState } from "../../components/EmptyState";
import { filterLabel } from "../../logic/filter-options";
import { SPEED_LABEL } from "../../logic/format";
import { atDefaults, parseWindow, sectionDefaults } from "../../logic/settings";
import { useSaveSettings, useSettingsQuery } from "../../queries";
import styles from "./Settings.module.css";

type Save = ReturnType<typeof useSaveSettings>;

const codeOf = (e: unknown) => (e instanceof ApiError ? e.code : String(e));

/** One save's state for a row or a section: a fresh mutation each, so their ticks don't mix. */
function useSave(onSaved?: () => void) {
  const m = useSaveSettings();
  const save = (patch: SettingsPatch, onFailed?: () => void) => {
    m.mutate(patch, {
      onSuccess: () => onSaved?.(),
      onError: (error) => {
        console.warn("[rlt] settings/save_failed", { keys: Object.keys(patch), code: codeOf(error) });
        onFailed?.();
      },
    });
  };
  return { m, save };
}

/** "✓ Saved" (fading), or "Couldn't save · Retry"; the live region is there from the start so each is announced. */
function SaveStatus({ m, retry }: { m: Save; retry: () => void }) {
  return (
    <span className={styles.status} role="status">
      {m.isSuccess && <span key={m.submittedAt} className={styles.tick}>✓ Saved</span>}
      {m.isError && (
        <span className={styles.failed}>
          Couldn't save · <button type="button" className={styles.link} onClick={retry}>Retry</button>
        </span>
      )}
    </span>
  );
}

function Row({ label, help, htmlFor, labelId, children }: { label: string; help?: string; htmlFor?: string; labelId: string; children: (save: (p: SettingsPatch, onFailed?: () => void) => void) => ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const retried = useRef(false);
  const { m, save } = useSave();
  // A Retry that works disappears; focus goes back to the control it saved, once it shows the new value.
  useEffect(() => {
    if (!m.isSuccess || !retried.current) return;
    retried.current = false;
    const box = row.current;
    (box?.querySelector<HTMLElement>("input:checked") ?? box?.querySelector<HTMLElement>("select, input"))?.focus();
  }, [m.isSuccess]);
  const retry = () => {
    if (m.variables === undefined) return;
    retried.current = true;
    save(m.variables);
  };
  return (
    <div className={styles.row} ref={row}>
      <div className={styles.text}>
        <div className={styles.label}>
          {htmlFor ? <label id={labelId} htmlFor={htmlFor}>{label}</label> : <span id={labelId}>{label}</span>}
          <SaveStatus m={m} retry={retry} />
        </div>
        {help && <div className={styles.help}>{help}</div>}
      </div>
      <div className={styles.control}>{children(save)}</div>
    </div>
  );
}

/** Native radios drawn as segments (or swatches): arrow keys and the group's name come free. */
function Choice<V extends string>({ labelId, name, value, options, onPick, swatch = false }: { labelId: string; name: string; value: V; options: readonly (readonly [V, string])[]; onPick: (v: V) => void; swatch?: boolean }) {
  return (
    <div role="radiogroup" aria-labelledby={labelId} className={swatch ? styles.swatches : styles.seg}>
      {options.map(([v, text]) => (
        <label key={v} className={swatch ? styles.swatch : undefined}>
          <input type="radio" className={styles.radio} name={name} value={v} checked={value === v} onChange={() => { onPick(v); }} />
          {swatch && (
            <span className={styles.chip} data-theme={v} aria-hidden="true">
              <i />
              <b />
            </span>
          )}
          <span className={styles.choiceText}>{text}</span>
        </label>
      ))}
    </div>
  );
}

function Switch({ labelId, checked, disabled = false, onToggle }: { labelId: string; checked: boolean; disabled?: boolean; onToggle: (on: boolean) => void }) {
  return <input type="checkbox" role="switch" className={styles.switch} aria-labelledby={labelId} checked={checked} disabled={disabled} onChange={(e) => { onToggle(e.target.checked); }} />;
}

/**
 * Typed, then saved on Enter or leaving the field; Esc puts the stored value back. Any settings write
 * that changes them (a save or a reset: `from` is a new object; a refetch with nothing new keeps it)
 * puts the draft back to the stored value too, and so does a failed save.
 * Not remounted on a save, so focus stays in the field.
 */
function WindowInput({ id, stored, from, onSave }: { id: string; stored: number; from: Settings; onSave: (n: number, onFailed: () => void) => void }) {
  const [draft, setDraft] = useState(String(stored));
  const [error, setError] = useState<string | null>(null);
  const [synced, setSynced] = useState(from);
  const revert = () => {
    setDraft(String(stored));
    setError(null);
  };
  if (synced !== from) {
    setSynced(from);
    revert();
  }
  const errId = `${id}-err`;
  const commit = () => {
    const parsed = parseWindow(draft);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    if (parsed.value !== stored) onSave(parsed.value, revert);
  };
  return (
    <div>
      <input
        id={id}
        className={styles.number}
        type="number"
        min={5}
        max={100}
        step={1}
        value={draft}
        aria-invalid={error !== null}
        aria-describedby={error === null ? undefined : errId}
        onChange={(e) => { setDraft(e.target.value); }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") revert();
        }}
      />{" "}
      <span className={styles.muted}>matches</span>
      {error && <div id={errId} className={styles.error}>{error}</div>}
    </div>
  );
}

function FilterSelect({ id, value, onPick }: { id: string; value: Settings["recapFilter"]; onPick: (f: Settings["recapFilter"]) => void }) {
  return (
    <select id={id} className={styles.select} value={value} onChange={(e) => { onPick(groupFilter.parse(e.target.value)); }}>
      {groupFilter.options.map((f) => <option key={f} value={f}>{filterLabel(f)}</option>)}
    </select>
  );
}

function Section({ id, title, intro, s, children }: { id: SectionId; title: string; intro: string; s: Settings; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  // The link turns into "Defaults" as the reset lands, so focus moves to the section's heading.
  const { m, save } = useSave(() => heading.current?.focus());
  const reset = () => { save(sectionDefaults(id)); };
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <div className={styles.head}>
        <h2 id={headingId} ref={heading} tabIndex={-1} className={styles.h2}>{title}</h2>
        {atDefaults(s, id) ? <span className={styles.muted}>Defaults</span> : <button type="button" className={styles.link} onClick={reset}>Reset to defaults</button>}
        <SaveStatus m={m} retry={reset} />
      </div>
      <p className={styles.intro}>{intro}</p>
      <div className={styles.card}>{children}</div>
    </section>
  );
}

const THEME_NAMES: Record<Settings["theme"], string> = { carbon: "Carbon", slate: "Slate", oled: "OLED" };

function Form({ s }: { s: Settings }) {
  const ids = useId();
  const id = (k: string) => `${ids}-${k}`;
  return (
    <>
      <Section id="appearance" title="Appearance" intro="How the dashboard looks." s={s}>
        <Row label="Theme" labelId={id("theme")}>
          {(save) => <Choice swatch labelId={id("theme")} name="theme" value={s.theme} options={THEMES.map((t) => [t, THEME_NAMES[t]] as const)} onPick={(theme) => { save({ theme }); }} />}
        </Row>
        <Row label="Clock" help="12- or 24-hour times." labelId={id("clock")}>
          {(save) => <Choice labelId={id("clock")} name="clock" value={s.clock} options={[["24h", "24h"], ["12h", "12h"]]} onPick={(clock) => { save({ clock }); }} />}
        </Row>
        <Row label="Speed" help="Hardest shot, fastest goal and the goal map." labelId={id("speed")}>
          {(save) => <Choice labelId={id("speed")} name="speed" value={s.speed} options={[["kmh", SPEED_LABEL.kmh], ["mph", SPEED_LABEL.mph]]} onPick={(speed) => { save({ speed }); }} />}
        </Row>
      </Section>
      <Section id="defaults" title="Defaults" intro="What a page shows when you open it." s={s}>
        <Row label="Start page" help="Where the dashboard opens." labelId={id("start")}>
          {(save) => <Choice labelId={id("start")} name="startPage" value={s.startPage} options={[["recap", "Recap"], ["trends", "Trends"]]} onPick={(startPage) => { save({ startPage }); }} />}
        </Row>
        <Row label="Recap playlist" help="The recap's filter when you open it." htmlFor={id("recapFilter")} labelId={id("recapFilterL")}>
          {(save) => <FilterSelect id={id("recapFilter")} value={s.recapFilter} onPick={(recapFilter) => { save({ recapFilter }); }} />}
        </Row>
        <Row label="Trends playlist" help="The Trends filter when you open it." htmlFor={id("trendsFilter")} labelId={id("trendsFilterL")}>
          {(save) => <FilterSelect id={id("trendsFilter")} value={s.trendsFilter} onPick={(trendsFilter) => { save({ trendsFilter }); }} />}
        </Row>
        <Row label="Trends rolling window" help="Matches per point when Trends is “By match”. 5–100." htmlFor={id("window")} labelId={id("windowL")}>
          {(save) => <WindowInput id={id("window")} stored={s.rollingWindow} from={s} onSave={(rollingWindow, onFailed) => { save({ rollingWindow }, onFailed); }} />}
        </Row>
      </Section>
      <Section id="remarks" title="Remarks" intro="The mood line and quip under the recap scorebug." s={s}>
        <Row label="Remarks" help="The mood line and quip, on the recap and the share card." labelId={id("remarks")}>
          {(save) => <Switch labelId={id("remarks")} checked={s.remarks} onToggle={(remarks) => { save({ remarks }); }} />}
        </Row>
        <div className={cx(!s.remarks && styles.off)}>
          <Row label="Mood line" help="How the night went, no numbers." labelId={id("mood")}>
            {(save) => <Switch labelId={id("mood")} checked={s.moodLine} disabled={!s.remarks} onToggle={(moodLine) => { save({ moodLine }); }} />}
          </Row>
        </div>
      </Section>
    </>
  );
}

export function SettingsPage() {
  // App logs a failed load (settings/load_failed).
  const q = useSettingsQuery();
  return (
    <div className={styles.page}>
      <h1 className="visually-hidden">Settings</h1>
      {q.data ? (
        <Form s={q.data} />
      ) : (
        <EmptyState title="Couldn't load your settings.">
          <p>The other pages use the defaults meanwhile. <button type="button" className={styles.link} onClick={() => { void q.refetch(); }}>Retry</button></p>
        </EmptyState>
      )}
    </div>
  );
}
