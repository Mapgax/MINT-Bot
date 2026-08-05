#!/usr/bin/env node
// Spiegelt data/experiments.json und data/schedule.json in das Schema `mint`.
// data/*.json bleibt die Quelle der Wahrheit – die DB ist der durchsuchbare
// Abzug davon plus der Status, den die App dazuschreibt.
//
// Idempotent: mehrfaches Ausführen ändert nichts. Der Status (`nochmal`) und
// bereits abgehakte Tage werden NIE überschrieben.
//
// Aufruf: node scripts/sync-experiments.mjs [--dry-run]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { query, closePools, hasDb } from "../lib/db.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const experiments = JSON.parse(readFileSync(join(root, "data/experiments.json"), "utf8"));
const schedule = JSON.parse(readFileSync(join(root, "data/schedule.json"), "utf8"));
const dryRun = process.argv.includes("--dry-run");

const KATEGORIE_LABEL = {
  "weltraum-physik": "Weltraum Physik Astronomie",
  "natur-tiere": "Natur Tiere Pflanzen Biologie",
  technik: "Technik Maschinen Werkzeug",
  kuechenchemie: "Küchen-Chemie Chemie Reaktion",
};

// Was die Volltextsuche finden soll. Bewusst großzügig: lieber ein Treffer zu
// viel als ein Thema, das man nicht wiederfindet, weil das gesuchte Wort nur
// in der Erklärung stand.
function searchText(exp) {
  return [
    exp.titel,
    exp.fakt,
    exp.wasPassiert,
    exp.erklaerung,
    KATEGORIE_LABEL[exp.kategorie] ?? exp.kategorie,
    exp.sensorik.join(" "),
    exp.material.join(" "),
  ].filter(Boolean).join(" \n");
}

const berlinToday = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());

if (!hasDb()) {
  console.error("MINT_DB_URL_JOB fehlt (.env.local oder Env-Var). Abbruch.");
  process.exit(1);
}

if (dryRun) {
  console.log(`Dry-Run: ${experiments.length} Experimente, ` +
    `${Object.keys(schedule).filter((d) => d <= berlinToday()).length} vergangene/heutige Schedule-Tage.`);
  process.exit(0);
}

// ---------- Experimente ----------
// nochmal (der Stern) steht bewusst NICHT im UPDATE-Teil: den setzt die App.
let geaendert = 0;
for (const exp of experiments) {
  const rows = await query(
    `INSERT INTO mint.experimente
       (id, titel, emoji, kategorie, fakt, erklaerung, dauer_minuten,
        sensorik, nochmal_tauglich, daten, search_text, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW())
     ON CONFLICT (id) DO UPDATE SET
       titel = EXCLUDED.titel,
       emoji = EXCLUDED.emoji,
       kategorie = EXCLUDED.kategorie,
       fakt = EXCLUDED.fakt,
       erklaerung = EXCLUDED.erklaerung,
       dauer_minuten = EXCLUDED.dauer_minuten,
       sensorik = EXCLUDED.sensorik,
       nochmal_tauglich = EXCLUDED.nochmal_tauglich,
       daten = EXCLUDED.daten,
       search_text = EXCLUDED.search_text,
       synced_at = NOW()
     RETURNING (xmax = 0) AS neu`,
    [
      exp.id, exp.titel, exp.emoji, exp.kategorie, exp.fakt, exp.erklaerung,
      exp.dauerMinuten, exp.sensorik, exp.nochmalTauglich !== false,
      JSON.stringify(exp), searchText(exp),
    ],
    { job: true },
  );
  if (rows[0]?.neu) geaendert++;
}

// ---------- Tage ----------
// Nur Vergangenheit und heute: zukünftige Schedule-Einträge sind ein Plan, kein
// Ereignis, und würden die Fundus-Ableitung verfälschen, sobald der Tag da ist.
const heute = berlinToday();
const vergangen = Object.entries(schedule)
  .filter(([datum, id]) => datum <= heute && experiments.some((e) => e.id === id));

/* quelle unterscheidet, wem die Zeile gehört:
     'schedule' – von hier angelegt, noch nie in der App angefasst. Darf
                  korrigiert werden, wenn sich schedule.json geändert hat.
     'app'      – das Kind hat den Tag abgehakt, oder die Archiv-Regel hat ein
                  anderes Experiment eingesetzt. Bleibt unangetastet. */
let tageNeu = 0;
let tageKorrigiert = 0;
for (const [datum, id] of vergangen) {
  const rows = await query(
    `INSERT INTO mint.tage (datum, experiment_id, quelle)
     VALUES ($1, $2, 'schedule')
     ON CONFLICT (datum) DO UPDATE SET
       experiment_id = EXCLUDED.experiment_id,
       updated_at    = NOW()
     WHERE mint.tage.quelle = 'schedule'
       AND mint.tage.experiment_id <> EXCLUDED.experiment_id
     RETURNING (xmax = 0) AS neu`,
    [datum, id],
    { job: true },
  );
  if (rows.length && rows[0].neu) tageNeu++;
  else if (rows.length) tageKorrigiert++;
}

const status = await query(
  `SELECT status, count(*)::int AS anzahl FROM mint.themen GROUP BY status ORDER BY status`,
  [], { job: true },
);

console.log(`Experimente: ${experiments.length} gespiegelt (${geaendert} neu)`);
console.log(`Tage: ${vergangen.length} bis ${heute} (${tageNeu} neu, ${tageKorrigiert} korrigiert)`);
console.log("Status:", status.map((r) => `${r.status}=${r.anzahl}`).join("  "));

await closePools();
