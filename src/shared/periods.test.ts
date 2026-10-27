import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { dayOf, dayStart, monthOf, nextMonthStart, periodRange, shiftDay, type Season } from "./periods";

// Local time is the process's zone; each block pins one. Expected instants are written in UTC
// from the zone's known offsets (New York: EST −5, EDT −4; London: GMT 0, BST +1).
function inZone(zone: string) {
  const before = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = zone;
  });
  afterAll(() => {
    process.env.TZ = before;
  });
}

const H = 3_600_000;
const utc = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0) => Date.UTC(y, mo - 1, d, h, mi, s, ms);

describe("shiftDay", () => {
  test.each([
    ["2026-10-21", 1, "2026-10-22"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2026-03-01", -1, "2026-02-28"],
    ["2028-03-01", -1, "2028-02-29"],
    ["2026-11-15", -29, "2026-10-17"],
    ["2026-10-21", 0, "2026-10-21"],
  ] as const)("%s %+d is %s", (day, n, out) => {
    expect(shiftDay(day, n)).toBe(out);
  });
});

describe("months", () => {
  test("a day's month, and the first day of the month after, across a year end", () => {
    expect(monthOf("2026-10-26")).toBe("2026-10");
    expect(nextMonthStart("2026-10-26")).toBe("2026-11-01");
    expect(nextMonthStart("2026-12-15")).toBe("2027-01-01");
  });
});

describe("local days in London", () => {
  inZone("Europe/London");

  test("the day rolls over at 04:00, not midnight", () => {
    expect(dayOf(utc(2026, 10, 21, 2, 59, 59, 999))).toBe("2026-10-20"); // 03:59:59.999 BST
    expect(dayOf(utc(2026, 10, 21, 3))).toBe("2026-10-21"); // 04:00 BST
    expect(dayStart("2026-10-21")).toBe(utc(2026, 10, 21, 3));
  });

  test("the spring-forward day is 23 h and the fall-back day 25 h", () => {
    // Clocks change at 01:00 GMT on 29 Mar and 25 Oct, before the cutoff, so the day before owns it.
    expect(dayStart("2026-03-29") - dayStart("2026-03-28")).toBe(23 * H);
    expect(dayStart("2026-10-25") - dayStart("2026-10-24")).toBe(25 * H);
    expect(dayStart("2026-10-26") - dayStart("2026-10-25")).toBe(24 * H);
  });

  test("dayOf around the change", () => {
    expect(dayOf(utc(2026, 3, 29, 1, 30))).toBe("2026-03-28"); // 02:30 BST
    expect(dayOf(utc(2026, 3, 29, 3))).toBe("2026-03-29"); // 04:00 BST
    expect(dayOf(utc(2026, 10, 25, 3, 59))).toBe("2026-10-24"); // 03:59 GMT
    expect(dayOf(utc(2026, 10, 25, 4))).toBe("2026-10-25"); // 04:00 GMT
  });
});

describe("periods in New York", () => {
  inZone("America/New_York");
  const now = utc(2026, 10, 21, 16); // Wed 21 Oct 12:00 EDT
  const seasons: Season[] = [
    { id: 1, name: "S23", startDate: "2026-06-09" },
    { id: 2, name: "S22", startDate: "2026-03-11" },
    { id: 3, name: "S24", startDate: "2026-09-23" },
  ];
  const range = (spec: Parameters<typeof periodRange>[0], at = now) => periodRange(spec, { now: at, seasons });

  test("DST days: 23 h in March, 25 h in November", () => {
    expect(dayStart("2026-03-08") - dayStart("2026-03-07")).toBe(23 * H);
    expect(dayStart("2026-11-01") - dayStart("2026-10-31")).toBe(25 * H);
    expect(dayOf(utc(2026, 3, 8, 6, 59))).toBe("2026-03-07"); // 01:59 EST
    expect(dayOf(utc(2026, 3, 8, 7, 30))).toBe("2026-03-07"); // 03:30 EDT
    expect(dayOf(utc(2026, 3, 8, 8))).toBe("2026-03-08"); // 04:00 EDT
  });

  test("a day", () => {
    expect(range({ kind: "day", day: "2026-03-07" })).toEqual({ from: utc(2026, 3, 7, 9), to: utc(2026, 3, 8, 8), running: false });
    expect(range({ kind: "day", day: "2026-10-21" })).toEqual({ from: utc(2026, 10, 21, 8), to: utc(2026, 10, 22, 8), running: true });
    // At the shared edge only the new day is running.
    const edge = utc(2026, 10, 22, 8);
    expect(range({ kind: "day", day: "2026-10-21" }, edge)?.running).toBe(false);
    expect(range({ kind: "day", day: "2026-10-22" }, edge)?.running).toBe(true);
  });

  test("a week starts Monday 04:00: Monday 03:30 is still the week before", () => {
    const monday0330 = utc(2026, 10, 19, 7, 30);
    const monday0400 = utc(2026, 10, 19, 8);
    const before = range({ kind: "week", day: dayOf(monday0330) });
    expect(before).toEqual({ from: utc(2026, 10, 12, 8), to: utc(2026, 10, 19, 8), running: false });
    expect(range({ kind: "week", day: dayOf(monday0400) })).toEqual({ from: utc(2026, 10, 19, 8), to: utc(2026, 10, 26, 8), running: true });
    // Any day of the week names the same week.
    expect(range({ kind: "week", day: "2026-10-25" })).toEqual(range({ kind: "week", day: "2026-10-19" }));
  });

  test("a month and a year start on the 1st at 04:00", () => {
    // 1 Nov 04:00 is already EST.
    expect(range({ kind: "month", day: "2026-10-21" })).toEqual({ from: utc(2026, 10, 1, 8), to: utc(2026, 11, 1, 9), running: true });
    expect(range({ kind: "month", day: "2026-12-05" })).toEqual({ from: utc(2026, 12, 1, 9), to: utc(2027, 1, 1, 9), running: false });
    expect(range({ kind: "year", day: "2026-06-30" })).toEqual({ from: utc(2026, 1, 1, 9), to: utc(2027, 1, 1, 9), running: true });
  });

  test("a season runs to the next one by start date, not id", () => {
    expect(range({ kind: "season", id: 2 })).toEqual({ from: utc(2026, 3, 11, 8), to: utc(2026, 6, 9, 8), running: false });
    expect(range({ kind: "season", id: 1 })).toEqual({ from: utc(2026, 6, 9, 8), to: utc(2026, 9, 23, 8), running: false });
  });

  test("the last season is open-ended and running", () => {
    expect(range({ kind: "season", id: 3 })).toEqual({ from: utc(2026, 9, 23, 8), to: now, running: true });
  });

  test("a season that hasn't started isn't running", () => {
    const january = utc(2026, 1, 5, 17);
    expect(range({ kind: "season", id: 2 }, january)).toEqual({ from: utc(2026, 3, 11, 8), to: utc(2026, 6, 9, 8), running: false });
  });

  test("a last season entered ahead of its start is an empty range, not an inverted one", () => {
    const withNext = [...seasons, { id: 4, name: "S25", startDate: "2026-12-09" }];
    const start = utc(2026, 12, 9, 9);
    expect(periodRange({ kind: "season", id: 4 }, { now, seasons: withNext })).toEqual({ from: start, to: start, running: false });
  });

  test("an unknown season is null", () => {
    expect(range({ kind: "season", id: 99 })).toBeNull();
  });

  test("last 7 days: today and the six before, from 04:00", () => {
    expect(range({ kind: "last7" })).toEqual({ from: utc(2026, 10, 15, 8), to: now, running: true });
    // At 02:00 the local day is still the 20th.
    const late = utc(2026, 10, 21, 6);
    expect(range({ kind: "last7" }, late)).toEqual({ from: utc(2026, 10, 14, 8), to: late, running: true });
  });

  test("last 30 days across the fall-back change still starts at 04:00", () => {
    const nov15 = utc(2026, 11, 15, 17); // 12:00 EST
    expect(range({ kind: "last30" }, nov15)).toEqual({ from: utc(2026, 10, 17, 8), to: nov15, running: true });
  });

  test("this year and all time", () => {
    expect(range({ kind: "this_year" })).toEqual({ from: utc(2026, 1, 1, 9), to: now, running: true });
    expect(range({ kind: "all" })).toEqual({ from: null, to: now, running: true });
  });
});
