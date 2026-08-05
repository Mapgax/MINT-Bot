// Nimmt die gepufferten Ereignisse der App entgegen (Sync-Queue in app.js).
// Bewusst als Batch: das Tablet ist oft offline und schiebt dann mehrere
// Ereignisse auf einmal nach.
//
// Alles hier ist idempotent – die App darf denselben Batch beliebig oft
// senden, ohne dass etwas doppelt oder falsch wird.
import { query, checkMintRequest } from "../lib/db.js";

const MAX_EVENTS = 500;
const ISO_DATUM = /^\d{4}-\d{2}-\d{2}$/;

export default async function handler(req, res) {
  if (!checkMintRequest(req, res, { method: "POST" })) return;

  const events = Array.isArray(req.body?.events) ? req.body.events : null;
  if (!events) {
    res.status(400).json({ error: "events[] fehlt" });
    return;
  }
  if (events.length > MAX_EVENTS) {
    res.status(413).json({ error: `Maximal ${MAX_EVENTS} Ereignisse pro Anfrage` });
    return;
  }

  let angewendet = 0;
  const abgelehnt = [];

  try {
    for (const ev of events) {
      const id = String(ev?.experimentId ?? "");
      if (!id) { abgelehnt.push({ ev, grund: "experimentId fehlt" }); continue; }

      if (ev.typ === "geschafft") {
        if (!ISO_DATUM.test(String(ev.datum ?? ""))) {
          abgelehnt.push({ ev, grund: "ungültiges Datum" });
          continue;
        }
        /* COALESCE hält den ersten Zeitpunkt fest: ein erneut gesendetes
           Ereignis darf das ursprüngliche "geschafft" nicht nach hinten
           verschieben. Zurücknehmen kann die App es nicht – die Karte zeigt
           nach dem Tippen dauerhaft den Erfolgs-Banner. */
        const rows = await query(
          `INSERT INTO mint.tage (datum, experiment_id, geschafft_at, quelle, updated_at)
           VALUES ($1, $2, COALESCE($3::timestamptz, NOW()), 'app', NOW())
           ON CONFLICT (datum) DO UPDATE SET
             experiment_id = EXCLUDED.experiment_id,
             geschafft_at  = COALESCE(mint.tage.geschafft_at, EXCLUDED.geschafft_at),
             quelle        = 'app',
             updated_at    = NOW()
           RETURNING datum`,
          [ev.datum, id, ev.ts ?? null],
        );
        if (rows.length) angewendet++;

      } else if (ev.typ === "nochmal") {
        /* nochmal_tauglich = false gewinnt immer: solche Experimente sollen
           nicht auf der Nochmal-Liste landen, auch wenn ein alter Client noch
           einen Stern dafür schickt. */
        const rows = await query(
          `UPDATE mint.experimente
              SET nochmal = ($2 AND nochmal_tauglich)
            WHERE id = $1
            RETURNING id`,
          [id, ev.wert !== false],
        );
        if (rows.length) angewendet++;
        else abgelehnt.push({ ev, grund: "unbekannte experimentId" });

      } else {
        abgelehnt.push({ ev, grund: `unbekannter Typ '${ev.typ}'` });
      }
    }

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ angewendet, abgelehnt: abgelehnt.length, details: abgelehnt.slice(0, 10) });
  } catch (err) {
    console.error("events-Fehler:", err);
    // 502 statt 400: die App soll die Queue behalten und es später nochmal
    // versuchen, nicht die Ereignisse wegwerfen.
    res.status(502).json({ error: "Datenbank gerade nicht erreichbar." });
  }
}
