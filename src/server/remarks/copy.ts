// The recap headline's line pool. Ids are stable and never reused: a stored pick names a line by
// id, so cutting a line only re-picks the sessions that showed it. The text is the agreed copy,
// except that the hard-shot lines leave the speed unit to the renderer (it follows the units).

export const BANDS = ["short", "disaster", "rough", "usual", "good", "great"] as const;
export type Band = (typeof BANDS)[number];

/** Rarest first: the rarest tier with a trigger that fired supplies the quip. */
export const TIERS = ["legendary", "rare", "common"] as const;
export type Tier = (typeof TIERS)[number];

export const PLACEHOLDERS = ["n", "w", "l", "friend", "speed", "hours", "time"] as const;

export type GoalKind = "aerial" | "long";

export interface Line {
  id: string;
  text: string;
  /** Aerial-or-long only: the goal kind the line is about. */
  kind?: GoalKind;
}

export interface Trigger {
  tier: Tier;
  /** Why it never fires yet; absent for a live trigger. */
  inert?: string;
  lines: readonly Line[];
}

const l = (id: string, text: string, kind?: GoalKind): Line => (kind ? { id, text, kind } : { id, text });

export const MOOD_LINES: Record<Band, readonly Line[]> = {
  great: [
    l("great-1", "Somebody brought their A-game, and their B-game was nowhere to be seen."),
    l("great-2", "Tonight you were the ball's favorite."),
    l("great-3", "The ranked gods smiled. Don't get used to it."),
    l("great-4", "\"Calculated.\" All of it. Probably."),
    l("great-5", "Screenshot this before it goes back to normal."),
    l("great-6", "Somewhere, your opponents are writing angry Reddit posts."),
    l("great-7", "Peak performance. Statistically, it's downhill from here."),
    l("great-8", "Was that you, or did someone borrow your account?"),
  ],
  good: [
    l("good-1", "A better night than usual."),
    l("good-2", "Above average, which is all anyone can ask."),
    l("good-3", "Solid. Like a goal post, but on your side for once."),
    l("good-4", "The rotation was trusted. Mostly."),
    l("good-5", "Not a highlight reel, but you'd watch the replay."),
    l("good-6", "A good night. Log off while it still counts."),
    l("good-7", "Rank-up-adjacent behavior."),
    l("good-8", "You won more than usual. The ball noticed."),
  ],
  usual: [
    l("usual-1", "About your usual night."),
    l("usual-2", "Perfectly balanced, as all things should be."),
    l("usual-3", "Another solid shift at the office."),
    l("usual-4", "Same as it ever was."),
    l("usual-5", "The rank stays where it was. So do you."),
    l("usual-6", "Nothing to report. Proceed with your evening."),
    l("usual-7", "A night of extreme averageness."),
    l("usual-8", "Win some, lose some, queue again."),
  ],
  rough: [
    l("rough-1", "A rougher night than usual."),
    l("rough-2", "The ball had other plans."),
    l("rough-3", "Tomorrow is another queue."),
    l("rough-4", "\"Whoops...\" about sums it up."),
    l("rough-5", "Some nights you're the windshield. Tonight you were the bug."),
    l("rough-6", "The rotation was trusted. The rotation did not deliver."),
    l("rough-7", "Not your night, and the ball made sure you knew it."),
    l("rough-8", "Your teammates send their thoughts. Mostly \"?\"."),
  ],
  disaster: [
    l("disaster-1", "$#@%!"),
    l("disaster-2", "The rank-down animation is starting to recognize you."),
    l("disaster-3", "Let us never speak of this again. Too late, it's in the database."),
    l("disaster-4", "\"What a save!\" — your opponents, about you, all night."),
    l("disaster-5", "On the bright side, you can't drop much further. Probably."),
    l("disaster-6", "The ball has filed a restraining order."),
    l("disaster-7", "Have you tried turning your car off and on again?"),
    l("disaster-8", "Some nights you play Rocket League. Tonight it played you."),
  ],
  short: [
    l("short-1", "A quick one."),
    l("short-2", "In and out. Barely a warm-up."),
    l("short-3", "Too short to judge. I'm judging anyway, quietly."),
    l("short-4", "Just a taste."),
    l("short-5", "Blink and you'd miss it."),
  ],
};

const triggers = {
  hat_trick: {
    tier: "legendary",
    lines: [
      l("hat-trick-1", "A hat trick. Hats everywhere."),
      l("hat-trick-2", "Hat trick! Three goals, zero hats received."),
      l("hat-trick-3", "Three goals in one match. Show-off."),
      l("hat-trick-4", "A hat trick. The other team is still looking for the ball."),
    ],
  },
  savior: {
    tier: "legendary",
    lines: [
      l("savior-1", "Savior earned. Your net had a bodyguard tonight."),
      l("savior-2", "Savior. The goal was closed for business."),
      l("savior-3", "Saved it, saved it, saved it again. Wall energy."),
      l("savior-4", "Savior. Somebody give this car a pair of gloves."),
    ],
  },
  bicycle_goal: {
    tier: "legendary",
    inert: "The game sends no bicycle-goal event, only BicycleHit; needs a rule tying one to a goal's origin touch.",
    lines: [
      l("bicycle-1", "Scored a bicycle kick. Somebody clip that."),
      l("bicycle-2", "A bicycle goal. Was that on purpose? Don't answer that."),
      l("bicycle-3", "Bicycle kick goal. The replay will be watched more than once."),
      l("bicycle-4", "A bicycle goal. Freestylers everywhere felt a disturbance."),
    ],
  },
  aerial_or_long: {
    tier: "rare",
    lines: [
      l("aerial-long-1", "An aerial goal. Your car briefly identified as a plane.", "aerial"),
      l("aerial-long-2", "A goal from your own half. \"Calculated.\" Sure it was.", "long"),
      l("aerial-long-3", "An aerial goal. Gravity is more of a suggestion for you.", "aerial"),
      l("aerial-long-4", "A long goal. The keeper had time to make a sandwich and still missed it.", "long"),
    ],
  },
  epic_saves: {
    tier: "rare",
    lines: [
      l("epic-saves-1", "{n} epic saves. \"What a save!\" — and this time it was sincere."),
      l("epic-saves-2", "{n} epic saves. The ball kept knocking. You kept not answering."),
      l("epic-saves-3", "{n} epic saves. Your net filed a thank-you note."),
      l("epic-saves-4", "{n} epic saves. Shot-stopping is a personality now."),
    ],
  },
  ot_wins: {
    tier: "rare",
    lines: [
      l("ot-wins-1", "Won {n} in overtime. Clutch, or just stubborn."),
      l("ot-wins-2", "{n} overtime win(s). Heart rate: also in overtime."),
      l("ot-wins-3", "Took {n} to overtime and won. Golden goal, right net."),
    ],
  },
  ot_losses: {
    tier: "rare",
    lines: [
      l("ot-losses-1", "Lost {n} in overtime. So close it hurts more."),
      l("ot-losses-2", "{n} overtime loss(es). Golden goal, wrong net."),
      l("ot-losses-3", "Lost {n} in overtime. Five more minutes of hope, then this."),
    ],
  },
  mvp_haul: {
    tier: "rare",
    lines: [
      l("mvp-haul-1", "{n} MVPs. The lobby should say thank you."),
      l("mvp-haul-2", "MVP ×{n}. Carrying is a form of cardio."),
      l("mvp-haul-3", "{n} MVPs. Your teammates were there, technically."),
      l("mvp-haul-4", "{n} MVPs. Humble about it, too. (You aren't.)"),
    ],
  },
  hard_shot: {
    tier: "rare",
    lines: [
      l("hard-shot-1", "One shot left your car at {speed}. Somebody check the net."),
      l("hard-shot-2", "{speed}. That ball has filed a complaint."),
      l("hard-shot-3", "Hit one at {speed}. The keeper didn't see it. Neither did you."),
      l("hard-shot-4", "A {speed} shot. Violence."),
    ],
  },
  shut_out: {
    tier: "rare",
    lines: [
      l("shut-out-1", "Shut out {n} time(s). Kickoff was the highlight."),
      l("shut-out-2", "Zero goals in {n} match(es). The opposing keeper is having a great night."),
      l("shut-out-3", "Shut out {n} time(s). The ball visited your net instead."),
      l("shut-out-4", "{n} match(es) without a goal. Nice shot! (There were none.)"),
    ],
  },
  win_streak: {
    tier: "common",
    lines: [
      l("win-streak-1", "{n} wins in a row at one point. Peak gaming."),
      l("win-streak-2", "A {n}-game win streak. Briefly, you were the matchmaking problem."),
      l("win-streak-3", "{n} straight wins. Something in your settings is finally working."),
      l("win-streak-4", "Won {n} in a row. Unstoppable, until you stopped."),
    ],
  },
  loss_streak: {
    tier: "common",
    lines: [
      l("loss-streak-1", "{n} losses in a row. That's not a streak, that's a lifestyle."),
      l("loss-streak-2", "Lost {n} on the bounce. Tilt has entered the chat."),
      l("loss-streak-3", "{n} straight losses. A water break was available."),
      l("loss-streak-4", "{n} in a row the wrong way. The queue button was not the problem. Probably."),
    ],
  },
  ended_win: {
    tier: "common",
    lines: [
      l("ended-win-1", "Ended on a win. Leaving on a high is a skill too."),
      l("ended-win-2", "Ended on a win. Disciplined. Suspiciously so."),
      l("ended-win-3", "\"One more\" was the right call, for once."),
    ],
  },
  ended_loss: {
    tier: "common",
    lines: [
      l("ended-loss-1", "Ended on a loss. \"One more game\" strikes again."),
      l("ended-loss-2", "\"Last one\" was the last one. Not in the good way."),
      l("ended-loss-3", "Should've stopped one game earlier. You always should."),
    ],
  },
  duo_good: {
    tier: "common",
    inert: "Needs friends (WP9).",
    lines: [
      l("duo-good-1", "You and {friend} went {w}–{l}. Keep the duo together."),
      l("duo-good-2", "{w}–{l} with {friend}. Somebody's been practicing. One of you, anyway."),
      l("duo-good-3", "You and {friend}: {w}–{l}. The rotation was actually trusted."),
      l("duo-good-4", "{w}–{l} with {friend}. Whatever you two are doing, keep doing it."),
    ],
  },
  duo_bad: {
    tier: "common",
    inert: "Needs friends (WP9).",
    lines: [
      l("duo-bad-1", "{w}–{l} with {friend}. Maybe it's them. Maybe it's you. It's both."),
      l("duo-bad-2", "You and {friend} went {w}–{l}. Couples therapy is an option."),
      l("duo-bad-3", "{w}–{l} with {friend}. Two ball chasers, one ball."),
      l("duo-bad-4", "You and {friend}: {w}–{l}. Bold of you both to queue together again."),
    ],
  },
  soloqueue: {
    tier: "common",
    inert: "Needs friends (WP9).",
    lines: [
      l("soloqueue-1", "All soloqueue tonight. Every teammate a mystery box."),
      l("soloqueue-2", "Soloqueue all night. Strangers' rotations, your rank."),
      l("soloqueue-3", "No friends online, just you and the randoms. Brave."),
      l("soloqueue-4", "Solo all night. \"Take the shot!\" said nobody you know."),
    ],
  },
  demos_given: {
    tier: "common",
    lines: [
      l("demos-given-1", "{n} demos. Bumper-car energy."),
      l("demos-given-2", "{n} demos. Your insurance company wants a word."),
      l("demos-given-3", "Demolished {n} cars. The scrapyard thanks you."),
      l("demos-given-4", "{n} demos. Some of them were even on purpose."),
    ],
  },
  demoed_a_lot: {
    tier: "common",
    inert: "Demos taken aren't recorded; the Demolish statfeed's SecondaryTarget would need a rule.",
    lines: [
      l("demoed-1", "Demoed {n} times. You were the bumper car."),
      l("demoed-2", "Got demoed {n} times. The respawn screen knows you by name."),
      l("demoed-3", "{n} demos taken. Look both ways next time."),
      l("demoed-4", "Exploded {n} times. Very cinematic, not very useful."),
    ],
  },
  crossbar: {
    tier: "common",
    lines: [
      l("crossbar-1", "Rattled the crossbar {n} times. So close, so loud."),
      l("crossbar-2", "{n} crossbar hits. The goal frame is fine, thanks for asking."),
      l("crossbar-3", "Hit the crossbar {n} times. Physics was not on your side."),
      l("crossbar-4", "{n} crossbars. Somewhere a goal post is laughing."),
    ],
  },
  marathon: {
    tier: "common",
    lines: [
      l("marathon-1", "{hours} hours of Rocket League. Hydrate."),
      l("marathon-2", "A {hours}-hour session. Your chair is now part of you."),
      l("marathon-3", "{hours} hours. Somebody, somewhere, is asking if you've eaten."),
      l("marathon-4", "That was a marathon. Stretch, please."),
    ],
  },
  late_night: {
    tier: "common",
    lines: [
      l("late-night-1", "Still queuing at {time}. Bold."),
      l("late-night-2", "Played until {time}. Every decision after midnight is a tilt decision."),
      l("late-night-3", "Late-night ranked. The best and worst idea in gaming."),
      l("late-night-4", "Off at {time}. Sleep is also a skill."),
    ],
  },
} satisfies Record<string, Trigger>;

export type TriggerId = keyof typeof triggers;
export const TRIGGERS: Record<TriggerId, Trigger> = triggers;
