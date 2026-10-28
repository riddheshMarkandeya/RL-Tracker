import { useEffect, useState } from "react";

const CLOCK_MS = 60_000;

/** The time, a minute at a time, so a page left open moves on to the next day at the cutoff. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => { setNow(Date.now()); }, CLOCK_MS);
    return () => { clearInterval(t); };
  }, []);
  return now;
}
