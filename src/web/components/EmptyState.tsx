import type { ReactNode } from "react";
import styles from "./EmptyState.module.css";

/** A page or panel with nothing to say yet: a short note, never zeros. */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <p className={styles.title}>{title}</p>
      {children && <div className={styles.body}>{children}</div>}
    </div>
  );
}
