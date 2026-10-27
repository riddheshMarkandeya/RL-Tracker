// Fills a recap remark's template: numbers as they are, the speed with its unit, the time as a
// local clock time, and "(s)"/"(es)" made to agree with {n}.
import { clock } from "./format";

export function fillRemark(text: string, values: Record<string, number>, locale?: string): string {
  const n = values.n;
  const plural = n === undefined ? text : text.replace(/\((e?s)\)/g, (_, suffix: string) => (n === 1 ? "" : suffix));
  return plural.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = values[name];
    if (v === undefined) return whole;
    if (name === "speed") return `${String(v)} km/h`;
    if (name === "time") return clock(v, locale);
    return String(v);
  });
}
