/* MINT-Bot – tägliche Science Facts & Experimente für zuhause.
   Vanilla JS, kein Build-Step. Fortschritt liegt im localStorage dieses Geräts. */
"use strict";

// Einfacher Mitbenutzungs-Schutz für die LLM-Endpoints (siehe api/_claude.js).
const APP_TOKEN = "mint-bot-familie";

const SENSORIK = {
  laut: { icon: "🔊", label: "laut" },
  nass: { icon: "💧", label: "nass" },
  matschig: { icon: "🟤", label: "matschig" },
  klebrig: { icon: "🍯", label: "klebrig" },
  riecht: { icon: "👃", label: "riecht" },
  knall: { icon: "💥", label: "knallt" },
  dunkel: { icon: "🌑", label: "dunkel" },
  sprudelt: { icon: "🫧", label: "sprudelt" },
  kalt: { icon: "❄️", label: "kalt" },
};

const KATEGORIEN = {
  "weltraum-physik": { icon: "🚀", label: "Weltraum & Physik" },
  "natur-tiere": { icon: "🐞", label: "Natur & Tiere" },
  technik: { icon: "⚙️", label: "Technik & Maschinen" },
  kuechenchemie: { icon: "🧪", label: "Küchen-Chemie" },
};

const state = {
  experiments: [], schedule: {}, byId: new Map(), tab: "heute", detailId: null,
  // Serverstand aus /api/state – leer, solange offline oder ohne Token.
  status: {},      // experimentId -> "neu" | "nochmal" | "archiviert" | "fundus"
  serverOk: false,
  suche: { q: "", treffer: null, laeuft: false },
};

// ---------- Datum (immer Europe/Berlin, egal wo das Gerät steht) ----------
function berlinDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
}
function prettyDate(iso) {
  return new Date(iso + "T12:00:00").toLocaleDateString("de-DE", {
    weekday: "long", day: "numeric", month: "long",
  });
}

// ---------- Auswahl des Tages-Experiments ----------
function dateHash(dateStr) {
  let hash = 0;
  for (const ch of dateStr) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash;
}

function geplantFuer(dateStr) {
  const id = state.schedule[dateStr];
  if (id && state.byId.has(id)) return state.byId.get(id);
  // Fallback: deterministische Auswahl, damit die App nie leer ist.
  return state.experiments[dateHash(dateStr) % state.experiments.length];
}

/* Ersatz, wenn der Plan ein bereits archiviertes Experiment vorsieht.
   schedule.json wird Monate im Voraus erzeugt – ohne diesen Schritt käme ein
   abgehaktes Thema später doch nochmal als Tageskarte. Verpasstes hat Vorrang,
   dafür ist der Fundus da. */
function ersatzFuer(dateStr) {
  const offen = state.experiments.filter((e) => state.status[e.id] !== "archiviert");
  if (!offen.length) return null;
  const fundus = offen.filter((e) => state.status[e.id] === "fundus");
  const topf = fundus.length ? fundus : offen;
  return topf[dateHash(dateStr) % topf.length];
}

function experimentForDate(dateStr) {
  /* Einmal pro Tag entschieden und dann festgenagelt: die Tageskarte darf sich
     unter dem Kind nicht mehr verändern, auch nicht wenn zwischendurch der
     Serverstand eintrifft oder die Seite neu geladen wird. */
  const pinKey = `mint.tageskarte.${dateStr}`;
  const gepinnt = store.get(pinKey, null);
  if (gepinnt && state.byId.has(gepinnt)) return state.byId.get(gepinnt);

  let exp = geplantFuer(dateStr);
  if (state.serverOk && state.status[exp.id] === "archiviert") {
    exp = ersatzFuer(dateStr) ?? exp;
  }
  // Nur festnageln, wenn der Status wirklich bekannt ist – sonst würde ein
  // Start im Funkloch den ganzen Tag auf den ungeprüften Plan festlegen.
  if (state.serverOk) store.set(pinKey, exp.id);
  return exp;
}

/* Ohne das wächst der localStorage endlos: pro Tag ein Schritte-Fortschritt
   und eine festgenagelte Tageskarte. */
function raeumeAlteSchluessel() {
  const grenze = berlinDate(-120);
  for (const key of Object.keys(localStorage)) {
    const m = /^mint\.(?:steps|tageskarte)\.(\d{4}-\d{2}-\d{2})$/.exec(key);
    if (m && m[1] < grenze) localStorage.removeItem(key);
  }
}

// ---------- localStorage ----------
const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) { localStorage.setItem(key, JSON.stringify(value)); },
};
const getDone = () => store.get("mint.done", []); // [{id, date}]
const getFavs = () => store.get("mint.favs", []);
const stepsKey = (ctx) => `mint.steps.${ctx}`;

// ---------- Sync mit der Datenbank ----------
/* Grundregel: localStorage bleibt vorn. Jede Aktion wirkt sofort lokal und
   wandert zusätzlich in eine Queue, die bei nächster Gelegenheit zum Server
   geht. Damit funktioniert die App im Funkloch unverändert, und der Server ist
   trotzdem die geräteübergreifende Wahrheit. */
const getToken = () => store.get("mint.token", "") || "";
const getQueue = () => store.get("mint.queue", []);

function pushEvent(ev) {
  const queue = getQueue();
  queue.push({ ...ev, ts: new Date().toISOString() });
  store.set("mint.queue", queue);
  flushQueue();
}

async function mintApi(pfad, { method = "GET", body = null } = {}) {
  const token = getToken();
  if (!token) throw new Error("kein Token");
  const res = await fetch(`/api/${pfad}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Mint-Token": token },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Fehler ${res.status}`);
  return res.json();
}

let flushLaeuft = false;
async function flushQueue() {
  if (flushLaeuft || !getToken()) return;
  const queue = getQueue();
  if (!queue.length) return;
  flushLaeuft = true;
  try {
    await mintApi("events", { method: "POST", body: { events: queue } });
    /* Nur die gesendeten Ereignisse entfernen – während der Anfrage können
       neue dazugekommen sein. */
    store.set("mint.queue", getQueue().slice(queue.length));
    updateSyncAnzeige();
  } catch {
    // Bleibt in der Queue, nächster Versuch später. Bewusst stumm: das Kind
    // soll nie eine Fehlermeldung sehen.
  } finally {
    flushLaeuft = false;
  }
}

/* Einmalige Übernahme der Historie, die vor dieser Version nur im Browser lag.
   Ohne das würden Monate an "geschafft" verloren gehen, sobald der Cache
   geleert wird. */
function migriereAltbestand() {
  if (store.get("mint.migriert", false)) return;
  const events = [];
  for (const { id, date } of getDone()) {
    if (id && date) events.push({ typ: "geschafft", experimentId: id, datum: date });
  }
  for (const id of getFavs()) events.push({ typ: "nochmal", experimentId: id, wert: true });
  if (events.length) {
    store.set("mint.queue", [...getQueue(), ...events]);
    console.info(`MINT-Bot: ${events.length} lokale Einträge zur Übernahme vorgemerkt.`);
  }
  store.set("mint.migriert", true);
}

/* Holt den Serverstand und schreibt ihn zurück in den localStorage, damit ein
   frisch aufgesetztes Gerät (iPhone, Mac) die volle Historie sieht. */
async function ladeServerStand() {
  if (!getToken()) return false;
  try {
    const daten = await mintApi("state");
    state.status = daten.status || {};
    state.serverOk = true;

    // Historie zusammenführen: lokal und Server können beide Einträge haben,
    // die der andere nicht kennt.
    const done = getDone();
    const bekannt = new Set(done.map((d) => `${d.id}|${d.date}`));
    for (const t of daten.tage || []) {
      if (t.geschafft && !bekannt.has(`${t.id}|${t.datum}`)) done.push({ id: t.id, date: t.datum });
    }
    store.set("mint.done", done);
    // Der Stern ist nach dem Flush serverseitig aktuell – also übernehmen.
    store.set("mint.favs", daten.nochmal || []);
    return true;
  } catch {
    state.serverOk = false;
    return false;
  }
}

// ---------- Rendering-Helfer ----------
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? "" : v);
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

// ---------- Eltern-Bereich ----------
function parentBox(exp, { open = false, materialProminent = false } = {}) {
  const kat = KATEGORIEN[exp.kategorie];
  const badges = el("div", { class: "badge-row" },
    el("span", { class: "badge" }, `${kat.icon} ${kat.label}`),
    el("span", { class: "badge" }, `⏱️ ca. ${exp.dauerMinuten} Min`),
    exp.sensorik.map((s) => el("span", { class: "badge" }, `${SENSORIK[s].icon} ${SENSORIK[s].label}`)),
    exp.wartezeit ? el("span", { class: "badge warn" }, `⏳ Wartezeit: ${exp.wartezeit}`) : null,
    exp.ort === "draussen" ? el("span", { class: "badge" }, "🌳 draußen") : null,
  );
  const material = el("ul", { class: "material-list" },
    exp.material.map((m) =>
      el("li", {}, el("input", { type: "checkbox", "aria-label": `${m} bereitgelegt` }), m)
    )
  );
  return el("details", { class: "card parent-box", open: open || materialProminent },
    el("summary", {}, "👋 Für Eltern: Vorbereitung"),
    badges,
    el("p", { class: "parent-info" }, exp.elternInfo),
    el("div", { class: "section-title" }, "🧺 Das braucht ihr:"),
    material,
  );
}

// ---------- LLM-Anbindung ----------
async function askApi(endpoint, payload) {
  const res = await fetch(`/api/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Mint-Token": APP_TOKEN },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data.text;
}

function llmErrorBox(e) {
  const hint = /nicht eingerichtet|501/.test(String(e.message))
    ? "Der Erklär-Helfer ist noch nicht eingerichtet (ANTHROPIC_API_KEY fehlt auf Vercel)."
    : "Der Erklär-Helfer ist gerade nicht erreichbar. Fragt einfach später nochmal.";
  return el("div", { class: "llm-error" }, `🙁 ${hint}`);
}

function stepHelpButton(exp, step, container) {
  return el("button", {
    class: "step-help-btn",
    "aria-label": "Hilfe zu diesem Schritt",
    onclick: async (ev) => {
      ev.stopPropagation();
      const old = container.querySelector(".help-answer, .llm-error, .llm-loading");
      if (old) { old.remove(); return; }
      const loading = el("div", { class: "llm-loading" }, "💭 Ich überlege …");
      container.append(loading);
      try {
        const text = await askApi("help", { titel: exp.titel, fakt: exp.fakt, schritt: step.text });
        loading.replaceWith(el("div", { class: "help-answer" }, text));
      } catch (e) {
        loading.replaceWith(llmErrorBox(e));
      }
    },
  }, "❓");
}

function detailsAskBox(exp) {
  const answers = el("div");
  const input = el("input", {
    type: "text",
    placeholder: "Deine Frage dazu … (optional)",
    "aria-label": "Eigene Frage zum Thema",
  });
  async function ask(frage) {
    const loading = el("div", { class: "llm-loading" }, "💭 Ich überlege …");
    answers.append(loading);
    try {
      const text = await askApi("details", {
        titel: exp.titel, fakt: exp.fakt, erklaerung: exp.erklaerung, frage: frage || null,
      });
      loading.replaceWith(el("div", { class: "llm-answer" }, text));
    } catch (e) {
      loading.replaceWith(llmErrorBox(e));
    }
  }
  return el("div", { class: "ask-box" },
    el("button", { class: "btn btn-secondary", onclick: () => ask(null) }, "🔍 Mehr wissen"),
    answers,
    el("div", { class: "ask-row" },
      input,
      el("button", {
        class: "btn btn-secondary",
        onclick: () => { if (input.value.trim()) { ask(input.value.trim()); input.value = ""; } },
      }, "Fragen")
    ),
  );
}

// ---------- Experiment-Karte ----------
function experimentCard(exp, { date, stepsContext, showDone = true } = {}) {
  const frag = document.createDocumentFragment();
  frag.append(parentBox(exp, { open: false }));

  frag.append(el("div", { class: "card hero" },
    el("span", { class: "big-emoji" }, exp.emoji),
    el("h1", {}, exp.titel),
    el("p", { class: "fakt" }, exp.fakt),
  ));

  // Schritte mit Abhaken + Fortschrittsbalken
  const ctx = stepsContext ?? `${date}`;
  let checked = new Set(store.get(stepsKey(ctx), []));
  const progressLabel = el("div", { class: "progress" });
  const progressFill = el("div");
  const updateProgress = () => {
    progressLabel.textContent = `${checked.size} von ${exp.schritte.length} Schritten geschafft`;
    progressFill.style.width = `${(checked.size / exp.schritte.length) * 100}%`;
  };

  const stepsWrap = el("div");
  exp.schritte.forEach((step, i) => {
    const answerSlot = el("div");
    const btn = el("button", {
      class: "step" + (checked.has(i) ? " done" : ""),
      "aria-pressed": checked.has(i) ? "true" : "false",
      onclick: () => {
        if (checked.has(i)) checked.delete(i); else checked.add(i);
        btn.classList.toggle("done", checked.has(i));
        btn.setAttribute("aria-pressed", checked.has(i) ? "true" : "false");
        store.set(stepsKey(ctx), [...checked]);
        updateProgress();
      },
    },
      el("span", { class: "step-num" }, String(i + 1)),
      el("span", { class: "step-emoji" }, step.emoji),
      el("span", { class: "step-text" }, step.text),
      stepHelpButton(exp, step, answerSlot),
    );
    stepsWrap.append(btn, answerSlot);
  });
  updateProgress();

  frag.append(
    el("div", { class: "section-title" }, "🧑‍🔬 Los geht's – Schritt für Schritt:"),
    progressLabel,
    el("div", { class: "progress-bar" }, progressFill),
    stepsWrap,
  );

  // Auflösung erst nach dem Ausprobieren aufklappen
  frag.append(el("details", { class: "reveal" },
    el("summary", {}, "👀 Was passiert da?"),
    el("p", {}, exp.wasPassiert),
  ));
  frag.append(el("details", { class: "reveal" },
    el("summary", {}, "🧠 Warum ist das so?"),
    el("p", {}, exp.erklaerung),
    detailsAskBox(exp),
  ));

  if (showDone) frag.append(actionRow(exp, date, ctx));
  return frag;
}

function actionRow(exp, date, ctx) {
  const doneToday = getDone().some((d) => d.id === exp.id && d.date === date);
  const favs = getFavs();

  const doneArea = el("div");
  if (doneToday) {
    doneArea.append(el("div", { class: "done-banner" }, "🏅 Geschafft! Super gemacht!"));
  } else {
    doneArea.append(el("button", {
      class: "btn btn-primary",
      onclick: (ev) => {
        const done = getDone();
        done.push({ id: exp.id, date });
        store.set("mint.done", done);
        pushEvent({ typ: "geschafft", experimentId: exp.id, datum: date });
        confetti();
        ev.currentTarget.replaceWith(el("div", { class: "done-banner" }, "🏅 Geschafft! Super gemacht!"));
      },
    }, "🎉 Geschafft!"));
  }

  /* Ohne Stern wandert ein geschafftes Experiment ins Archiv: es bleibt in der
     Datenbank und im Second Brain auffindbar, taucht in der App aber nicht
     mehr auf. Bei nochmalTauglich === false gibt es die Wahl gar nicht – diese
     Experimente funktionieren beim zweiten Mal nicht mehr. */
  if (exp.nochmalTauglich === false) {
    return el("div", { class: "action-row" }, doneArea);
  }

  const favLabel = (an) => (an ? "⭐ Auf der Nochmal-Liste" : "☆ Auf die Nochmal-Liste");
  const favBtn = el("button", {
    class: "btn btn-secondary fav-btn" + (favs.includes(exp.id) ? " active" : ""),
    onclick: (ev) => {
      let f = getFavs();
      const an = !f.includes(exp.id);
      f = an ? [...f, exp.id] : f.filter((x) => x !== exp.id);
      store.set("mint.favs", f);
      pushEvent({ typ: "nochmal", experimentId: exp.id, wert: an });
      ev.currentTarget.classList.toggle("active", an);
      ev.currentTarget.textContent = favLabel(an);
    },
  }, favLabel(favs.includes(exp.id)));

  return el("div", { class: "action-row" }, doneArea, favBtn);
}

// ---------- Konfetti (nur nach aktivem Tippen) ----------
function confetti() {
  const layer = document.getElementById("confetti-layer");
  const colors = ["#3a7d5d", "#d9a514", "#4a7fb5", "#c2604e", "#8e6bb0"];
  for (let i = 0; i < 80; i++) {
    const c = document.createElement("div");
    c.className = "confetto";
    c.style.left = Math.random() * 100 + "vw";
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 1.6 + Math.random() * 1.6 + "s";
    c.style.animationDelay = Math.random() * 0.4 + "s";
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    layer.append(c);
    setTimeout(() => c.remove(), 4000);
  }
}

// ---------- Ansichten ----------
function renderHeute(view) {
  const date = berlinDate(0);
  view.append(experimentCard(experimentForDate(date), { date }));
}

/* Geräte-Freischaltung. Das Token steht bewusst nicht im Quelltext (anders als
   der APP_TOKEN der Erklär-Helfer-Endpoints), sondern wird pro Gerät einmal
   hier eingegeben – so lassen sich Tablet, iPhone und Mac einzeln freischalten
   und die Historie bleibt überall dieselbe. */
function updateSyncAnzeige() {
  const pille = document.querySelector(".sync-pille");
  if (!pille) return;
  const offen = getQueue().length;
  if (!getToken()) { pille.textContent = "🔒 nicht freigeschaltet"; pille.className = "sync-pille warn"; }
  else if (offen) { pille.textContent = `⏳ ${offen} Änderung${offen === 1 ? "" : "en"} warten`; pille.className = "sync-pille warn"; }
  else if (state.serverOk) { pille.textContent = "✅ synchronisiert"; pille.className = "sync-pille ok"; }
  else { pille.textContent = "📴 offline"; pille.className = "sync-pille"; }
}

function syncBox() {
  const pille = el("span", { class: "sync-pille" }, "…");
  const inhalt = el("div");

  const zeigeEingabe = () => {
    const input = el("input", {
      type: "password",
      class: "suche-input",
      placeholder: "Eltern-Passwort",
      "aria-label": "Eltern-Passwort zum Freischalten dieses Geräts",
      autocomplete: "current-password",
    });
    const melden = el("div", { class: "parent-info" });
    const speichern = async () => {
      const wert = input.value.trim();
      if (!wert) return;
      store.set("mint.token", wert);
      melden.textContent = "Prüfe …";
      /* Erst senden, dann holen. ladeServerStand überschreibt mint.favs mit
         dem Serverstand – auf einem Gerät, dessen Sterne noch nie angekommen
         sind, wären sie sonst genau in dem Moment weg, in dem das Passwort
         eingegeben wird. */
      await flushQueue();
      if (await ladeServerStand()) {
        melden.textContent = "";
        render();
      } else {
        store.set("mint.token", "");
        melden.textContent = "Das hat nicht geklappt – stimmt das Passwort?";
        updateSyncAnzeige();
      }
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") speichern(); });
    inhalt.replaceChildren(
      el("p", { class: "parent-info" },
        "Einmal pro Gerät eingeben. Danach sind Verlauf, Nochmal-Liste und Suche auf allen Geräten gleich."),
      el("div", { class: "ask-row" }, input, el("button", { class: "btn btn-secondary", onclick: speichern }, "Freischalten")),
      melden,
    );
    input.focus();
  };

  if (getToken()) {
    inhalt.append(
      el("p", { class: "parent-info" }, "Dieses Gerät ist freigeschaltet."),
      el("button", {
        class: "btn btn-secondary",
        onclick: () => { store.set("mint.token", ""); state.serverOk = false; zeigeEingabe(); updateSyncAnzeige(); },
      }, "Passwort ändern"),
    );
  } else {
    zeigeEingabe();
  }

  const box = el("details", { class: "card parent-box", open: !getToken() },
    el("summary", {}, "🔐 Für Eltern: Geräte-Freischaltung ", pille),
    inhalt,
  );
  queueMicrotask(updateSyncAnzeige);
  return box;
}

function renderMorgen(view) {
  const date = berlinDate(1);
  const exp = experimentForDate(date);
  view.append(el("div", { class: "preview-banner" },
    `🌙 Vorschau für Eltern – das kommt morgen (${prettyDate(date)}). Material heute schon bereitlegen und dem Kind ankündigen.`));
  view.append(parentBox(exp, { materialProminent: true }));
  view.append(el("div", { class: "card hero" },
    el("span", { class: "big-emoji" }, exp.emoji),
    el("h1", {}, exp.titel),
    el("p", { class: "fakt" }, exp.fakt),
  ));
  view.append(syncBox());
}

function listItem(exp, sub) {
  return el("button", {
    class: "list-item",
    onclick: () => { state.detailId = exp.id; render(); },
  },
    el("span", { class: "li-emoji" }, exp.emoji),
    el("span", {}, exp.titel, el("span", { class: "li-sub" },
      sub ?? `${KATEGORIEN[exp.kategorie].icon} ${KATEGORIEN[exp.kategorie].label} · ⏱️ ${exp.dauerMinuten} Min`)),
  );
}

/* Suchfeld: fragt den Server, fällt aber auf eine lokale Titelsuche zurück,
   wenn kein Token gesetzt oder kein Netz da ist. */
function sucheZeile() {
  const input = el("input", {
    type: "search",
    class: "suche-input",
    placeholder: "Thema suchen … (z. B. Magnet)",
    "aria-label": "Experimente nach Thema suchen",
    value: state.suche.q,
  });
  let timer = null;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    timer = setTimeout(async () => {
      state.suche.q = q;
      if (!q) { state.suche.treffer = null; render(); return; }
      try {
        const daten = await mintApi(`search?q=${encodeURIComponent(q)}`);
        state.suche.treffer = daten.treffer.map((t) => t.id);
      } catch {
        const needle = q.toLowerCase();
        state.suche.treffer = state.experiments
          .filter((e) => `${e.titel} ${e.fakt}`.toLowerCase().includes(needle))
          .map((e) => e.id);
      }
      render();
      // Fokus überlebt das Neuzeichnen nicht von allein.
      const neu = document.querySelector(".suche-input");
      if (neu) { neu.focus(); neu.setSelectionRange(neu.value.length, neu.value.length); }
    }, 250);
  });
  return el("div", { class: "suche-row" }, input);
}

function renderNochmal(view) {
  if (state.detailId) {
    const exp = state.byId.get(state.detailId);
    view.append(el("button", { class: "back-btn", onclick: () => { state.detailId = null; render(); } }, "← Zurück zur Liste"));
    view.append(experimentCard(exp, { date: berlinDate(0), stepsContext: `replay.${exp.id}` }));
    return;
  }

  view.append(sucheZeile());

  // --- Suchergebnisse ---
  if (state.suche.q) {
    const treffer = (state.suche.treffer ?? []).map((id) => state.byId.get(id)).filter(Boolean);
    view.append(el("div", { class: "section-title" }, `🔍 ${treffer.length} Treffer für „${state.suche.q}“`));
    if (!treffer.length) {
      view.append(el("div", { class: "empty-state" }, "Dazu haben wir noch nichts gefunden."));
    }
    const LABEL = { nochmal: "⭐ auf der Nochmal-Liste", archiviert: "🏅 schon gemacht", fundus: "🕓 verpasst", neu: "✨ kommt noch" };
    treffer.forEach((exp) => view.append(listItem(exp, LABEL[state.status[exp.id]] ?? null)));
    return;
  }

  // --- Nochmal-Liste ---
  /* Der Stern gehört dem Server: gesetzt wird er auf einem Gerät, sichtbar
     soll er auf allen sein. Solange der Serverstand da ist, zählt er; die
     lokale Kopie ist nur der Notvorrat fürs Funkloch. */
  const favIds = state.serverOk
    ? state.experiments.filter((e) => state.status[e.id] === "nochmal").map((e) => e.id)
    : getFavs();
  const favs = favIds.map((id) => state.byId.get(id)).filter(Boolean);
  view.append(el("div", { class: "section-title" }, "⭐ Nochmal machen"));
  if (favs.length) {
    favs.forEach((exp) => view.append(listItem(exp)));
  } else if (!state.serverOk) {
    /* Ohne Passwort sieht ein frisches Gerät die Sterne nicht. Das darf nicht
       wie „ihr habt noch keine“ aussehen – sonst wirkt die Liste gelöscht. */
    view.append(el("div", { class: "empty-state" },
      "Die Nochmal-Liste liegt auf dem Server.", el("br"),
      "Dafür braucht dieses Gerät einmal das Eltern-Passwort (Tab „Morgen“)."));
  } else {
    view.append(el("div", { class: "empty-state" },
      el("span", { class: "big-emoji" }, "⭐"),
      "Hier landen Experimente, die ihr nochmal machen wollt.", el("br"),
      "Tippt dafür beim Experiment auf „Auf die Nochmal-Liste“."));
  }

  // --- Fundus: Tage, an denen keine Zeit war ---
  const fundus = state.experiments.filter((e) => state.status[e.id] === "fundus");
  view.append(el("div", { class: "section-title" }, "🕓 Verpasst – da war keine Zeit"));
  if (!state.serverOk) {
    view.append(el("div", { class: "empty-state" },
      "Die verpassten Experimente liegen auf dem Server.", el("br"),
      "Dafür braucht dieses Gerät einmal das Eltern-Passwort (Tab „Morgen“)."));
  } else if (!fundus.length) {
    view.append(el("div", { class: "empty-state" }, "Nichts verpasst – ihr seid komplett dabei! 🎉"));
  } else {
    fundus.forEach((exp) => view.append(listItem(exp)));
  }
}

function renderGeschafft(view) {
  const done = getDone().slice().sort((a, b) => b.date.localeCompare(a.date));
  if (state.detailId) {
    const exp = state.byId.get(state.detailId);
    view.append(el("button", { class: "back-btn", onclick: () => { state.detailId = null; render(); } }, "← Zurück zur Liste"));
    view.append(experimentCard(exp, { date: berlinDate(0), stepsContext: `replay.${exp.id}`, showDone: false }));
    return;
  }
  if (!done.length) {
    view.append(el("div", { class: "empty-state" },
      el("span", { class: "big-emoji" }, "🏅"),
      "Noch kein Experiment geschafft – heute ist ein guter Tag dafür!"));
    return;
  }
  view.append(el("div", { class: "done-banner" }, `🏅 Ihr habt schon ${done.length} Experiment${done.length === 1 ? "" : "e"} geschafft!`));
  done.forEach(({ id, date }) => {
    const exp = state.byId.get(id);
    if (!exp) return;
    view.append(el("button", {
      class: "list-item",
      onclick: () => { state.detailId = id; render(); },
    },
      el("span", { class: "li-emoji" }, exp.emoji),
      el("span", {}, exp.titel, el("span", { class: "li-sub" }, prettyDate(date))),
    ));
  });
}

// ---------- App-Gerüst ----------
function render() {
  const view = document.getElementById("view");
  view.replaceChildren();
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.tab === state.tab));
  ({ heute: renderHeute, morgen: renderMorgen, nochmal: renderNochmal, geschafft: renderGeschafft })[state.tab](view);
  window.scrollTo(0, 0);
}

async function init() {
  document.getElementById("header-date").textContent = prettyDate(berlinDate(0));
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      state.tab = t.dataset.tab;
      state.detailId = null;
      state.suche = { q: "", treffer: null, laeuft: false };
      render();
    }));
  try {
    const [experiments, schedule] = await Promise.all([
      fetch("data/experiments.json").then((r) => r.json()),
      fetch("data/schedule.json").then((r) => r.json()),
    ]);
    state.experiments = experiments;
    state.schedule = schedule;
    state.byId = new Map(experiments.map((e) => [e.id, e]));

    raeumeAlteSchluessel();
    migriereAltbestand();

    /* Serverstand vor dem ersten Rendern abwarten – aber mit Deckel. Sonst
       entscheidet sich erst nach dem Zeichnen, ob die geplante Tageskarte
       archiviert ist, und die Karte würde vor dem Kind wechseln. Nach dem
       Timeout gilt der Plan, und es wird nichts festgenagelt. */
    if (getToken()) {
      await Promise.race([
        flushQueue().then(ladeServerStand),
        new Promise((r) => setTimeout(r, 2500)),
      ]);
    }
    render();

    // Nachzügler: sobald wieder Netz da ist, Queue leeren.
    window.addEventListener("online", () => { flushQueue(); });
  } catch (e) {
    document.getElementById("view").append(
      el("div", { class: "empty-state" }, "🙁 Die Experimente konnten nicht geladen werden. Bitte Seite neu laden."));
  }
}

init();
