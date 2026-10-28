import { useEffect, useState } from "react";
import { cx } from "./cx";
import styles from "./Loading.module.css";

const LOADING_DELAY_MS = 150;

/** The pulse and its announcement show only past a short delay, so a quick load doesn't flash. */
export function Loading({ label, className }: { label: string; className?: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => { setShown(true); }, LOADING_DELAY_MS);
    return () => { clearTimeout(t); };
  }, []);
  // The live region is there from the start, so the text added to it is announced.
  return (
    <div className={cx(styles.loading, className)} role="status">
      {shown && <><div className={styles.pulse} /><span className="visually-hidden">{label}</span></>}
    </div>
  );
}
