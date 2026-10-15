# RL Tracker — feature map, grilling round 1

Fill in each `Answer:` line (or write "rec" to accept the recommendation). Add anything else under Notes.

## Q1 — Destination
Is this map finished when we have a locked feature spec for the v1 local tracker? That means
decisions on what it captures, how sessions and periods work, what each view shows and what stack
it's built on. Notes would record which choices keep a later web or mobile app possible, but the
app itself wouldn't be designed now.

→ Recommended: Yes. The app is "maybe, future", so designing it now would be guessing. We'd only
avoid choices that block it.

Answer: Rec

## Q2 — Whose data
Just you on one account? Or also alt accounts, splitscreen, or friends running their own copy?

→ Recommended: Just you, but allow several platform IDs as "me". Since the API never says which
player is you, the tracker needs a "my IDs" list anyway.

Answer: recommended, we can look into expanding it later.

## Q3 — How you'll look at it
The tracker needs a background program that records your matches. For viewing the stats, which do
you picture?
- (a) a summary printed in the terminal
- (b) a dashboard you open in your browser on your own PC
- (c) a desktop app
- (d) an overlay you see while playing, in-game or in OBS (streaming software)

→ Recommended: (b). It's the cheapest way to get proper charts, and it's the closest step towards
a future web app.

Answer: recommended

## Q4 — When you look
During play (between matches, an overlay) or after you stop (a session recap)?

→ Recommended: Mainly after you stop, with a simple running total during play if it's cheap. You
said "how did I perform in the latest session", which is a recap question.

Answer: recommended

## Q5 — Playlists
Which modes matter: ranked 1s/2s/3s, casual, extra modes like Rumble and Hoops, private matches
or tournaments?

→ Recommended: Record everything and filter by playlist, with ranked as the default view.
Recording is free; filters are just views.

Answer: recommended

## Q6 — MMR
If you didn't have to justify it to anyone, is the MMR change per session something you'd
actually miss, or are wins, losses and stats enough? It's the one thing the game won't hand over.
The options are typing it in, reading it off the screen automatically (fragile) or leaving it out.

→ Recommended: Leave MMR out of v1 and treat win/loss and streaks as the result measure. Revisit
if it turns out you'd miss it.

Answer: recommended, yes leave MMR out for now, we can research later how we can get them or we might get them in updates to the stats API.

## Q7 — Teammates and opponents
Do you care who you played with? Examples are win rate with a specific duo partner, or whether
you've met this opponent before.

→ Recommended: Store names and IDs now since it costs nothing, but build no features on them in
v1.

Answer: Hmm, interesting idea. If its trivial to implement then yes, else store the data and we can slot that feature later.

## Notes
