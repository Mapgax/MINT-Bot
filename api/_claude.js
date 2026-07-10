// Gemeinsame Logik für die LLM-Endpoints (Dateien mit "_" werden von Vercel
// nicht als Endpoint deployt).
import Anthropic from "@anthropic-ai/sdk";

// Muss zum APP_TOKEN in app.js passen. Einfacher Mitbenutzungs-Schutz,
// kein echtes Geheimnis (steht im Client-Code) – Backstop ist das
// Spending-Limit im Anthropic-Dashboard.
const APP_TOKEN = process.env.MINT_APP_TOKEN || "mint-bot-familie";

export const SYSTEM_PROMPT = `Du bist der freundliche Erklär-Helfer einer Experimente-App für ein interessiertes 6-jähriges Kind (Autismus-Spektrum und ADHS). Ein Elternteil liest deine Antwort meist vor.

Regeln:
- Antworte auf Deutsch, in kurzen, konkreten Sätzen.
- Sei wörtlich und präzise: keine Ironie, keine Redewendungen, Metaphern nur mit sofortiger Auflösung ("...so ähnlich wie..., das heißt...").
- Maximal 4-5 Sätze. Ein Gedanke pro Satz.
- Bleib sachlich richtig, aber vereinfache mutig.
- Sag niemals, dass etwas "Magie" oder "Zauberei" ist - erkläre, was wirklich passiert.
- Wenn nach etwas Gefährlichem gefragt wird (Feuer, Strom, Chemikalien), sage freundlich, dass das nur Erwachsene machen.`;

export function checkRequest(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Nur POST erlaubt" });
    return false;
  }
  if ((req.headers["x-mint-token"] || "") !== APP_TOKEN) {
    res.status(403).json({ error: "Ungültiges Token" });
    return false;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(501).json({ error: "Der Erklär-Helfer ist noch nicht eingerichtet (ANTHROPIC_API_KEY fehlt)." });
    return false;
  }
  return true;
}

export function clip(value, maxLen) {
  return String(value ?? "").slice(0, maxLen);
}

export async function askClaude(res, userPrompt) {
  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });
    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (!text) {
      res.status(502).json({ error: "Leere Antwort vom Erklär-Helfer" });
      return;
    }
    res.status(200).json({ text });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: "Gerade zu viele Fragen - probiert es gleich nochmal." });
    } else if (err instanceof Anthropic.AuthenticationError) {
      res.status(501).json({ error: "Der Erklär-Helfer ist falsch eingerichtet (API-Key ungültig)." });
    } else {
      console.error("Claude-API-Fehler:", err);
      res.status(502).json({ error: "Der Erklär-Helfer ist gerade nicht erreichbar." });
    }
  }
}
