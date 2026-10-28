import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router";
import { Header } from "./components/Header";
import { Loading } from "./components/Loading";
import { useLiveEvents } from "./events/useLiveEvents";
import { rememberTheme } from "./logic/settings";
import { NotFoundPage } from "./pages/Placeholders";
import { RecapIndex, RecapSession } from "./pages/recap/RecapPage";
import { SettingsPage } from "./pages/settings/SettingsPage";
import { TrendsPage } from "./pages/trends/TrendsPage";
import { useSettings, useSettingsQuery } from "./queries";

/** Applies the theme once it's known; a failed load keeps the theme index.html put back. */
function useTheme() {
  const { data, error } = useSettingsQuery();
  const theme = data?.theme;
  useEffect(() => {
    if (theme === undefined) return;
    document.documentElement.dataset.theme = theme;
    rememberTheme(theme);
  }, [theme]);
  useEffect(() => {
    // The pages carry on with the defaults.
    if (error) console.warn("[rlt] settings/load_failed", { error: String(error) });
  }, [error]);
}

export function App() {
  useLiveEvents();
  useTheme();
  const { isPending } = useSettingsQuery();
  const { startPage } = useSettings();
  return (
    <>
      <Header />
      <main>
        {/* The start page and each page's default filter are settings: wait for them once. */}
        {isPending ? (
          <Loading label="Loading" />
        ) : (
          <Routes>
            <Route path="/" element={<Navigate to={`/${startPage}`} replace />} />
            <Route path="/recap" element={<RecapIndex />} />
            {/* One component for a session's three pages, so moving between them keeps it mounted. */}
            <Route path="/recap/:session" element={<RecapSession view="overview" />} />
            <Route path="/recap/:session/matches" element={<RecapSession view="matches" />} />
            <Route path="/recap/:session/match/:guid" element={<RecapSession view="match" />} />
            <Route path="/trends" element={<TrendsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        )}
      </main>
    </>
  );
}
