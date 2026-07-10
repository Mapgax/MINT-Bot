# MINT-Bot

Täglicher Science Fact mit Heim-Experiment für ein neurodivergentes Kind (geb. 2020, ASS + ADHS). Statische Web-App (Vanilla JS, kein Build-Step) + Vercel Serverless Functions + GitHub-Actions-Cron für ntfy-Push.

## Architektur

- `index.html` / `style.css` / `app.js` — Web-App (Tabs: Heute, Morgen, Nochmal, Geschafft). Fortschritt in `localStorage`.
- `data/experiments.json` — kuratierter Pool (Schema: siehe `.claude/skills/mint-experimente/SKILL.md`).
- `data/schedule.json` — Datum → Experiment-ID. Frontend und Notify-Script lesen dieselbe Datei.
- `api/help.js`, `api/details.js` — LLM-Erklär-Helfer (Claude Haiku via `@anthropic-ai/sdk`, braucht `ANTHROPIC_API_KEY` als Vercel-Env-Var). Gemeinsame Logik in `api/_claude.js`.
- `scripts/` — `validate.mjs` (Schema-Check), `build-schedule.mjs` (Schedule verlängern), `notify.mjs` (ntfy-Push).
- `.github/workflows/notify.yml` — Cron: morgens Tageskarte, abends Eltern-Vorschau + ⚠️-Warnung bei ≤10 Tagen Schedule-Restlaufzeit.

## Befehle

```sh
npm run validate            # Schema + Schedule prüfen (muss vor jedem Commit grün sein)
npm run schedule -- 30      # Schedule um 30 Tage verlängern
node scripts/notify.mjs morgen --dry-run --force   # Push-Nachricht testen ohne Senden
npx serve .                 # App lokal ansehen (LLM-Buttons brauchen Vercel)
```

## Neue Experimente generieren

Skill **`/mint-experimente`** aufrufen (z.B. `/mint-experimente 30`). Der Skill enthält Schema, Kind-Profil und Schreibregeln (wörtlich, kurze Sätze, Sensorik-Flags, nur sichere Haushalts-Experimente) und endet mit einem Review-PR. Keine Experimente ohne den Skill generieren.

## Konventionen

- Alles Nutzer-Sichtbare ist Deutsch.
- Datumslogik immer in Europe/Berlin (`Intl.DateTimeFormat` mit `timeZone`), nie Geräte-Lokalzeit annehmen.
- Design bleibt reizarm: keine Autoplay-Animationen/Sounds, Konfetti nur nach aktivem Tippen, `prefers-reduced-motion` respektieren.
