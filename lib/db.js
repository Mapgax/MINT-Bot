/* Gemeinsame DB-Anbindung für die api/-Endpoints UND die scripts/.
   Liegt außerhalb von api/, damit Vercel die Datei nicht als Endpoint deployt
   und die Scripts sie trotzdem importieren können. */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Lokal kommen die Secrets aus .env.local, auf Vercel und in GitHub Actions
// aus echten Env-Vars. loadEnvFile überschreibt bereits gesetzte Werte nicht.
let envLoaded = false;
export function loadEnv() {
  if (envLoaded) return;
  envLoaded = true;
  const file = join(root, ".env.local");
  if (existsSync(file)) {
    try { process.loadEnvFile(file); } catch { /* egal, dann eben Prozess-Env */ }
  }
}

/* Aiven liegt hier auf einem Plan mit max_connections = 20, von denen der
   Second-Brain-Stack schon rund 12 hält. Connection Pooling (PgBouncer) gibt
   es auf dem Plan nicht, also begrenzen wir hart auf eine Verbindung pro
   Prozess und geben sie schnell wieder frei. Fluid Compute hält nur wenige
   Instanzen warm – das bleibt deutlich unter dem Limit. */
const pools = new Map();
function poolFor(connectionString) {
  if (!pools.has(connectionString)) {
    /* Aiven erzwingt TLS, signiert aber mit einer eigenen CA, die hier nicht
       vorliegt – genau wie im second_brain-Stack. Seit node-postgres 8.16 wird
       ein `sslmode=require` IN der URL allerdings als verify-full ausgelegt und
       schlägt damit fehl. Deshalb: sslmode aus der URL entfernen und die
       TLS-Einstellung explizit als Objekt setzen. Die URL selbst behält den
       Parameter, damit dieselbe Zeichenkette auch für psql funktioniert. */
    const url = new URL(connectionString);
    url.searchParams.delete("sslmode");
    pools.set(connectionString, new pg.Pool({
      connectionString: url.toString(),
      max: 1,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
      ssl: { rejectUnauthorized: false },
    }));
  }
  return pools.get(connectionString);
}

/** Führt eine Query aus. `job: true` nimmt die Rolle mit Schreibrecht auf
    brain_items (nur für Scripts und Cron, nie für die Web-App). */
export async function query(sql, params = [], { job = false } = {}) {
  loadEnv();
  const url = job
    ? (process.env.MINT_DB_URL_JOB || process.env.MINT_DB_URL)
    : process.env.MINT_DB_URL;
  if (!url) throw new Error("MINT_DB_URL fehlt");
  const result = await poolFor(url).query(sql, params);
  return result.rows;
}

export function hasDb() {
  loadEnv();
  return Boolean(process.env.MINT_DB_URL || process.env.MINT_DB_URL_JOB);
}

export async function closePools() {
  await Promise.all([...pools.values()].map((p) => p.end()));
  pools.clear();
}

// ---------------------------------------------------------------------------
// Zugriffsschutz für die Endpoints
// ---------------------------------------------------------------------------

/* Anders als der APP_TOKEN der LLM-Endpoints steht dieses Token NICHT im
   Client-Code – es wird pro Gerät einmal im Eltern-Bereich eingegeben. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* Rate-Limit: einfacher Zähler pro IP im Prozessspeicher. Für einen
   Familien-Endpoint ausreichend – es geht darum, dass niemand die DB mit
   Anfragen flutet, nicht um verteilte Angreifer. */
const hits = new Map();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 120;

function rateLimited(req) {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || "unbekannt";
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.start > WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 });
    if (hits.size > 500) for (const [k, v] of hits) if (now - v.start > WINDOW_MS) hits.delete(k);
    return false;
  }
  entry.count++;
  return entry.count > MAX_PER_WINDOW;
}

/** Prüft Methode, Token und Rate-Limit. Gibt false zurück, wenn schon
    geantwortet wurde. */
export function checkMintRequest(req, res, { method = "GET" } = {}) {
  if (req.method !== method) {
    res.status(405).json({ error: `Nur ${method} erlaubt` });
    return false;
  }
  const readToken = process.env.ERKLAERBAER_READ_TOKEN;
  if (readToken && timingSafeEqual(String(req.headers["x-mint-token"] || ""), readToken)) {
    res.status(403).json({ error: "Lesetoken erlaubt keine App-Zugriffe" });
    return false;
  }
  const expected = process.env.MINT_WRITE_TOKEN;
  if (!expected) {
    res.status(501).json({ error: "Nicht eingerichtet (MINT_WRITE_TOKEN fehlt)." });
    return false;
  }
  if (!timingSafeEqual(String(req.headers["x-mint-token"] || ""), expected)) {
    res.status(403).json({ error: "Ungültiges Token" });
    return false;
  }
  if (!process.env.MINT_DB_URL) {
    res.status(501).json({ error: "Nicht eingerichtet (MINT_DB_URL fehlt)." });
    return false;
  }
  if (rateLimited(req)) {
    res.status(429).json({ error: "Zu viele Anfragen – gleich nochmal probieren." });
    return false;
  }
  return true;
}
