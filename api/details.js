// "🔍 Mehr wissen"-Button: vertieft das Thema kindgerecht, optional mit eigener Frage.
import { checkRequest, clip, askClaude } from "./_claude.js";

export default async function handler(req, res) {
  if (!checkRequest(req, res)) return;
  const titel = clip(req.body?.titel, 200);
  const fakt = clip(req.body?.fakt, 600);
  const erklaerung = clip(req.body?.erklaerung, 1000);
  const frage = clip(req.body?.frage, 300);
  const auftrag = frage
    ? `Das Kind fragt dazu: "${frage}"\n\nBeantworte genau diese Frage kindgerecht.`
    : `Erzähle dem Kind eine spannende Zusatz-Info zu diesem Thema, die über die Erklärung hinausgeht - etwas Konkretes zum Staunen (eine Zahl, ein Tier, ein Ort, eine Maschine).`;
  await askClaude(
    res,
    `Wir haben gerade das Experiment "${titel}" gemacht. Der Fakt dazu: ${fakt}\nDie Erklärung dazu war: ${erklaerung}\n\n${auftrag}`
  );
}
