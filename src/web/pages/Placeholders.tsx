import { Link } from "react-router";
import { EmptyState } from "../components/EmptyState";

// Each page's content arrives with its own work package; until then it says so plainly.

export function RecapPage() {
  return <EmptyState title="Session recaps are coming in the next update." />;
}

export function TrendsPage() {
  return <EmptyState title="Trends are coming in a later update." />;
}

export function SettingsPage() {
  return <EmptyState title="Settings are coming in a later update." />;
}

export function NotFoundPage() {
  return (
    <EmptyState title="There's no page here.">
      <p><Link to="/recap">Go to the recap</Link></p>
    </EmptyState>
  );
}
