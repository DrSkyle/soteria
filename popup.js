/* Soteria by DrSkyle: popup.
 * One decision for the current site, one panic button. Anything that reduces
 * protection (removing a site, snoozing) lives in settings, behind the password. */
"use strict";

const api = typeof browser !== "undefined" ? browser : chrome;
const DVL = globalThis.DevilabsSoteria;
const L = DVL.logic;
const $ = (id) => document.getElementById(id);

const el = { status: $("status"), kicker: $("kicker"), host: $("host"), state: $("state"), primary: $("primary"), lockAll: $("lock-all"), settings: $("settings") };
let tab = null;
let host = "";
let S = null;

function protectable(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? L.normalizeHost(u.hostname) : "";
  } catch (e) {
    return "";
  }
}

const t = (key, vars) => DVL.i18n.t(key, vars);
const isProtected = () => !!host && S.sites.some((s) => L.matchesSite(host, s));
const openPage = (file, hash) => api.tabs.create({ url: api.runtime.getURL(file) + (hash || "") }).then(() => window.close());

function render() {
  const n = S.sites.length;
  const hasPassword = !!S.passHash;
  el.status.textContent = !hasPassword ? t("pop.status.setup") : n === 0 ? t("pop.status.none") : n === 1 ? t("pop.status.one") : t("pop.status.many", { n });
  el.lockAll.disabled = !n;
  el.state.className = "caption";
  el.primary.hidden = false;
  el.primary.className = "btn primary block";
  el.primary.disabled = false;

  if (!hasPassword) {
    el.kicker.textContent = t("pop.kicker.welcome");
    el.host.textContent = t("pop.createPw");
    el.state.textContent = t("pop.needsPw");
    el.primary.textContent = t("pop.finish");
    el.primary.onclick = () => openPage("welcome.html");
    return;
  }
  if (!host) {
    el.kicker.textContent = t("pop.kicker.page");
    el.host.textContent = t("pop.notAvail");
    el.state.textContent = t("pop.onlyWeb");
    el.primary.hidden = true;
    return;
  }
  el.kicker.textContent = t("pop.kicker.site");
  el.host.textContent = host;
  if (isProtected()) {
    el.state.textContent = t("pop.protected");
    el.state.className = "caption ok";
    el.primary.textContent = t("pop.manage");
    el.primary.className = "btn block";
    el.primary.onclick = () => openPage("options.html");
    return;
  }
  el.state.textContent = t("pop.notProtected");
  el.primary.textContent = t("pop.protect");
  el.primary.onclick = protect;
}

async function protect() {
  el.primary.disabled = true;
  el.state.textContent = t("pop.waiting");
  const origins = L.hostOrigins(host);
  // The browser only shows the permission prompt if this call happens directly
  // inside the click, so nothing is awaited before it. (Awaiting a storage write
  // first is what made this button do nothing in some browsers.)
  let req;
  try {
    req = api.permissions && api.permissions.request ? api.permissions.request({ origins }) : Promise.resolve(false);
  } catch (e) {
    req = Promise.resolve(false);
  }
  // The prompt can close this popup. Leave a note so the background can finish
  // the job when the permission lands.
  api.storage.local.set({ pendingProtect: { host, tabId: tab.id, ts: Date.now() } });
  let granted = false;
  try {
    granted = await req;
  } catch (e) {
    granted = false;
  }
  if (!granted) {
    // Safari manages site access in its own settings, and some browsers report
    // "no" for access that already exists. Trust what the browser says it holds.
    try {
      granted = !!(api.permissions && api.permissions.contains && (await api.permissions.contains({ origins })));
    } catch (e) {
      granted = false;
    }
  }
  if (!granted) {
    await api.storage.local.remove("pendingProtect");
    el.state.textContent = t("pop.allow", { host });
    el.primary.disabled = false;
    return;
  }
  try {
    await api.runtime.sendMessage({ type: L.MSG.protectSite, host, tabId: tab.id });
  } catch (e) {
    /* the background's permission listener will finish it */
  }
  await load();
  render();
}

el.lockAll.addEventListener("click", async () => {
  const { lockEpoch } = await api.storage.local.get({ lockEpoch: 0 });
  await api.storage.local.set({ lockEpoch: lockEpoch + 1, snoozes: {} });
  el.state.textContent = t("pop.allLocked");
  el.state.className = "caption ok";
});

el.settings.addEventListener("click", () => openPage("options.html"));

async function load() {
  S = await api.storage.local.get({ sites: [], passHash: null, habits: {}, brain: null, customList: [], firstActive: 0, alerts: [], language: "auto" });
  DVL.i18n.setLanguage(S.language);
  DVL.i18n.apply(document);
}

(async function init() {
  const tabs = await api.tabs.query({ active: true, currentWindow: true });
  tab = tabs[0] || null;
  host = tab && tab.url ? protectable(tab.url) : "";
  await load();
  // If the permission prompt closed the popup last time, finish that add now.
  const { pendingProtect } = await api.storage.local.get({ pendingProtect: null });
  if (pendingProtect && pendingProtect.host === host && Date.now() - pendingProtect.ts < 120000 && !isProtected()) {
    try {
      await api.runtime.sendMessage({ type: L.MSG.protectSite, host, tabId: pendingProtect.tabId });
      await load();
    } catch (e) {
      /* fall through to a normal render */
    }
  }
  render();
  advise();
})();

// Looks at the page you are on and speaks up only when something is off.
function advise() {
  const I = DVL.insight;
  const warn = $("warn");
  warn.hidden = true;
  if (host && I) {
    const threat = (DVL.threats && I.knownThreat(host, DVL.threats)) || I.inCustomList(host, S.customList);
    const twin = S.sites.length ? I.lookalikeOf(host, S.sites) : "";
    if (threat) {
      warn.textContent = t("pop.phish");
      warn.hidden = false;
    } else if (twin) {
      warn.textContent = t("pop.lookalike", { site: twin });
      warn.hidden = false;
    }
  }
  if (DVL.ask && S.sites.length) {
    const n = DVL.ask.streakDays(S.brain, Date.now(), S.firstActive);
    const hp = I.headlineParts(S.habits || {});
    const clock = (h) => new Date(2000, 0, 1, ((h % 24) + 24) % 24).toLocaleTimeString(DVL.i18n.language(), { hour: "numeric" });
    const line = hp.kind === "learning" ? t("insight.learning", { n: hp.n }) : hp.kind === "window" ? t("insight.window", { a: clock(hp.start), b: clock(hp.end) }) : t("insight.spread");
    $("insight").textContent = (n >= 2 ? t("pop.streak", { n }) + " " : "") + line;
  }
}

