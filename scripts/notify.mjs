#!/usr/bin/env node
// Schickt die tägliche ntfy-Push-Nachricht.
//   node scripts/notify.mjs morgen   → Tageskarte (läuft nur um 7 Uhr Berlin-Zeit)
//   node scripts/notify.mjs abend    → Vorschau für Eltern (nur um 19 Uhr) + Nachschub-Warnung
// Flags: --dry-run (nur ausgeben, nichts senden), --force (Uhrzeit-Prüfung überspringen)
// Env: NTFY_TOPIC (Pflicht fürs Senden), APP_URL (Link in der Nachricht)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { query, closePools, hasDb } from "../lib/db.js";

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

/* Zeitfenster statt exakter Stunde. GitHub startet Cron-Jobs zwischen pünktlich
   und gut anderthalb Stunden zu spät; eine Exakt-Prüfung verwirft die Nachricht
   dann stillschweigend, und der Lauf meldet trotzdem Erfolg. Mehrere Slots
   fallen jetzt absichtlich ins selbe Fenster – welcher davon tatsächlich sendet,
   entscheidet mint.pushes weiter unten. */
const WINDOW_HOURS = 3;
const targetHour = mode === "morgen" ? 7 : 19;
if (!force && (hour < targetHour || hour > targetHour + WINDOW_HOURS)) {
  console.log(`Berlin-Stunde ist ${hour}, Fenster ist ${targetHour}–${targetHour + WINDOW_HOURS} – nichts zu tun.`);
  process.exit(0);
}

const experiments = JSON.parse(readFileSync(join(root, "data/experiments.json"), "utf8"));
const schedule = JSON.parse(readFileSync(join(root, "data/schedule.json"), "utf8"));
const byId = new Map(experiments.map((e) => [e.id, e]));

/* Status aus der DB, damit die Push-Nachricht dasselbe ankündigt, was die App
   zeigt. Ohne DB-Zugang wird der Plan unverändert verschickt – die Nachricht
   ist wichtiger als die Genauigkeit. */
const status = {};
if (hasDb()) {
  try {
    for (const r of await query(`SELECT id, status FROM mint.themen`, [], { job: true })) {
      status[r.id] = r.status;
    }
  } catch (err) {
    console.warn(`⚠️  Status nicht abrufbar (${err.message}) – sende nach Plan.`);
  }
}

function dateHash(dateStr) {
  let hash = 0;
  for (const ch of dateStr) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash;
}

/* Muss Zeichen für Zeichen zu ersatzFuer() in app.js passen – beide leiten aus
   demselben Datum und derselben Experiment-Reihenfolge denselben Ersatz ab.
   Weicht eine Seite ab, kündigt der Push etwas anderes an, als die App zeigt. */
function experimentForDate(dateStr) {
  let exp = byId.get(schedule[dateStr]);
  if (!exp) exp = experiments[dateHash(dateStr) % experiments.length];
  if (status[exp.id] !== "archiviert") return exp;

  const offen = experiments.filter((e) => status[e.id] !== "archiviert");
  if (!offen.length) return exp;
  const fundus = offen.filter((e) => status[e.id] === "fundus");
  const topf = fundus.length ? fundus : offen;
  return topf[dateHash(dateStr) % topf.length];
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

/* Der Anspruch auf den heutigen Versand. Genau ein Lauf gewinnt den INSERT,
   alle weiteren Slots im selben Fenster laufen ins DO NOTHING und schweigen.

   Ohne DB fällt das auf das alte Verhalten zurück – exakte Stunde – statt aufs
   Senden: bei mehreren Slots im Fenster wären sonst mehrere Nachrichten die
   Folge, und drei Pushes hintereinander sind für dieses Kind schlimmer als
   einer zu wenig. */
async function beanspruchePush() {
  if (force || dryRun) return true;
  if (!hasDb()) {
    if (hour === targetHour) return true;
    console.log(`Keine DB erreichbar und Berlin-Stunde ${hour} ist nicht exakt ${targetHour} – ich schweige lieber.`);
    return false;
  }
  try {
    const rows = await query(
      `INSERT INTO mint.pushes (datum, modus) VALUES ($1, $2)
       ON CONFLICT (datum, modus) DO NOTHING
       RETURNING datum`,
      [today, mode], { job: true },
    );
    if (!rows.length) {
      console.log(`${mode} für ${today} wurde bereits gesendet – nichts zu tun.`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`⚠️  Anspruch nicht speicherbar (${err.message}) – sende nur bei exakter Stunde.`);
    return hour === targetHour;
  }
}

/* Anspruch wieder freigeben, wenn der Versand scheiterte – sonst wäre der Tag
   verbrannt und der nächste Slot würde die Nachricht nicht mehr nachholen. */
async function gibPushFrei() {
  if (force || dryRun || !hasDb()) return;
  try {
    await query(`DELETE FROM mint.pushes WHERE datum = $1 AND modus = $2`, [today, mode], { job: true });
  } catch { /* dann eben nicht – besser als ein Absturz im Fehlerpfad */ }
}

if (!(await beanspruchePush())) {
  await closePools();
  process.exit(0);
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
    await gibPushFrei();
    await closePools();
    process.exit(1);
  }
  console.log("→ gesendet ✔");
}
if (dryRun) console.log("\n(--dry-run: nichts gesendet)");
await closePools();
