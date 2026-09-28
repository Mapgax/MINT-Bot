/* Alle Themen, die bisher dran waren – egal ob behalten, archiviert oder
   verpasst. „Bisher“ = im Plan mit Datum bis heute (Europe/Berlin). Die
   Daten kommen aus dem Build (build.mjs), nicht aus der Datenbank. */
import { readFileSync } from "node:fs";
import { angemeldet } from "../lib/session.js";

// data/ wird per vercel.json (functions.includeFiles) mit ausgeliefert.
const lies = (datei) => JSON.parse(readFileSync(new URL(`../data/${datei}`, import.meta.url), "utf8"));
const experiments = lies("experiments.json");
const schedule = lies("schedule.json");
const videos = lies("videos.json");

const berlinHeute = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());

export function bisherigeThemen(heute = berlinHeute()) {
  const zuletzt = new Map();
  for (const [datum, id] of Object.entries(schedule)) {
    if (datum <= heute && datum > (zuletzt.get(id) ?? "")) zuletzt.set(id, datum);
  }
  return experiments
    .filter((e) => zuletzt.has(e.id))
    .map((e) => ({ ...e, zuletzt: zuletzt.get(e.id), videos: videos[e.id] ?? [] }))
    .sort((a, b) => b.zuletzt.localeCompare(a.zuletzt) || a.titel.localeCompare(b.titel, "de"));
}

export default function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Nur GET erlaubt" });
  }
  if (!angemeldet(req)) return res.status(401).json({ error: "Bitte anmelden." });
  return res.status(200).json({ themen: bisherigeThemen() });
}
