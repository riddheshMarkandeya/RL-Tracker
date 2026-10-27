import { Link } from "react-router";
import { EmptyState } from "../components/EmptyState";

// Each page's content arrives with its own work package; until then it says so plainly.

export function TrendsPage() {
  return (
    <>
      <h1 className="visually-hidden">Trends</h1>
      <EmptyState title="Trends are coming in a later update." />
    </>
  );
}

export function SettingsPage() {
  return (
    <>
      <h1 className="visually-hidden">Settings</h1>
      <EmptyState title="Settings are coming in a later update." />
    </>
  );
}

export function NotFoundPage() {
  return (
    <>
      <h1 className="visually-hidden">Page not found</h1>
      <EmptyState title="There's no page here.">
        <p><Link to="/recap">Go to the recap</Link></p>
      </EmptyState>
    </>
  );
}
