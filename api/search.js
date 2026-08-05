// Themensuche über alle Experimente – egal ob geschafft, archiviert, verpasst
// oder noch nie drangewesen. Speist das Suchfeld im Nochmal-Tab und den
// /mint-suche-Skill.
import { query, checkMintRequest } from "../lib/db.js";

const STATUS = new Set(["neu", "nochmal", "archiviert", "fundus"]);
const LIMIT = 40;

export default async function handler(req, res) {
  if (!checkMintRequest(req, res, { method: "GET" })) return;

  const q = String(req.query?.q ?? "").trim().slice(0, 100);
  const statusFilter = String(req.query?.status ?? "").split(",")
    .map((s) => s.trim()).filter((s) => STATUS.has(s));

  try {
    let rows;
    if (!q) {
      rows = await query(
        `SELECT id, titel, emoji, kategorie, dauer_minuten, status, daten
           FROM mint.themen
          WHERE ($1::text[] IS NULL OR status = ANY($1))
          ORDER BY titel
          LIMIT ${LIMIT}`,
        [statusFilter.length ? statusFilter : null],
      );
    } else {
      /* Zwei Wege, per UNION zusammengeführt:
         1. Volltext mit deutschem Stemming – findet "Magnet", wenn man
            "Magnete" tippt, und gewichtet nach Relevanz.
         2. Substring – Postgres' german-Config zerlegt keine Komposita, also
            findet die Volltextsuche "Luftballon" nicht über "Ballon". Der
            ILIKE-Zweig fängt das ab, mit niedrigerem Rang. */
      rows = await query(
        `WITH q AS (SELECT plainto_tsquery('german', $1) AS ts)
         SELECT id, titel, emoji, kategorie, dauer_minuten, status, daten, max(rang) AS rang
           FROM (
             SELECT t.*, ts_rank_cd(to_tsvector('german', t.search_text), q.ts) + 1 AS rang
               FROM mint.themen t, q
              WHERE to_tsvector('german', t.search_text) @@ q.ts
             UNION ALL
             SELECT t.*, 0.1 AS rang
               FROM mint.themen t
              WHERE t.search_text ILIKE '%' || $1 || '%'
           ) treffer
          WHERE ($2::text[] IS NULL OR status = ANY($2))
          GROUP BY id, titel, emoji, kategorie, dauer_minuten, status, daten
          ORDER BY rang DESC, titel
          LIMIT ${LIMIT}`,
        [q, statusFilter.length ? statusFilter : null],
      );
    }

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      treffer: rows.map((r) => ({
        id: r.id,
        titel: r.titel,
        emoji: r.emoji,
        kategorie: r.kategorie,
        dauerMinuten: r.dauer_minuten,
        status: r.status,
      })),
    });
  } catch (err) {
    console.error("search-Fehler:", err);
    res.status(502).json({ error: "Datenbank gerade nicht erreichbar." });
  }
}
