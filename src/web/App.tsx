import { Navigate, Route, Routes } from "react-router";
import { Header } from "./components/Header";
import { useLiveEvents } from "./events/useLiveEvents";
import { NotFoundPage, SettingsPage, TrendsPage } from "./pages/Placeholders";
import { RecapIndex, RecapSession } from "./pages/recap/RecapPage";

export function App() {
  useLiveEvents();
  return (
    <>
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/recap" replace />} />
          <Route path="/recap" element={<RecapIndex />} />
          <Route path="/recap/:session" element={<RecapSession />} />
          <Route path="/trends" element={<TrendsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </>
  );
}
