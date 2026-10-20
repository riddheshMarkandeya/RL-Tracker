# RL Tracker: project rules

These add to the global `~/.claude/CLAUDE.md`.

## Data shapes we haven't seen
We know the Stats API's event order and fields only from captured and stored matches. A design
question or review finding about a shape none of them shows (an event order, a missing or
malformed field) gets this default:
- Make sure a check flags the case (or already does), so it can't silently corrupt a stored stat.
- Add a BACKLOG Watch-list item with the trigger. Fit the rule to the real match when one first
  appears; flagged matches are kept for that.

Handle the case up front only when the handling is cheap and obvious, or when the case would
otherwise corrupt data without a flag.

Why: WP4b spent about half of its 12 review rounds inventing handling for event orders that
never appeared in 214 real goals. Both stop-rule escalations ended in flag-and-wait.
