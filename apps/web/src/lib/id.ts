/** Opaque, URL-safe ids. Uses crypto.randomUUID where available. */
export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  return Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}
