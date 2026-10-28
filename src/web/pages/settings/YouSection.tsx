// Settings › You: the players the tracker counts as you. A match's camera player is added as a
// pending guess, which counts as you until it's answered here. Rows stay in the order they were
// added, so a row never moves when answered.
import { useEffect, useId, useRef } from "react";
import type { IdRow } from "../../../shared/schemas/responses";
import type { IdAnswer } from "../../../shared/schemas/tables";
import { useIds, useSetIdStatus } from "../../queries";
import { codeOf, SaveStatus, Section, TableState } from "./parts";
import styles from "./Settings.module.css";

const STATUS: Record<IdRow["status"], string> = { pending: "Waiting for you", confirmed: "You", rejected: "Not you" };

/** The answers a row offers: a guess both, an answered row the other one. */
const ANSWERS: Record<IdRow["status"], readonly IdAnswer[]> = { pending: ["confirmed", "rejected"], confirmed: ["rejected"], rejected: ["confirmed"] };
const ANSWER_TEXT: Record<IdAnswer, string> = { confirmed: "That's me", rejected: "Not me" };

function IdLine({ row }: { row: IdRow }) {
  const m = useSetIdStatus();
  const nameId = useId();
  const actions = useRef<HTMLDivElement>(null);
  const answer = (status: IdAnswer) => {
    m.mutate(
      { id: row.primaryId, status },
      { onError: (error) => { console.warn("[rlt] ids/save_failed", { code: codeOf(error) }); } },
    );
  };
  // The clicked button is gone once the answer lands (and a working Retry disappears), so focus
  // moves to the button the row has left.
  useEffect(() => {
    if (m.isSuccess) actions.current?.querySelector("button")?.focus();
  }, [m.isSuccess, m.submittedAt]);
  const retry = () => { if (m.variables) answer(m.variables.status); };
  return (
    <li className={styles.row}>
      <div className={styles.text}>
        <div className={styles.label}>
          <span id={nameId}>{row.name ?? <span className={styles.muted}>No name</span>}</span>
          {row.status === "pending" ? <span className={styles.badge}>{STATUS.pending}</span> : <span className={styles.muted}>{STATUS[row.status]}</span>}
          <SaveStatus m={m} retry={retry} />
        </div>
        <div className={styles.help}>{row.platform}</div>
      </div>
      <div className={styles.actions} ref={actions}>
        {ANSWERS[row.status].map((status) => (
          <button key={status} type="button" className={styles.button} aria-describedby={nameId} onClick={() => { answer(status); }}>
            {ANSWER_TEXT[status]}
          </button>
        ))}
      </div>
    </li>
  );
}

export function YouSection() {
  const q = useIds();
  const nobody = q.data !== undefined && !q.data.some((r) => r.status !== "rejected");
  return (
    <Section
      anchor="you"
      title="You"
      intro="Which players are you. The tracker guesses after a match from whose view the camera follows; pending guesses count as you until you answer."
      note={nobody && <p className={styles.warning}>No player is you yet. The tracker will ask after your next match.</p>}
    >
      {q.data ? (
        q.data.length > 0 && <ul className={styles.list}>{q.data.map((row) => <IdLine key={row.primaryId} row={row} />)}</ul>
      ) : (
        <TableState what="your players" failed={q.isError} retry={() => { void q.refetch(); }} />
      )}
    </Section>
  );
}
