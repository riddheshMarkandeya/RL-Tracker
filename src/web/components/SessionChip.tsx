import { chipText } from "../logic/chip";
import { cx } from "./cx";
import styles from "./Header.module.css";
import { useCurrentSession } from "./queries";

export function SessionChip() {
  const text = chipText(useCurrentSession().data);
  return text ? <span className={cx(styles.chip, "num")}>{text}</span> : null;
}
