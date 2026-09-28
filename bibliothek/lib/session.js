/* Zugang zur Bibliothek: ein Code pro Person, kein gemeinsames Passwort.
   So lässt sich eine einzelne Person sperren, ohne allen einen neuen Code
   zu schicken.

   BIB_ZUGAENGE  "anna:code,familie-meier:code" – gepflegt ausschließlich von
                 scripts/zugang.mjs (Quelle: lokale Vault-Notiz, nie das Repo)
   BIB_SESSION_SECRET  zufälliger Schlüssel für die Cookie-Signatur

   Diese Seite hat absichtlich KEINEN Zugriff auf die MINT-Datenbank: sie kann
   das Original gar nicht verändern, egal was jemand hier anklickt. */
import { createHmac, timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";

export const COOKIE = "bib_session";
export const LAUFZEIT_TAGE = 180;

function gleich(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && nodeTimingSafeEqual(x, y);
}

/** Name → Code aus BIB_ZUGAENGE. Ungültige Einträge werden ignoriert. */
export function zugaenge(env = process.env) {
  const map = new Map();
  for (const eintrag of String(env.BIB_ZUGAENGE || "").split(",")) {
    const [name, code] = eintrag.trim().split(":");
    if (name && code && /^[a-z0-9-]+$/.test(name) && code.length >= 16) map.set(name, code);
  }
  return map;
}

function secret(env) {
  const s = env.BIB_SESSION_SECRET || "";
  return s.length >= 32 ? s : null;
}

export function eingerichtet(env = process.env) {
  return Boolean(secret(env)) && zugaenge(env).size > 0;
}

/** Name zum Code, sonst null. Vergleicht jeden Eintrag, damit die Laufzeit
    nicht verrät, an welcher Stelle ein Treffer lag. */
export function nameFuerCode(code, env = process.env) {
  let treffer = null;
  for (const [name, erwartet] of zugaenge(env)) {
    if (gleich(code, erwartet)) treffer = name;
  }
  return treffer;
}

function signatur(nutzlast, env) {
  return createHmac("sha256", secret(env)).update(nutzlast).digest("base64url");
}

export function neuesCookie(name, env = process.env) {
  const ablauf = Math.floor(Date.now() / 1000) + LAUFZEIT_TAGE * 86400;
  const wert = `${name}.${ablauf}.${signatur(`${name}.${ablauf}`, env)}`;
  return `${COOKIE}=${wert}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${LAUFZEIT_TAGE * 86400}`;
}

export const loeschCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

/** Name der angemeldeten Person oder null. Gesperrt = nicht mehr in
    BIB_ZUGAENGE, dann gilt auch ein noch nicht abgelaufenes Cookie nicht. */
export function angemeldet(req, env = process.env) {
  if (!secret(env)) return null;
  const roh = String(req.headers.cookie || "")
    .split(";").map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`));
  if (!roh) return null;
  const [name, ablauf, sig] = roh.slice(COOKIE.length + 1).split(".");
  if (!name || !ablauf || !sig) return null;
  if (!gleich(sig, signatur(`${name}.${ablauf}`, env))) return null;
  if (Number(ablauf) < Date.now() / 1000) return null;
  if (!zugaenge(env).has(name)) return null;
  return name;
}

/* Rate-Limit wie in lib/db.js der Haupt-App: Zähler pro IP im
   Prozessspeicher. Reicht, um Code-Raten unattraktiv zu machen. */
const hits = new Map();
export function rateLimited(req, { fenster = 15 * 60_000, max = 10 } = {}) {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || "unbekannt";
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.start > fenster) {
    hits.set(ip, { start: now, count: 1 });
    if (hits.size > 500) for (const [k, v] of hits) if (now - v.start > fenster) hits.delete(k);
    return false;
  }
  entry.count++;
  return entry.count > max;
}
