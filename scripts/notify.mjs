#!/usr/bin/env node
// Schickt die tägliche ntfy-Push-Nachricht.
//   node scripts/notify.mjs morgen   → Tageskarte (läuft nur um 7 Uhr Berlin-Zeit)
//   node scripts/notify.mjs abend    → Vorschau für Eltern (nur um 19 Uhr) + Nachschub-Warnung
// Flags: --dry-run (nur ausgeben, nichts senden), --force (Uhrzeit-Prüfung überspringen)
// Env: NTFY_TOPIC (Pflicht fürs Senden), APP_URL (Link in der Nachricht)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const mode = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");

const NTFY_TOPIC = process.env.NTFY_TOPIC || "mint-bot-1e55da271c89";
const APP_URL = process.env.APP_URL || "https://mint-bot-nine.vercel.app";
const WARN_DAYS = 10; // Nachschub-Warnung, wenn der Schedule nur noch so viele Tage abdeckt

if (mode !== "morgen" && mode !== "abend") {
  console.error("Aufruf: node scripts/notify.mjs <morgen|abend> [--dry-run] [--force]");
  process.exit(1);
}

const berlin = (options) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", ...options });
const today = berlin({ dateStyle: "short" }).format(new Date());
const hour = Number(berlin({ hour: "2-digit", hour12: false }).format(new Date()));

// Der GitHub-Cron läuft je Slot zweimal (wegen Sommer-/Winterzeit); nur der Lauf
// mit der passenden Berlin-Stunde sendet wirklich.
const targetHour = mode === "morgen" ? 7 : 19;
if (!force && hour !== targetHour) {
  console.log(`Berlin-Stunde ist ${hour}, Ziel ist ${targetHour} – nichts zu tun (DST-Doppel-Cron).`);
  process.exit(0);
}

const experiments = JSON.parse(readFileSync(join(root, "data/experiments.json"), "utf8"));
const schedule = JSON.parse(readFileSync(join(root, "data/schedule.json"), "utf8"));
const byId = new Map(experiments.map((e) => [e.id, e]));

function experimentForDate(dateStr) {
  const exp = byId.get(schedule[dateStr]);
  if (exp) return exp;
  let hash = 0;
  for (const ch of dateStr) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return experiments[hash % experiments.length];
}

const SENSORIK_ICON = { laut: "🔊", nass: "💧", matschig: "🟤", klebrig: "🍯", riecht: "👃", knall: "💥", dunkel: "🌑", sprudelt: "🫧", kalt: "❄️" };

const messages = [];

if (mode === "morgen") {
  const exp = experimentForDate(today);
  const icons = exp.sensorik.map((s) => SENSORIK_ICON[s]).join("");
  messages.push({
    title: `${exp.emoji} Heute: ${exp.titel}`,
    body: `${exp.fakt}\n⏱️ ca. ${exp.dauerMinuten} Min ${icons}${exp.wartezeit ? `\n⏳ Wartezeit: ${exp.wartezeit}` : ""}`,
    tags: ["microscope"],
    click: APP_URL,
  });
} else {
  const tomorrow = new Date(today + "T12:00:00Z");
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  const exp = experimentForDate(tomorrowStr);
  messages.push({
    title: `🌙 Morgen: ${exp.titel} ${exp.emoji}`,
    body: `Material bereitlegen und ankündigen:\n🧺 ${exp.material.join(", ")}\n👋 ${exp.elternInfo}`,
    tags: ["crescent_moon"],
    click: `${APP_URL}#morgen`,
  });

  // Nachschub-Warnung: Wie viele Tage deckt der Schedule ab heute noch ab?
  const futureDates = Object.keys(schedule).filter((d) => d >= today);
  if (futureDates.length <= WARN_DAYS) {
    messages.push({
      title: `⚠️ Nur noch ${futureDates.length} Tage geplant!`,
      body: `Der Experimente-Plan geht bald aus. Starte eine Claude-Code-Session auf dem MINT-Bot-Repo und ruf /mint-experimente auf – Claude generiert Nachschub als Pull Request.`,
      tags: ["warning"],
      priority: 4,
      click: "https://github.com/Mapgax/MINT-Bot",
    });
  }
}

for (const msg of messages) {
  console.log(`\n--- ${msg.title} ---\n${msg.body}`);
  if (dryRun) continue;
  const res = await fetch("https://ntfy.sh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: NTFY_TOPIC,
      title: msg.title,
      message: msg.body,
      tags: msg.tags,
      click: msg.click,
      priority: msg.priority ?? 3,
    }),
  });
  if (!res.ok) {
    console.error(`ntfy-Versand fehlgeschlagen: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  console.log("→ gesendet ✔");
}
if (dryRun) console.log("\n(--dry-run: nichts gesendet)");
