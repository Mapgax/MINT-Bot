// "❓ Hilfe"-Button: erklärt einen Experiment-Schritt einfacher.
import { checkRequest, clip, askClaude } from "./_claude.js";

export default async function handler(req, res) {
  if (!checkRequest(req, res)) return;
  const titel = clip(req.body?.titel, 200);
  const fakt = clip(req.body?.fakt, 600);
  const schritt = clip(req.body?.schritt, 400);
  if (!schritt) {
    res.status(400).json({ error: "schritt fehlt" });
    return;
  }
  await askClaude(
    res,
    `Wir machen gerade das Experiment "${titel}". Darum geht es: ${fakt}\n\nDieser Schritt ist unklar: "${schritt}"\n\nErkläre dem Kind diesen Schritt noch einfacher und konkreter - was genau soll es mit den Händen tun? Gib höchstens einen kleinen Tipp, falls es oft schiefgeht.`
  );
}
