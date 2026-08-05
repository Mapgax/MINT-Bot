#!/usr/bin/env node
// Schreibt einmal pro Woche EIN brain_items-Row mit dem, was der MINT-Bot in
// den letzten sieben Tagen gemacht hat.
//
// Bewusst eine Wochenzusammenfassung statt eines Items pro Experiment: sonst
// landen ~365 Einträge im Jahr in der Brain-Inbox und die Triage erstickt.
//
// Aufruf: node scripts/brain-digest.mjs [--dry-run] [--tage 7]
import { query, closePools, hasDb } from "../lib/db.js";

const dryRun = process.argv.includes("--dry-run");
const tageIdx = process.argv.indexOf("--tage");
const TAGE = tageIdx > -1 ? Number(process.argv[tageIdx + 1]) : 7;

if (!hasDb()) {
  console.error("MINT_DB_URL_JOB fehlt. Abbruch.");
  process.exit(1);
}

const KATEGORIE = {
  "weltraum-physik": "Weltraum & Physik",
  "natur-tiere": "Natur & Tiere",
  technik: "Technik & Maschinen",
  kuechenchemie: "Küchen-Chemie",
};

const woche = await query(
  `SELECT to_char(t.datum, 'DD.MM.') AS tag,
          t.datum,
          (t.geschafft_at IS NOT NULL) AS geschafft,
          e.titel, e.emoji, e.kategorie, e.fakt, e.nochmal
     FROM mint.tage t
     JOIN mint.experimente e ON e.id = t.experiment_id
    WHERE t.datum >  ((NOW() AT TIME ZONE 'Europe/Berlin')::date - $1::integer)
      AND t.datum <= (NOW() AT TIME ZONE 'Europe/Berlin')::date
    ORDER BY t.datum`,
  [TAGE], { job: true },
);

if (!woche.length) {
  console.log("Keine Tage im Zeitraum – nichts zu schreiben.");
  await closePools();
  process.exit(0);
}

const geschafft = woche.filter((t) => t.geschafft);
const verpasst = woche.filter((t) => !t.geschafft);
const behalten = geschafft.filter((t) => t.nochmal);

const von = woche[0].tag;
const bis = woche[woche.length - 1].tag;

const zeilen = [
  `MINT-Bot Woche ${von}–${bis}: ${geschafft.length} von ${woche.length} Experimenten geschafft.`,
  "",
];
if (geschafft.length) {
  zeilen.push("Gemacht:");
  for (const t of geschafft) {
    zeilen.push(`- ${t.tag} ${t.emoji} ${t.titel} (${KATEGORIE[t.kategorie] ?? t.kategorie})` +
      `${t.nochmal ? " – auf der Nochmal-Liste behalten" : ""}`);
    zeilen.push(`  ${t.fakt}`);
  }
  zeilen.push("");
}
if (verpasst.length) {
  zeilen.push("Keine Zeit gehabt (liegt im Fundus und kann wiederkommen):");
  for (const t of verpasst) zeilen.push(`- ${t.tag} ${t.emoji} ${t.titel} (${KATEGORIE[t.kategorie] ?? t.kategorie})`);
  zeilen.push("");
}
if (behalten.length) {
  zeilen.push(`Zum Wiederholen vorgemerkt: ${behalten.map((t) => t.titel).join(", ")}.`);
}

const content = zeilen.join("\n").trim();
const tags = ["mint", "kinder", "experimente"];
/* brain_items pflegt search_text nicht per Trigger, sondern in der
   Anwendung (siehe brain/app/db.py::_search_text). Wer das vergisst, schreibt
   eine Zeile, die brain_search nie findet. */
const searchText = [content, "mint-bot", ...tags].join(" ");

if (dryRun) {
  console.log("--- Dry-Run, es wird nichts geschrieben ---\n");
  console.log(content);
  await closePools();
  process.exit(0);
}

/* source/category/status sind CHECK-beschränkt – 'note'/'learn'/'inbox' sind
   gültige Werte. slack_ts bleibt NULL (der UNIQUE-Index dort ist die Dedupe-
   Logik des Slack-Pfads), dedupe_hash ist eine generierte Spalte und darf nie
   geschrieben werden. */
await query(
  `INSERT INTO public.brain_items
     (content, source, category, project, tags, status, importance, search_text, raw_metadata)
   VALUES ($1, 'note', 'learn', 'mint-bot', $2, 'inbox', 2, $3, $4::jsonb)`,
  [content, tags, searchText, JSON.stringify({ source_system: "mint-bot", von, bis, tage: TAGE })],
  { job: true },
);

console.log(`Wochen-Digest geschrieben (${von}–${bis}): ` +
  `${geschafft.length} geschafft, ${verpasst.length} verpasst, ${behalten.length} behalten.`);
await closePools();
