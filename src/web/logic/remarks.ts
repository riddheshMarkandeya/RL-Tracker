// Fills a recap remark's template: numbers as they are, the speed with its unit, the time as a
// local clock time, and "(s)"/"(es)" made to agree with {n}.
import { clock, SPEED_LABEL, speedIn, type Units } from "./format";

export function fillRemark(text: string, values: Record<string, number>, units: Units, locale?: string): string {
  const n = values.n;
  const plural = n === undefined ? text : text.replace(/\((e?s)\)/g, (_, suffix: string) => (n === 1 ? "" : suffix));
  return plural.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = values[name];
    if (v === undefined) return whole;
    if (name === "speed") return `${String(Math.round(speedIn(v, units.speed)))} ${SPEED_LABEL[units.speed]}`;
    if (name === "time") return clock(v, units.clock, locale);
    return String(v);
  });
}
