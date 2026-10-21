import { NavLink } from "react-router";
import { cx } from "./cx";
import styles from "./Header.module.css";
import { QuitButton, StartSessionButton } from "./HeaderActions";
import { SessionChip } from "./SessionChip";
import { StatusBadge } from "./StatusBadge";

const tab = ({ isActive }: { isActive: boolean }) => cx(styles.tab, isActive && styles.active);
const settings = ({ isActive }: { isActive: boolean }) => cx(styles.hbtn, isActive && styles.current);

export function Header() {
  return (
    <header className={styles.header}>
      <div className={styles.bar}>
        <span className={styles.brand}>RL Tracker</span>
        <nav className={styles.topnav} aria-label="Pages">
          <NavLink to="/recap" className={tab}>Recap</NavLink>
          <NavLink to="/trends" className={tab}>Trends</NavLink>
        </nav>
        <div className={styles.right}>
          <StatusBadge />
          <SessionChip />
          <StartSessionButton />
          <NavLink to="/settings" className={settings}>Settings</NavLink>
          <QuitButton />
        </div>
      </div>
    </header>
  );
}
