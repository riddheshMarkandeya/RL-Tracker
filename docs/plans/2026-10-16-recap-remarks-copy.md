# Recap remarks copy

Ticket: "Recap remarks copy" in `2026-10-15-rl-tracker-features-map.md`. Accepted unreviewed on
purpose (the user wants to be surprised); cut lines as the user flags them.

## Rules (from grilling, 2026-10-16)

- Voice: mostly deadpan commentator, with some roasting friend and self-aware tracker mixed in.
- Roasts you properly. Friends get light teasing only, and the joke lands on the pair, not on them
  alone. No real swearing; the quick chat `$#@%!` is allowed.
- Rocket League in-jokes: use them a lot, but at most one per line.
- Headline = one mood line (no numbers) + at most one quip (real numbers).
- Mood: z = (session win % − 30-day win %) / (50 / √n). |z| < 0.5 usual, 0.5–1.5 good/rough,
  ≥ 1.5 great/disaster. Under 4 matches → the "short" set, not judged. Bands are tunable later from
  the user's own history.
- Quip choice: rarest tier that fired wins, random within the tier.
- Stable: the pick is stored per session + filter combination on first view, so revisiting shows
  the same lines. ↻ stays. A line shown in the last ~10 sessions isn't picked again while others
  are left.
- Settings: remarks on/off, and an on/off per trigger.

Placeholders: `{n}`, `{w}`, `{l}`, `{friend}`, `{speed}`, `{hours}`, `{time}`.

## Mood lines

### Great
1. Somebody brought their A-game, and their B-game was nowhere to be seen.
2. Tonight you were the ball's favorite.
3. The ranked gods smiled. Don't get used to it.
4. "Calculated." All of it. Probably.
5. Screenshot this before it goes back to normal.
6. Somewhere, your opponents are writing angry Reddit posts.
7. Peak performance. Statistically, it's downhill from here.
8. Was that you, or did someone borrow your account?

### Good
1. A better night than usual.
2. Above average, which is all anyone can ask.
3. Solid. Like a goal post, but on your side for once.
4. The rotation was trusted. Mostly.
5. Not a highlight reel, but you'd watch the replay.
6. A good night. Log off while it still counts.
7. Rank-up-adjacent behavior.
8. You won more than usual. The ball noticed.

### Usual
1. About your usual night.
2. Perfectly balanced, as all things should be.
3. Another solid shift at the office.
4. Same as it ever was.
5. The rank stays where it was. So do you.
6. Nothing to report. Proceed with your evening.
7. A night of extreme averageness.
8. Win some, lose some, queue again.

### Rough
1. A rougher night than usual.
2. The ball had other plans.
3. Tomorrow is another queue.
4. "Whoops..." about sums it up.
5. Some nights you're the windshield. Tonight you were the bug.
6. The rotation was trusted. The rotation did not deliver.
7. Not your night, and the ball made sure you knew it.
8. Your teammates send their thoughts. Mostly "?".

### Disaster
1. $#@%!
2. The rank-down animation is starting to recognize you.
3. Let us never speak of this again. Too late, it's in the database.
4. "What a save!" — your opponents, about you, all night.
5. On the bright side, you can't drop much further. Probably.
6. The ball has filed a restraining order.
7. Have you tried turning your car off and on again?
8. Some nights you play Rocket League. Tonight it played you.

### Short (under 4 matches)
1. A quick one.
2. In and out. Barely a warm-up.
3. Too short to judge. I'm judging anyway, quietly.
4. Just a taste.
5. Blink and you'd miss it.

## Quips

Tiers for the priority rule: **legendary** > **rare** > **common**. Thresholds are first guesses.

### Legendary

**Hat trick** (statfeed `HatTrick`)
1. A hat trick. Hats everywhere.
2. Hat trick! Three goals, zero hats received.
3. Three goals in one match. Show-off.
4. A hat trick. The other team is still looking for the ball.

**Savior** (statfeed `Savior`)
1. Savior earned. Your net had a bodyguard tonight.
2. Savior. The goal was closed for business.
3. Saved it, saved it, saved it again. Wall energy.
4. Savior. Somebody give this car a pair of gloves.

**Bicycle goal**
1. Scored a bicycle kick. Somebody clip that.
2. A bicycle goal. Was that on purpose? Don't answer that.
3. Bicycle kick goal. The replay will be watched more than once.
4. A bicycle goal. Freestylers everywhere felt a disturbance.

### Rare

**Aerial or long goal** (`{kind}` = aerial / long)
1. An aerial goal. Your car briefly identified as a plane.
2. A goal from your own half. "Calculated." Sure it was.
3. An aerial goal. Gravity is more of a suggestion for you.
4. A long goal. The keeper had time to make a sandwich and still missed it.

**Epic saves** ({n} ≥ 2)
1. {n} epic saves. "What a save!" — and this time it was sincere.
2. {n} epic saves. The ball kept knocking. You kept not answering.
3. {n} epic saves. Your net filed a thank-you note.
4. {n} epic saves. Shot-stopping is a personality now.

**Overtime wins** ({n} ≥ 1)
1. Won {n} in overtime. Clutch, or just stubborn.
2. {n} overtime win(s). Heart rate: also in overtime.
3. Took {n} to overtime and won. Golden goal, right net.

**Overtime losses** ({n} ≥ 1)
1. Lost {n} in overtime. So close it hurts more.
2. {n} overtime loss(es). Golden goal, wrong net.
3. Lost {n} in overtime. Five more minutes of hope, then this.

**MVP haul** ({n} ≥ 3 and at least 40% of matches)
1. {n} MVPs. The lobby should say thank you.
2. MVP ×{n}. Carrying is a form of cardio.
3. {n} MVPs. Your teammates were there, technically.
4. {n} MVPs. Humble about it, too. (You aren't.)

**Hard shot** ({speed} ≥ 130 km/h)
1. One shot left your car at {speed} km/h. Somebody check the net.
2. {speed} km/h. That ball has filed a complaint.
3. Hit one at {speed} km/h. The keeper didn't see it. Neither did you.
4. A {speed} km/h shot. Violence.

**Shut out** (your team scored 0 in a match; {n} = how many)
1. Shut out {n} time(s). Kickoff was the highlight.
2. Zero goals in {n} match(es). The opposing keeper is having a great night.
3. Shut out {n} time(s). The ball visited your net instead.
4. {n} match(es) without a goal. Nice shot! (There were none.)

### Common

**Win streak** ({n} ≥ 3)
1. {n} wins in a row at one point. Peak gaming.
2. A {n}-game win streak. Briefly, you were the matchmaking problem.
3. {n} straight wins. Something in your settings is finally working.
4. Won {n} in a row. Unstoppable, until you stopped.

**Loss streak** ({n} ≥ 3)
1. {n} losses in a row. That's not a streak, that's a lifestyle.
2. Lost {n} on the bounce. Tilt has entered the chat.
3. {n} straight losses. A water break was available.
4. {n} in a row the wrong way. The queue button was not the problem. Probably.

**Ended on a win** (session's last match won, and at least one earlier loss)
1. Ended on a win. Leaving on a high is a skill too.
2. Ended on a win. Disciplined. Suspiciously so.
3. "One more" was the right call, for once.

**Ended on a loss** (last match lost, and the session was not already a loss streak)
1. Ended on a loss. "One more game" strikes again.
2. "Last one" was the last one. Not in the good way.
3. Should've stopped one game earlier. You always should.

**Duo, good record** ({friend}, at least 3 matches together, {w} ≥ {l})
1. You and {friend} went {w}–{l}. Keep the duo together.
2. {w}–{l} with {friend}. Somebody's been practicing. One of you, anyway.
3. You and {friend}: {w}–{l}. The rotation was actually trusted.
4. {w}–{l} with {friend}. Whatever you two are doing, keep doing it.

**Duo, bad record** ({w} < {l})
1. {w}–{l} with {friend}. Maybe it's them. Maybe it's you. It's both.
2. You and {friend} went {w}–{l}. Couples therapy is an option.
3. {w}–{l} with {friend}. Two ball chasers, one ball.
4. You and {friend}: {w}–{l}. Bold of you both to queue together again.

**Soloqueue night** (no friend on your team all session, at least 4 matches)
1. All soloqueue tonight. Every teammate a mystery box.
2. Soloqueue all night. Strangers' rotations, your rank.
3. No friends online, just you and the randoms. Brave.
4. Solo all night. "Take the shot!" said nobody you know.

**Demos given** ({n} ≥ 5)
1. {n} demos. Bumper-car energy.
2. {n} demos. Your insurance company wants a word.
3. Demolished {n} cars. The scrapyard thanks you.
4. {n} demos. Some of them were even on purpose.

**Demoed a lot** ({n} ≥ 5)
1. Demoed {n} times. You were the bumper car.
2. Got demoed {n} times. The respawn screen knows you by name.
3. {n} demos taken. Look both ways next time.
4. Exploded {n} times. Very cinematic, not very useful.

**Crossbar** ({n} ≥ 2)
1. Rattled the crossbar {n} times. So close, so loud.
2. {n} crossbar hits. The goal frame is fine, thanks for asking.
3. Hit the crossbar {n} times. Physics was not on your side.
4. {n} crossbars. Somewhere a goal post is laughing.

**Marathon** (session ≥ 3 h; {hours} rounded)
1. {hours} hours of Rocket League. Hydrate.
2. A {hours}-hour session. Your chair is now part of you.
3. {hours} hours. Somebody, somewhere, is asking if you've eaten.
4. That was a marathon. Stretch, please.

**Late night** (session ends at 1am or later; {time} = end time)
1. Still queuing at {time}. Bold.
2. Played until {time}. Every decision after midnight is a tilt decision.
3. Late-night ranked. The best and worst idea in gaming.
4. Off at {time}. Sleep is also a skill.
