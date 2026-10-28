// The pieces every Settings section shares: the section frame with its anchor and optional reset,
// and the "✓ Saved" / "Couldn't save · Retry" status.
import { useRef, type ReactNode } from "react";
import type { SectionId, Settings, SettingsPatch } from "../../../shared/schemas/settings";
import { ApiError } from "../../api";
import { atDefaults, sectionDefaults } from "../../logic/settings";
import { useSaveSettings } from "../../queries";
import styles from "./Settings.module.css";

export const codeOf = (e: unknown) => (e instanceof ApiError ? e.code : String(e));

/** One save's state for a row or a section: a fresh mutation each, so their ticks don't mix. */
export function useSave(onSaved?: () => void) {
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

/** What a status shows: a mutation, or a table row's own state. `submittedAt` restarts the tick's fade. */
export interface SaveState {
  isSuccess: boolean;
  isError: boolean;
  submittedAt: number;
}

/** "✓ Saved" (fading), or "Couldn't save · Retry"; the live region is there from the start so each is announced. */
export function SaveStatus({ m, retry }: { m: SaveState; retry?: () => void }) {
  return (
    <span className={styles.status} role="status">
      {m.isSuccess && <span key={m.submittedAt} className={styles.tick}>✓ Saved</span>}
      {m.isError && retry && (
        <span className={styles.failed}>
          Couldn't save · <button type="button" className={styles.link} onClick={retry}>Retry</button>
        </span>
      )}
    </span>
  );
}

function ResetLink({ id, s, onSaved }: { id: SectionId; s: Settings; onSaved: () => void }) {
  const { m, save } = useSave(onSaved);
  const reset = () => { save(sectionDefaults(id)); };
  return (
    <>
      {atDefaults(s, id) ? <span className={styles.muted}>Defaults</span> : <button type="button" className={styles.link} onClick={reset}>Reset to defaults</button>}
      <SaveStatus m={m} retry={reset} />
    </>
  );
}

/** The page's sections in order, as the section list links them: anchor and title. */
export const SECTIONS = [
  ["appearance", "Appearance"],
  ["defaults", "Defaults"],
  ["remarks", "Remarks"],
  ["you", "You"],
  ["seasons", "Seasons"],
] as const;

/**
 * A section, its h2 the target of the page's section links (`anchor` is the h2's id). A settings
 * section passes `reset`; the tables have none (it would forget who you are, or delete your rows).
 */
export function Section({ anchor, title, intro, reset, status, note, children }: { anchor: (typeof SECTIONS)[number][0]; title: string; intro: string; reset?: { id: SectionId; s: Settings }; status?: ReactNode; note?: ReactNode; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <section className={styles.section} aria-labelledby={anchor}>
      <div className={styles.head}>
        <h2 id={anchor} ref={heading} tabIndex={-1} className={styles.h2}>{title}</h2>
        {/* The link turns into "Defaults" as the reset lands, so focus moves to the section's heading. */}
        {reset && <ResetLink id={reset.id} s={reset.s} onSaved={() => heading.current?.focus()} />}
        {status}
      </div>
      <p className={styles.intro}>{intro}</p>
      {note}
      {children !== false && <div className={styles.card}>{children}</div>}
    </section>
  );
}

/** A table's load: "Loading…", or "Couldn't load … · Retry" (the rest of the page still works). */
export function TableState({ what, failed, retry }: { what: string; failed: boolean; retry: () => void }) {
  return (
    <p className={styles.row} role="status">
      {failed ? (
        <span>
          Couldn't load {what}. <button type="button" className={styles.link} onClick={retry}>Retry</button>
        </span>
      ) : (
        <span className={styles.muted}>Loading…</span>
      )}
    </p>
  );
}
