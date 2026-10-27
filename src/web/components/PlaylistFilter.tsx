import { useId, type RefObject } from "react";
import type { PlaylistFilter as Filter } from "../../shared/playlist-filter";
import { filterOptions, filterValue, parseFilter } from "../logic/filter-options";
import styles from "./PlaylistFilter.module.css";

/** The playlist dropdown: only the playlists played, grouped, no counts. */
export function PlaylistFilter({ value, present, onChange, selectRef }: { value: Filter; present: readonly number[]; onChange: (f: Filter) => void; selectRef?: RefObject<HTMLSelectElement | null> }) {
  const id = useId();
  return (
    <div className={styles.filter}>
      <label htmlFor={id}>Playlist</label>
      <select id={id} ref={selectRef} value={filterValue(value)} onChange={(e) => { onChange(parseFilter(e.target.value).filter); }}>
        {filterOptions(present, value).map((g) =>
          g.label === null ? (
            g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)
          ) : (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </optgroup>
          ),
        )}
      </select>
    </div>
  );
}
