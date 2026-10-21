import { useEffect, useReducer, useRef } from "react";
import { confirmStep, type ConfirmState } from "../logic/confirm";
import styles from "./Header.module.css";

const REVERT_MS = 5000;

interface Props {
  label: string;
  question: string;
  failText: string;
  /** Announced (politely) after a successful send. */
  doneText?: string;
  /** Rejects on failure; the button then shows failText for a few seconds. */
  onConfirm: () => Promise<void>;
  /** Set when the action can't run now: the button is disabled with this tooltip, and an open confirm is cancelled. */
  disabledReason?: string | undefined;
}

/** A header action that asks first: the first click turns into "question? Yes · Cancel". */
export function ConfirmButton({ label, question, failText, doneText, onConfirm, disabledReason }: Props) {
  const disabled = disabledReason !== undefined;
  const [state, dispatch] = useReducer(confirmStep, "idle" satisfies ConfirmState);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const yesRef = useRef<HTMLButtonElement>(null);
  const groupRef = useRef<HTMLSpanElement>(null);
  const prevRef = useRef<ConfirmState>(state);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = state;
    if (state === "confirming") yesRef.current?.focus();
    // Leaving the confirm unmounts Yes; put focus back where it came from.
    const asking = (s: ConfirmState) => s === "confirming" || s === "sending";
    if (asking(prev) && !asking(state)) {
      const focus = document.activeElement;
      if (focus === document.body || groupRef.current?.contains(focus)) triggerRef.current?.focus();
    }
    if (state === "idle" || state === "sending") return;
    const timer = setTimeout(() => { dispatch("timeout"); }, REVERT_MS);
    return () => { clearTimeout(timer); };
  }, [state]);

  useEffect(() => {
    if (disabled && state === "confirming") dispatch("cancel");
  }, [disabled, state]);

  const confirm = () => {
    dispatch("confirm");
    onConfirm().then(
      () => { dispatch("sent"); },
      () => { dispatch("failed"); },
    );
  };

  if (state === "confirming" || state === "sending") {
    return (
      <span
        ref={groupRef}
        className={styles.confirm}
        role="group"
        aria-label={question}
        onKeyDown={(e) => { if (e.key === "Escape") dispatch("cancel"); }}
      >
        <span>{question}</span>
        <button ref={yesRef} type="button" className={styles.hbtn} disabled={state === "sending"} onClick={confirm}>Yes</button>
        <button type="button" className={styles.hbtn} disabled={state === "sending"} onClick={() => { dispatch("cancel"); }}>Cancel</button>
      </span>
    );
  }
  return (
    <span ref={groupRef} className={styles.confirm}>
      {/* aria-disabled, not disabled: a disabled button drops focus, as Start new session does after its own send. */}
      <button
        ref={triggerRef}
        type="button"
        className={styles.hbtn}
        aria-disabled={disabled}
        title={disabledReason}
        onClick={() => { if (!disabled) dispatch("ask"); }}
      >
        {label}
      </button>
      {/* Present before its text arrives, so screen readers announce the change. */}
      <span className={styles.note} role="status">{state === "done" ? doneText : ""}</span>
      {state === "failed" && <span className={styles.fail} role="alert">{failText}</span>}
    </span>
  );
}
