// Liefert der App den serverseitigen Stand: Status je Experiment und die
// Tages-Historie. Damit funktioniert die App auch auf einem frischen Gerät
// (iPhone, Mac), auf dem noch nichts im localStorage steht.
import { query, checkMintRequest } from "../lib/db.js";

export default async function handler(req, res) {
  if (!checkMintRequest(req, res, { method: "GET" })) return;
  try {
    const [themen, tage] = await Promise.all([
      query(`SELECT id, status, nochmal, nochmal_tauglich FROM mint.themen`),
      // Ein Jahr reicht: älteres beantwortet die Suche, nicht die Tagesansicht.
      query(`SELECT to_char(datum, 'YYYY-MM-DD') AS datum, experiment_id,
                    (geschafft_at IS NOT NULL) AS geschafft
               FROM mint.tage
              WHERE datum > (NOW() AT TIME ZONE 'Europe/Berlin')::date - 365
              ORDER BY datum DESC`),
    ]);

    const status = {};
    const nochmal = [];
    const archiviert = [];
    const fundus = [];
    for (const t of themen) {
      status[t.id] = t.status;
      if (t.status === "nochmal") nochmal.push(t.id);
      else if (t.status === "archiviert") archiviert.push(t.id);
      else if (t.status === "fundus") fundus.push(t.id);
    }

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      status,
      nochmal,
      archiviert,
      fundus,
      tage: tage.map((t) => ({ datum: t.datum, id: t.experiment_id, geschafft: t.geschafft })),
    });
  } catch (err) {
    console.error("state-Fehler:", err);
    res.status(502).json({ error: "Datenbank gerade nicht erreichbar." });
  }
}
