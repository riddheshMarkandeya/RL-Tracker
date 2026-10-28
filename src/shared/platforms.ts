// The platform a player's primary id belongs to, for display: the raw prefix before the first `|`.

const NAMES: Record<string, string> = { Epic: "Epic", Steam: "Steam", PS4: "PlayStation", PS5: "PlayStation", XboxOne: "Xbox", Switch: "Switch" };

/** `known` is false for a prefix not in the table: it shows as itself, and the server logs it. */
export function platformOf(primaryId: string): { name: string; known: boolean } {
  const prefix = primaryId.split("|", 1)[0] ?? primaryId;
  const name = Object.hasOwn(NAMES, prefix) ? NAMES[prefix] : undefined;
  return name === undefined ? { name: prefix, known: false } : { name, known: true };
}
