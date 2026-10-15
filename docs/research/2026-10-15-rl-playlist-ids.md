# Rocket League PlaylistId mapping (Stats API) — research note

Date: 2026-10-15. Feeds: how the tracker maps `Game.PlaylistId` from `UpdateState` to playlist names / ranked flag.

## Summary

1. **The official Stats API page gives no mapping.** It describes `PlaylistId` only as "Playlist Id of the current match", type int, with example value `11`. It has no table, no link to one, and no version or date. [S1]
2. **The best primary-source mapping found** is the `rlapi` Python library's `population.py` (jack1142/rlapi). It enumerates IDs -2..70, with descriptions, player counts and "unknown" markers for gaps. [S2][S3] Its last release was 0.8.0b1 on 2024-11-03 [S4], so it predates all of the 2025–2026 changes.
   ballchasing.com's API names the same set of playlists as slugs, without numbers [S5]. It corroborates the names but not the IDs.
   No BakkesMod SDK playlist enum could be located (an old wiki URL now redirects to a generic getting-started page) [S6]. No community Stats-API client source with a mapping turned up either.
3. **The values are presumably stable, but new playlists have appeared since the table was last updated.** Season 20 (v2.56, 2025-09-17) added **Competitive 4v4 (Quads)** and **Casual 4v4 (Quads)**, which permanently replaced Chaos in Casual. It also swapped Competitive Dropshot in for Competitive Snowday [S7]. Ranked Quads was kept into Season 21 (v2.63, 2025-12-10) [S8, mirror only]. **No source gives the Quads ID(s).** The tracker must handle unknown IDs gracefully and log them.

## Mapping table

All rows come from [S2]/[S3] (rlapi `population.py`) unless noted otherwise. "Ranked" means rlapi describes the playlist as ranked/competitive. Where a playlist is also present in ballchasing's slug list [S5], the slug is shown.

| ID | Name (rlapi) | Ranked | Category | ballchasing slug [S5] | Notes |
|---|---|---|---|---|---|
| -2 | Searching for Match | no | menu/state | — | matchmaking search state |
| 0 | Main Menu | no | menu/state | — | |
| 1 | Duel | no | casual | unranked-duels | 1v1 |
| 2 | Doubles | no | casual | unranked-doubles | 2v2 |
| 3 | Standard | no | casual | unranked-standard | 3v3 |
| 4 | Chaos | no | casual | unranked-chaos | 4v4; replaced in Casual by Quads in S20 [S7] |
| 6 | Private Match | no | private | private | |
| 7 | Season | no | offline | season | |
| 8 | Exhibition | no | offline | offline | also offline splitscreen |
| 9 | Training | no | offline/training | — | |
| **10** | **Ranked Duel** | **yes** | ranked | ranked-duels | |
| **11** | **Ranked Doubles** | **yes** | ranked | ranked-doubles | example value in [S1] |
| **12** | **Ranked Solo Standard** | **yes** | ranked | ranked-solo-standard | no longer available |
| **13** | **Ranked Standard** | **yes** | ranked | ranked-standard | |
| 15 | Snow Day | no | extra (casual) | snowday | marked "no longer available" in rlapi; Snowday returned to Casual in S20 [S7] — same ID unverified |
| 16 | Rocket Labs | no | extra (casual) | rocketlabs | |
| 17 | Hoops | no | extra (casual) | hoops | |
| 18 | Rumble | no | extra (casual) | rumble | |
| 19 | Workshop | no | offline/training | — | |
| 20 | Custom Training Editor | no | offline/training | — | |
| 21 | Custom Training | no | offline/training | — | |
| 22 | Custom Tournament | no | tournament | tournament (?) | "may be public or private" |
| 23 | Dropshot | no | extra (casual) | dropshot | rlapi: no longer available |
| 24 | LAN Match | no | offline | — | |
| 25 | Anniversary | no | LTM | — | |
| 26 | External Match (FACEIT) | no | private | — | |
| **27** | **Ranked Hoops** | **yes** | ranked extra | ranked-hoops | |
| **28** | **Ranked Rumble** | **yes** | ranked extra | ranked-rumble | |
| **29** | **Ranked Dropshot** | **yes** | ranked extra | ranked-dropshot | in Competitive rotation for S20 [S7] |
| **30** | **Ranked Snow Day** | **yes** | ranked extra | ranked-snowday | rotated out of Competitive in S20 [S7] |
| 31 | Ghost Hunt | no | LTM | — | |
| 32 | Beach Ball | no | LTM | — | 2v2 |
| 33 | Spike Rush | no | LTM | — | |
| **34** | **Official Tournament** | **yes**\* | tournament | tournament (?) | rlapi: "Official ranked tournaments organized regularly"; has its own rank, not playlist MMR (inference) |
| 35 | Rocket Labs | no | LTM | — | duplicate name of 16 |
| 37 | Dropshot Rumble | no | LTM | dropshot-rumble | |
| 38 | Heatseeker | no | LTM | heatseeker | |
| 41 | Boomer Ball | no | LTM | — | |
| 43 | Heatseeker Doubles | no | LTM | — | |
| 44 | Winter Breakaway | no | LTM | — | |
| 46 | Gridiron | no | LTM | — | 4v4 |
| 47 | Super Cube | no | LTM | — | |
| 48 | Tactical Rumble | no | LTM | — | |
| 49 | Spring Loaded | no | LTM | — | |
| 50 | Speed Demon | no | LTM | — | |
| 52 | Gotham City Rumble | no | LTM | — | |
| 54 | Knockout | no | LTM | — | 3 lives each; replaced by Quads for S20 [S7] |
| 55 | confidential_thirdwheel_test | no | LTM | — | internal test |
| 62 | Nike FC Showdown | no | LTM | — | |
| 64 | Haunted Heatseeker (2v2) | no | LTM | — | |
| 65 | Haunted Heatseeker (3v3) | no | LTM | — | |
| 66 | Heatseeker Ricochet | no | LTM | — | |
| 67 | Spooky Cube | no | LTM | — | |
| 68 | G-Force Frenzy | no | LTM | — | |
| 70 | Dropshot Rumble (2v2) | no | LTM | — | |
| ? | Competitive 4v4 (Quads) | yes | ranked | — | added S20 [S7]; **ID not found** |
| ? | Casual 4v4 (Quads) | no | casual | — | added S20, replaced Chaos [S7]; **ID not found** (may or may not reuse 4) |

rlapi lists these IDs as unknown: 5, 14, 36 (rlapi comment: maybe "Rumble Labs"), 39 (maybe "Inverted Ball"), 40, 42, 45 (maybe "Rocket Labs Doubles"), 51, 53, 56–61, 63 and 69. [S3]

## Changes 2025–2026 and unknown-ID handling

What the sources say:
- S20, v2.56, 2025-09-17 [S7]: Competitive 4v4 (Quads) was added to the Competitive rotation, described as "Rocket League's first new Competitive Playlist in almost seven years". In Casual, 4v4 (Quads) "permanently replaces 4v4 (Chaos)", Snowday moved from Competitive to Casual, Competitive Dropshot replaced Competitive Snowday, and Quads replaced Knockout for the season. Quads was "not … available in Private Matches, Free Play, or Exhibition at launch."
- S21, v2.63, 2025-12-10: Ranked Quads was kept for another season, with "improvements for Ranked Quads and Heatseeker". This comes from an unofficial mirror [S8]; the official page was behind a bot-check [S9].
- S22 (v2.66, 2026-03-11) lists Quads titles among its rewards [S10]. S23 (v2.70, 2026-06-09) [S11] and v2.72 (2026-08-04) [S12] mention no playlist changes in their search snippets. These pages were not read in full.
- None of the official pages read mention a change to the Stats API or to playlist IDs. [S1][S7]

Recommended handling (inference, not sourced):
- Keep a single `PLAYLISTS: dict[int, Playlist(name, category, ranked)]` table in the tracker, seeded from the table above. Treat it as data that can be updated without a code change.
- On an unmapped ID, record the raw integer and display `Unknown playlist (<id>)`. Set `ranked=None` (unknown) rather than `False`, so ranked stats are never silently miscounted. Log a structured `playlist.unknown_id` event once per ID per session. The event should carry the id, `Arena`, team sizes (`len(Players)` per team) and the game build, so the ID can be identified afterwards.
- Never hard-code ranked as `id in {10,11,13}`. The ranked extra modes (27–30) rotate between Competitive and Casual, and Quads is ranked.
- Store `PlaylistId` raw in every match record, so names can be re-mapped retroactively when the table is corrected.
- Discover the Quads IDs empirically: play one Casual Quads and one Ranked Quads match with the Stats API on, and read `PlaylistId`.

## Inferences (mine, not stated by sources)

- rlapi's table probably comes from Psyonix's own playlist IDs, as returned by the in-game population endpoint; its docstring says "may be returned by population endpoint" [S3]. The Stats API's `PlaylistId` is *probably* the same ID space, because example value 11 matches Ranked Doubles. This is unverified.
- Playlist IDs are probably append-only: rlapi keeps retired IDs (12, 15, 23) instead of reusing them. If so, the Quads playlists would have new IDs above 70 rather than reusing 4. This is unverified.
- The 1:1 match between ballchasing's slug list and rlapi's names suggests ballchasing uses the same underlying IDs. ballchasing does not publish its mapping.

## Open questions

1. What are the numeric IDs for Casual Quads and Competitive Quads? Does Casual Quads reuse ID 4?
2. Does the Stats API `PlaylistId` match the population/matchmaking IDs exactly, including for private matches, tournaments, offline play and training (or main menu: is -2/0 ever sent)?
3. Which IDs do the 2025–2026 LTMs use (Heatseeker variants, the FIFA World Cup LTE in S23 [S11], and others)?
4. Is Ranked Quads still in the Competitive rotation in Season 23/24 (current)?
5. Does Snowday in Casual since S20 reuse ID 15?

## Sources

- [S1] Rocket League Stats API (official): https://www.rocketleague.com/en/developer/stats-api (read via https://r.jina.ai/https://www.rocketleague.com/en/developer/stats-api)
- [S2] rlapi `population.py`, rendered source: https://rlapi.readthedocs.io/en/latest/_modules/rlapi/population.html
- [S3] rlapi `population.py`, raw: https://raw.githubusercontent.com/jack1142/rlapi/master/rlapi/population.py
- [S4] rlapi release history: https://pypi.org/project/rlapi/#history
- [S5] ballchasing.com API docs (playlist filter values): https://ballchasing.com/doc/api
- [S6] Former BakkesMod wiki playlist page (now redirects): https://wiki.bakkesplugins.com/code_snippets/playlist_id/ → https://bakkesplugins.com/wiki/bakkesmod-sdk/getting-started
- [S7] Patch notes v2.56 Season 20 (official): https://www.rocketleague.com/en/news/rocket-league-patch-notes-v2-56-season-20-live (read via r.jina.ai; also https://devtrackers.gg/rocket-league/p/7d89106d-rocket-league-patch-notes-v2-56-season-20-live)
- [S8] Patch notes v2.63 Season 21 (unofficial mirror): https://nm-news.duckdns.org/jeux/Rocket League/rocket-league-patch-notes-v263-season-21-live-mshpu7m5
- [S9] Patch notes v2.63 Season 21 (official, bot-check blocked): https://www.rocketleague.com/en/news/rocket-league-patch-notes-v2-63-season-21-live
- [S10] Patch notes v2.66 Season 22: https://www.rocketleague.com/news/rocket-league-patch-notes-v2-66-season-22-live/
- [S11] Patch notes v2.70 Season 23: https://www.rocketleague.com/news/rocket-league-patch-notes-v270-season-23-live
- [S12] Patch notes v2.72: https://www.rocketleague.com/news/rocket-league-patch-notes-v2-72
