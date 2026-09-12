// Ausschließlich IDs aus der echten Nochmal-View; keine Historie oder Kinderdaten.
import { createHash, timingSafeEqual } from "node:crypto";
import { query, loadEnv } from "../lib/db.js";

export function createHandler(runQuery = query, env = process.env) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("Vary", "X-Erklaerbaer-Read-Token");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Nur GET erlaubt" });
    }
    loadEnv();
    const expected = env.ERKLAERBAER_READ_TOKEN || "";
    // Distinct header AND credential: the read token cannot be a write credential.
    if (expected.length < 32 || expected === env.MINT_WRITE_TOKEN || !env.MINT_DB_URL) {
      return res.status(503).json({ error: "Produktionsfeed nicht eingerichtet" });
    }
    const supplied = req.headers["x-erklaerbaer-read-token"];
    if (typeof supplied !== "string" || Buffer.byteLength(supplied) !== Buffer.byteLength(expected)
        || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
      return res.status(403).json({ error: "Ungültiges Lesetoken" });
    }
    try {
      const rows = await runQuery(`SELECT id FROM mint.themen
        WHERE status = 'nochmal' AND nochmal_tauglich = TRUE ORDER BY id`);
      const ids = rows.map(row => row.id).sort();
      if (new Set(ids).size !== ids.length || ids.some(id => !/^[a-z0-9-]+$/.test(id))) {
        throw new Error("Ungültige Themen-IDs");
      }
      const revision = createHash("sha256").update(JSON.stringify(ids)).digest("hex");
      return res.status(200).json({ schema_version: 1, topic_ids: ids, revision });
    } catch {
      // Never log raw DB errors, connection details or private query results.
      return res.status(502).json({ error: "Produktionsfeed gerade nicht verfügbar" });
    }
  };
}
export default createHandler();
