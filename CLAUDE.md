# MINT-Bot

Täglicher Science Fact mit Heim-Experiment für ein neurodivergentes Kind (geb. 2020, ASS + ADHS). Statische Web-App (Vanilla JS, kein Build-Step) + Vercel Serverless Functions + GitHub-Actions-Cron für ntfy-Push.

## Architektur

- `index.html` / `style.css` / `app.js` — Web-App (Tabs: Heute, Morgen, Nochmal, Geschafft).
- `data/experiments.json` — kuratierter Pool (Schema: siehe `.claude/skills/mint-experimente/SKILL.md`).
- `data/schedule.json` — Datum → Experiment-ID. Frontend und Notify-Script lesen dieselbe Datei.
- `api/help.js`, `api/details.js` — LLM-Erklär-Helfer (Claude Haiku via `@anthropic-ai/sdk`, braucht `ANTHROPIC_API_KEY` als Vercel-Env-Var). Gemeinsame Logik in `api/_claude.js`.
- `api/state.js`, `api/events.js`, `api/search.js` — Themen-Status lesen, Ereignisse schreiben, Volltextsuche. Gemeinsame Logik in `lib/db.js`.
- `scripts/` — `validate.mjs` (Schema-Check), `build-schedule.mjs` (Schedule verlängern), `notify.mjs` (ntfy-Push), `sync-experiments.mjs` (JSON → DB spiegeln), `brain-digest.mjs` (Wochenzusammenfassung ins Second Brain), `query.mjs` (Suche für den `/mint-suche`-Skill).
- `.github/workflows/notify.yml` — Cron: morgens Tageskarte, abends Eltern-Vorschau + ⚠️-Warnung bei ≤10 Tagen Schedule-Restlaufzeit. Mehrere Slots je Fenster, weil GitHub Cron-Jobs bis zu ~100 Minuten verspätet oder (ohne freien Runner) gar nicht startet; `mint.pushes` sorgt dafür, dass trotzdem genau eine Nachricht rausgeht.
- `.github/workflows/brain-digest.yml` — Cron: sonntags 20 Uhr Wochenzusammenfassung.

## Themen-Status (Datenmodell)

Jeder Tag wird gespeichert, und der Status steuert, ob ein Thema wiederkommt:

| Aktion in der App | Status | Wirkung |
|---|---|---|
| geschafft **+ Stern** | `nochmal` | bleibt im Nochmal-Tab, wird nicht neu eingeplant |
| geschafft **ohne Stern** | `archiviert` | verschwindet aus der App, bleibt in DB und Second Brain auffindbar |
| Tag verstrichen ohne „geschafft" | `fundus` | erscheint unter „Verpasst", wird zu ~20 % wieder eingeplant |
| noch nie dran | `neu` | regulärer Planungs-Pool |

- Liegt im Schema **`mint`** der second_brain-Datenbank auf Aiven (`brain/sql/009_mint_schema.sql`). Ein Schema statt einer eigenen DB, damit eine gemeinsame Suche über `brain_items` und MINT-Themen möglich bleibt — über Datenbankgrenzen hinweg kann Postgres nicht joinen.
- Status wird in der View `mint.themen` **abgeleitet**, nie gespeichert. `mint.tage` ist das Ereignis-Log (eine Zeile pro Kalendertag), `mint.experimente` der Spiegel von `experiments.json`.
- Zwei DB-Rollen: `mint_app` (Web-App, nur Schema `mint`, **kein** Zugriff auf `brain_items`) und `mint_job` (Cron und lokale Scripts, darf zusätzlich in `brain_items` schreiben).
- Secrets in `.env.local` (gitignored): `MINT_DB_URL`, `MINT_DB_URL_JOB`, `MINT_WRITE_TOKEN`.
- `localStorage` bleibt vorn: Aktionen wirken sofort lokal und wandern über `mint.queue` in die DB, sobald Netz da ist. Die App muss im Funkloch vollständig funktionieren.
- Die Tageskarte wird pro Tag **einmal** entschieden und in `mint.tageskarte.<datum>` festgenagelt — sie darf sich unter dem Kind nicht mehr ändern.

## Befehle

```sh
npm run validate            # Schema + Schedule prüfen (muss vor jedem Commit grün sein)
npm run sync                # experiments.json + schedule.json in die DB spiegeln
npm run schedule -- 30      # Schedule um 30 Tage verlängern (liest den Status aus der DB)
node scripts/notify.mjs morgen --dry-run --force   # Push-Nachricht testen ohne Senden
node scripts/brain-digest.mjs --dry-run            # Wochenzusammenfassung ansehen
node scripts/query.mjs magnet --status fundus      # Themensuche
npx serve .                 # App lokal ansehen (api/-Routen brauchen `vercel dev`)
```

Nach jeder Änderung an `data/*.json` gehört `npm run sync` dazu — sonst kennt die DB die neuen Experimente nicht und die Suche findet sie nicht.

## Neue Experimente generieren

Skill **`/mint-experimente`** aufrufen (z.B. `/mint-experimente 30`). Der Skill enthält Schema, Kind-Profil und Schreibregeln (wörtlich, kurze Sätze, Sensorik-Flags, nur sichere Haushalts-Experimente) und endet mit einem Review-PR. Keine Experimente ohne den Skill generieren.

## Themen suchen

Skill **`/mint-suche`** aufrufen (z.B. `/mint-suche magnet`). Beantwortet „was haben wir verpasst / schon gemacht / behalten?" aus der DB. Archiviertes ist dort weiterhin auffindbar — es verschwindet nur aus der App.

## Konventionen

- Alles Nutzer-Sichtbare ist Deutsch.
- Datumslogik immer in Europe/Berlin (`Intl.DateTimeFormat` mit `timeZone`), nie Geräte-Lokalzeit annehmen.
- Design bleibt reizarm: keine Autoplay-Animationen/Sounds, Konfetti nur nach aktivem Tippen, `prefers-reduced-motion` respektieren.
