# RL Tracker — feature map, grilling round 3 (teammates and opponents)

Ticket: "Teammate and opponent features". It started from Q7 (features only if trivial). The user
had already said that friends are added by hand, that the tracker suggests frequent co-players,
and that friend stats cover every playlist. Capture facts: there's no party field, `PrimaryId` is
stable for humans, and bots (`Unknown|0|0`) are excluded.

The questions continue the numbering from rounds 1 and 2. In chat they were asked as Q1–Q10.

## Q15 — What identifies a friend
→ Recommended: key on `PrimaryId` and show the last name seen, with an optional nickname you set.

Answer: rec

## Q16 — When to suggest a friend
- (a) N matches as a teammate in total.
- (b) N matches across at least 2 separate sessions.
- (c) Back-to-back matches in one session.

→ Recommended: (b), with at least 3 matches as your teammate across at least 2 sessions, counting
only humans. Each suggestion gets "add" and "never suggest".

Answer: rec

## Q17 — Which stats to show with a friend
- (a) W/L and win % with them, per playlist.
- (b) Your own stats with them compared to your overall stats.
- (c) Their scoreboard stats in those matches.
- (d) Their boost and speed (teammates only).
- (e) Your record against them.

→ Recommended: (a) + (b) + (c), and leave out (d). (e) as a count at most.

Answer: (a) + (b) + (c), leave out (d). Keep (e) with the relevant details: "we do play against
each other sometimes (e.g. 4 friends playing 2v2 with randomly joining teams or 1v1 dueling a
friend) so it would be fun to see those stats."

## Q18 — Where the stats live
- (a) A Friends page.
- (b) A "with teammate" filter next to the playlist filter.
- (c) Both.

→ Recommended: (c).

Answer: rec

## Q19 — What counts as "with them"
- (a) On your team at any point.
- (b) On your team in the `MatchEnded` snapshot.

→ Recommended: (a).

Answer: rec

## Q20 — Opponent history with random players
- (a) Defer.
- (b) A "seen before ×N" badge.
- (c) A searchable player page.

→ Recommended: (a). Repeat random opponents are rare, and the IDs are stored anyway.

Answer: rec

## Q21 — What the head-to-head shows
→ Recommended: W/L and win % against the friend per playlist; your scoreboard line next to theirs
in each match, plus totals; and MVP count.

Answer: rec. The user asked whether the result and MVP could be inferred without staying until the
end ("just max points and max goals"), with inferred results flagged. Reply:
- Win is already covered by the capture rule: a decided match takes its winner from the score, and
  `MatchEnded` fires before the podium.
- MVP is the highest *score* on the winning team, not the most goals. Use the `MVP` statfeed when it
  fires, otherwise infer it and flag it. Don't infer it when the top two on the winning team have
  the same score.

## Q22 — Private matches (playlist 6)
- (a) Count them like any casual playlist.
- (b) Record them, but leave them out of your overall stats and the 30-day average by default.
- (c) Don't record them.

→ Recommended: (b).

Answer: rec

## Q23 — Check that private matches send data
→ Recommended: add it to the left-to-observe list rather than opening a ticket.

Answer: rec. The user may test it later, possibly in a private match with bots.

## Q24 — v1 or fast follow
→ Recommended: v1, as the last work package so it can slip without holding anything else up.

Answer: rec

## Confirmed write-back
1. Friends are added by hand and keyed on `PrimaryId`. The dashboard shows the last name seen, or
   a nickname you set.
2. The tracker suggests a human who was your teammate in 3 or more matches across 2 or more
   sessions. Each suggestion has "add" and "never suggest".
3. With a friend: W/L and win % per playlist, your stats with them compared to your overall stats,
   and their scoreboard stats. No boost or speed for them. "With them" means on your team at any
   point in the match.
4. Against a friend: W/L per playlist, your scoreboard line next to theirs with totals, and MVP
   count. MVP comes from the statfeed, or is inferred as the top score on the winning team
   (flagged; no MVP on a tie).
5. Where it shows: a "with teammate" filter next to the playlist filter, plus a Friends page with
   "with" and "against" tabs.
6. Private matches are recorded but left out of overall stats and the 30-day average by default.
   They show on the Friends page and under an explicit Private filter.
7. Opponent history with random players is deferred. Checking a private match live goes on the
   left-to-observe list.
8. All of this is in v1, as the last work package.

The user confirmed: "sounds good".
