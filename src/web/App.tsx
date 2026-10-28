import { Navigate, Route, Routes } from "react-router";
import { Header } from "./components/Header";
import { useLiveEvents } from "./events/useLiveEvents";
import { NotFoundPage, SettingsPage } from "./pages/Placeholders";
import { RecapIndex, RecapSession } from "./pages/recap/RecapPage";
import { TrendsPage } from "./pages/trends/TrendsPage";

export function App() {
  useLiveEvents();
  return (
    <>
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/recap" replace />} />
          <Route path="/recap" element={<RecapIndex />} />
          {/* One component for a session's three pages, so moving between them keeps it mounted. */}
          <Route path="/recap/:session" element={<RecapSession view="overview" />} />
          <Route path="/recap/:session/matches" element={<RecapSession view="matches" />} />
          <Route path="/recap/:session/match/:guid" element={<RecapSession view="match" />} />
          <Route path="/trends" element={<TrendsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </>
  );
}
