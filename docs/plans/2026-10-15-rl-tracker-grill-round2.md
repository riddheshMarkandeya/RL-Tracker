# RL Tracker — feature map, grilling round 2

Round 1 settled these: the map ends at a locked v1 local spec. The data is yours, with several IDs
allowed as "me". You'll view it in a dashboard in your browser, mostly as a recap after playing.
Everything is recorded with ranked as the default view, MMR is left out for now, and teammate and
opponent data is stored (with features only if trivial).

Fill in each `Answer:` line (or "rec").

## Q8 — What counts as a session
- (a) A new session starts after N minutes without a match.
- (b) A session runs from game launch to game close.
- (c) You start and stop sessions by hand.

→ Recommended: (a) with N = 30, plus a "start new session" button. If the game crashes or you
restart it mid-evening, (b) splits one sitting into two. (c) is easy to forget.

Answer: rec

## Q9 — Periods
- **Day:** when does a day roll over? Midnight, or a "gamer day" cutoff such as 4am, so that a
  session running 23:00–01:00 stays in one day?
- **Week:** does it start on Monday or Sunday?
- **Month:** the calendar month.
- **Season:** no program can look up season dates, so they'd go in a small table you edit. It
  would come pre-filled with S22 (2026-03-11), S23 (2026-06-09) and S24 (2026-09-23), and you'd
  add each new season's start date.

→ Recommended: a 4am day cutoff, weeks starting Monday, calendar months, and the editable season
table. Also a "last 7 / 30 days" rolling view, which is often more useful than calendar weeks.

Answer: rec, also I am assuming we would save everything in UTC and then display for local time?

## Q10 — What the session recap shows
These are candidates; cross out any you don't want and add any that are missing:
- wins and losses, win %, and your longest win and loss streaks;
- goals, assists, saves, shots, demos and score, as totals and per game;
- shooting % (goals divided by shots);
- statfeed counts: epic saves, aerial goals, hat tricks, MVPs and so on;
- **a comparison with your normal**: each stat against your 30-day average, marked better or
  worse;
- a breakdown by playlist;
- a list of matches: result, score, your line and the arena.

→ Recommended: all of these, with the comparison with your normal as the headline. A
better-or-worse comparison answers "how did I do?"; raw totals don't.

Answer: rec. "and crossbarhits, any way to count whiffs or similar stats? (if possible)"

## Q11 — Language and stack
- (a) **TypeScript end to end:** Node runs the background program, which saves to SQLite and
  serves a small web dashboard. The future web app could reuse the same code and types.
- (b) **Python:** a background program plus FastAPI, saving to SQLite, with a small web front
  end. The front end would still be JavaScript.
- (c) Something else you'd rather use or learn.

→ Recommended: (a), unless you're noticeably more fluent in Python. One language across the
background program, the dashboard and a future web app is the simplest. If you'd pick Python
without having to justify it, pick Python.

Answer: yeah I am fluent in both, we can go with typescript.

## Q12 — How it runs
Should the background program start automatically, either at Windows login (sitting idle until
Rocket League opens) or when RL launches? Or do you start it by hand?

→ Recommended: Start at login, run quietly, and connect when the game's port appears. A tracker
you have to remember to start misses sessions.

Answer: rec, as long as it doesn't have high performance footprint, which I dont think it would have but we should test.

## Q13 — Incomplete matches
How should we count:
- matches you leave early;
- disconnects;
- forfeits;
- matches you join already in progress?

→ Recommended: Record them all with a flag. A forfeit counts as a normal win or loss. A match you
leave counts as a loss, because ranked treats it that way. A match you join in progress counts
normally, but its stats are marked partial and left out of per-game averages.

Answer: "left out of per-game averages." why would we left it out from per-game averages? You rarely get into a match where more than 1 minute is passed most of the time you join a match in first 10s to 30s. so I think its fine to count everything as full game and flag with appropriate.

## Q14 — Identifying you
The API never says which player you are. Options:
- (a) You type your name or ID once.
- (b) The tracker guesses from the player the camera follows during your first match and asks
  you to confirm.

→ Recommended: (b) with confirmation, and a settings list you can edit afterwards. It avoids
looking up your platform ID.

Answer: rec.

## Notes
