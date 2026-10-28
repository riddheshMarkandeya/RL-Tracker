import { Link } from "react-router";
import { EmptyState } from "../components/EmptyState";

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
