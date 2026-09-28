// Tauscht einen persönlichen Zugangscode gegen ein signiertes Session-Cookie.
import { nameFuerCode, neuesCookie, eingerichtet, rateLimited } from "../lib/session.js";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Nur POST erlaubt" });
  }
  if (!eingerichtet()) return res.status(503).json({ error: "Die Bibliothek ist noch nicht eingerichtet." });
  if (rateLimited(req)) return res.status(429).json({ error: "Zu viele Versuche. Bitte in 15 Minuten nochmal." });

  const code = String(req.body?.code ?? "").trim().slice(0, 200);
  const name = code ? nameFuerCode(code) : null;
  if (!name) return res.status(403).json({ error: "Dieser Code stimmt nicht." });

  console.info(`Bibliothek: Anmeldung von "${name}"`);
  res.setHeader("Set-Cookie", neuesCookie(name));
  return res.status(200).json({ ok: true });
}
