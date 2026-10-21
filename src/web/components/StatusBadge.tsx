import { useLive } from "../events/live";
import { statusLabel } from "../logic/status";
import styles from "./Header.module.css";

export function StatusBadge() {
  const { label, tone } = statusLabel(useLive());
  return (
    <span className={styles.status} role="status">
      <i className={styles[tone]} aria-hidden="true" />
      {label}
    </span>
  );
}
