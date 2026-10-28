// Settings › Seasons: the season table, edited in place. Rocket League doesn't tell the tracker when
// a season starts, so each new one is added here. One row edits at a time; Enter saves, Esc cancels.
// After each change focus lands on what's left to act on (the row's Edit, the next row, or "+ Add").
// While a save or delete is on its way every action waits, so no answer lands on a row it wasn't for.
import { useEffect, useId, useRef, useState, type SyntheticEvent } from "react";
import { dayOf, type Season } from "../../../shared/periods";
import { seasonConflict } from "../../../shared/schemas/responses";
import { SEASON_NAME_MAX, seasonInput } from "../../../shared/schemas/tables";
import { ApiError } from "../../api";
import { useNow } from "../../components/useNow";
import { dateLabel } from "../../logic/format";
import { conflictError, seasonErrors, seasonRows, type SeasonDraft, type SeasonErrors, type SeasonRow } from "../../logic/seasons";
import { useDeleteSeason, useSaveSeason, useSeasons } from "../../queries";
import { codeOf, SaveStatus, Section, TableState } from "./parts";
import styles from "./Settings.module.css";

/** The row being edited: `id` null is a new one. `failed` is a save that got no answer, or not a clash. */
interface Editing {
  id: number | null;
  draft: SeasonDraft;
  errors: SeasonErrors;
  failed: boolean;
}

const NAME = '[data-field="name"]';
const START = '[data-field="start"]';
const ADD = "[data-add]";
const editOf = (id: number) => `[data-edit="${String(id)}"]`;

function span(row: SeasonRow, last: boolean): string {
  if (!last) return `${dateLabel(row.startDate)} – ${dateLabel(row.end ?? row.startDate)}`;
  return row.state === "upcoming" ? `Starts ${dateLabel(row.startDate)}` : `From ${dateLabel(row.startDate)}, still running`;
}

function SeasonView({ row, last, locked, saved, failed, onEdit, onDelete }: { row: SeasonRow; last: boolean; locked: boolean; saved: number | null; failed: boolean; onEdit: () => void; onDelete: () => void }) {
  const nameId = useId();
  return (
    <li className={styles.row}>
      <div className={styles.text}>
        <div className={styles.label}>
          <span id={nameId}>{row.name}</span>
          {row.state === "current" && <span className={styles.badge}>current</span>}
          <SaveStatus m={{ isSuccess: saved !== null, isError: failed, submittedAt: saved ?? 0 }} retry={onDelete} />
        </div>
        <div className={styles.help}>{span(row, last)}</div>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.button} data-edit={row.id} aria-describedby={nameId} disabled={locked} onClick={onEdit}>Edit</button>
        <button type="button" className={styles.button} aria-describedby={nameId} disabled={locked} onClick={onDelete}>Delete</button>
      </div>
    </li>
  );
}

function SeasonEditor({ editing, pending, onChange, onSave, onCancel }: { editing: Editing; pending: boolean; onChange: (draft: SeasonDraft) => void; onSave: () => void; onCancel: () => void }) {
  const id = useId();
  const { draft, errors } = editing;
  const errId = (field: keyof SeasonDraft) => (errors[field] ? `${id}-${field}-err` : undefined);
  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    onSave();
  };
  return (
    <li className={styles.row}>
      <form
        className={styles.editor}
        noValidate
        aria-label={editing.id === null ? "New season" : "Edit season"}
        onSubmit={submit}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !pending) onCancel();
        }}
      >
        <div className={styles.fields}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Name</span>
            <input
              data-field="name"
              className={styles.input}
              value={draft.name}
              maxLength={SEASON_NAME_MAX}
              autoComplete="off"
              aria-invalid={errors.name !== undefined}
              aria-describedby={errId("name")}
              onChange={(e) => { onChange({ ...draft, name: e.target.value }); }}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Starts</span>
            <input
              data-field="start"
              type="date"
              className={styles.input}
              value={draft.start}
              aria-invalid={errors.start !== undefined}
              aria-describedby={errId("start")}
              onChange={(e) => { onChange({ ...draft, start: e.target.value }); }}
            />
          </label>
          <div className={styles.actions}>
            <button type="submit" className={styles.button} disabled={pending}>Save</button>
            <button type="button" className={styles.button} disabled={pending} onClick={onCancel}>Cancel</button>
            <SaveStatus m={{ isSuccess: false, isError: editing.failed && !pending, submittedAt: 0 }} retry={onSave} />
          </div>
        </div>
        {errors.name && <div id={errId("name")} className={styles.error}>{errors.name}</div>}
        {errors.start && <div id={errId("start")} className={styles.error}>{errors.start}</div>}
      </form>
    </li>
  );
}

function Table({ seasons, del }: { seasons: Season[]; del: ReturnType<typeof useDeleteSeason> }) {
  const save = useSaveSeason();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saved, setSaved] = useState<{ id: number; at: number } | null>(null);
  const [deleteFailed, setDeleteFailed] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // Where focus goes once the render a change causes is on screen: a selector inside the table.
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    if (focusNext.current === null) return;
    box.current?.querySelector<HTMLElement>(focusNext.current)?.focus();
    focusNext.current = null;
  });

  const rows = seasonRows(seasons, dayOf(useNow()));
  const busy = save.isPending || del.isPending;
  const locked = editing !== null || busy;

  const edit = (row: Season | null) => {
    if (busy) return;
    setDeleteFailed(null);
    setEditing({ id: row?.id ?? null, draft: { name: row?.name ?? "", start: row?.startDate ?? "" }, errors: {}, failed: false });
    focusNext.current = NAME;
  };
  const cancel = () => {
    if (editing === null || busy) return;
    focusNext.current = editing.id === null ? ADD : editOf(editing.id);
    setEditing(null);
  };
  // A field's error goes once it's changed; the rest wait for the next save.
  const change = (draft: SeasonDraft) => {
    setEditing((e) => {
      if (!e) return e;
      const errors = { ...e.errors };
      if (draft.name !== e.draft.name) delete errors.name;
      if (draft.start !== e.draft.start) delete errors.start;
      return { ...e, draft, errors, failed: false };
    });
  };
  const showErrors = (errors: SeasonErrors) => {
    setEditing((e) => e && { ...e, errors, failed: false });
    focusNext.current = errors.name ? NAME : START;
  };

  async function submit() {
    if (editing === null || busy) return;
    const errors = seasonErrors(seasons, editing.draft, editing.id ?? undefined);
    if (Object.keys(errors).length > 0) {
      showErrors(errors);
      return;
    }
    const input = seasonInput.parse(editing.draft);
    setEditing((e) => e && { ...e, failed: false });
    try {
      const answer = await save.mutateAsync({ id: editing.id, input });
      // Start days are unique, so the start finds the saved row, a new one included.
      const row = answer.seasons.find((s) => s.startDate === input.start);
      setEditing(null);
      if (row) {
        setSaved({ id: row.id, at: Date.now() });
        focusNext.current = editOf(row.id);
      }
    } catch (error) {
      const clash = error instanceof ApiError ? seasonConflict.shape.error.safeParse(error.code) : undefined;
      if (clash?.success) {
        showErrors(conflictError(clash.data, seasons, editing.draft));
        return;
      }
      console.warn("[rlt] seasons/save_failed", { action: editing.id === null ? "add" : "edit", code: codeOf(error) });
      setEditing((e) => e && { ...e, failed: true });
    }
  }

  async function remove(row: SeasonRow, next: SeasonRow | undefined) {
    if (busy) return;
    setDeleteFailed(null);
    try {
      await del.mutateAsync(row.id);
      focusNext.current = next ? editOf(next.id) : ADD;
    } catch (error) {
      console.warn("[rlt] seasons/save_failed", { action: "delete", code: codeOf(error) });
      setDeleteFailed(row.id);
    }
  }

  const editor = editing && (
    <SeasonEditor key={editing.id ?? "new"} editing={editing} pending={save.isPending} onChange={change} onSave={() => { void submit(); }} onCancel={cancel} />
  );

  return (
    <div ref={box}>
      {(rows.length > 0 || editing?.id === null) && (
        <ul className={styles.list}>
          {rows.map((row, i) =>
            editing?.id === row.id ? (
              editor
            ) : (
              <SeasonView
                key={row.id}
                row={row}
                last={i === rows.length - 1}
                locked={locked}
                saved={saved?.id === row.id ? saved.at : null}
                failed={deleteFailed === row.id}
                onEdit={() => { edit(row); }}
                onDelete={() => { void remove(row, rows[i + 1]); }}
              />
            ),
          )}
          {editing?.id === null && editor}
        </ul>
      )}
      <div className={styles.addRow}>
        <button type="button" className={styles.button} data-add disabled={locked} onClick={() => { edit(null); }}>+ Add</button>
      </div>
    </div>
  );
}

export function SeasonsSection() {
  const q = useSeasons();
  // Here, not in the table: a deleted row's "✓ Saved" shows by the heading, as the row is gone.
  const del = useDeleteSeason();
  return (
    <Section
      anchor="seasons"
      title="Seasons"
      intro="Rocket League doesn't tell the tracker when a season starts. Add each new one here."
      status={<SaveStatus m={{ isSuccess: del.isSuccess, isError: false, submittedAt: del.submittedAt }} />}
    >
      {q.data ? <Table seasons={q.data} del={del} /> : <TableState what="the seasons" failed={q.isError} retry={() => { void q.refetch(); }} />}
    </Section>
  );
}
