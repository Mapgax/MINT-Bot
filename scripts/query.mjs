#!/usr/bin/env node
// Themensuche auf der Kommandozeile – Datenquelle für den /mint-suche-Skill.
//
//   node scripts/query.mjs magnet              # Volltext über alle Status
//   node scripts/query.mjs magnet --status fundus
//   node scripts/query.mjs --status nochmal    # ohne Suchwort: alles im Status
//   node scripts/query.mjs --verlauf 30        # Tagesverlauf der letzten 30 Tage
//   node scripts/query.mjs --json ...          # maschinenlesbar
import { query, closePools, hasDb } from "../lib/db.js";

const argv = process.argv.slice(2);
const flagWert = (name) => {
  const i = argv.indexOf(name);
  return i > -1 ? argv[i + 1] : null;
};
const alsJson = argv.includes("--json");
const statusFilter = flagWert("--status");
const verlauf = flagWert("--verlauf");
const suchwort = argv.filter((a, i) =>
  !a.startsWith("--") && argv[i - 1] !== "--status" && argv[i - 1] !== "--verlauf").join(" ");

if (!hasDb()) {
  console.error("MINT_DB_URL_JOB fehlt – .env.local im MINT-Bot-Verzeichnis prüfen.");
  process.exit(1);
}

const ausgeben = (rows) => {
  if (alsJson) { console.log(JSON.stringify(rows, null, 2)); return; }
  if (!rows.length) { console.log("Keine Treffer."); return; }
  for (const r of rows) console.log(Object.values(r).join("  |  "));
};

if (verlauf) {
  ausgeben(await query(
    `SELECT to_char(t.datum,'YYYY-MM-DD') AS datum,
            CASE WHEN t.geschafft_at IS NOT NULL THEN 'geschafft'
                 WHEN t.datum >= (NOW() AT TIME ZONE 'Europe/Berlin')::date THEN 'offen'
                 ELSE 'verpasst' END AS ergebnis,
            e.titel, e.kategorie
       FROM mint.tage t JOIN mint.experimente e ON e.id = t.experiment_id
      WHERE t.datum > (NOW() AT TIME ZONE 'Europe/Berlin')::date - $1::integer
      ORDER BY t.datum DESC`,
    [Number(verlauf)], { job: true },
  ));
} else if (!suchwort) {
  ausgeben(await query(
    `SELECT status, titel, kategorie, fakt FROM mint.themen
      WHERE ($1::text IS NULL OR status = $1)
      ORDER BY status, titel`,
    [statusFilter], { job: true },
  ));
} else {
  /* Gleiche Zwei-Wege-Logik wie api/search.js: deutsches Stemming plus
     Substring-Fallback, weil Postgres keine Komposita zerlegt. */
  ausgeben(await query(
    `WITH q AS (SELECT plainto_tsquery('german', $1) AS ts)
     SELECT status, titel, kategorie, fakt, max(rang)::numeric(4,2) AS rang FROM (
       SELECT t.*, ts_rank_cd(to_tsvector('german', t.search_text), q.ts) + 1 AS rang
         FROM mint.themen t, q WHERE to_tsvector('german', t.search_text) @@ q.ts
       UNION ALL
       SELECT t.*, 0.1 AS rang FROM mint.themen t WHERE t.search_text ILIKE '%' || $1 || '%'
     ) treffer
      WHERE ($2::text IS NULL OR status = $2)
      GROUP BY id, status, titel, kategorie, fakt
      ORDER BY max(rang) DESC, titel`,
    [suchwort, statusFilter], { job: true },
  ));
}

await closePools();
