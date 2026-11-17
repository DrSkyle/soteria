/* Soteria by DrSkyle
 * Background. Owns everything that must be trusted or shared across tabs:
 * password checks and lockouts, usage accounting, permissions and the
 * registration of the per-site guard scripts.
 */
"use strict";

// Chrome runs this as a service worker and needs the helpers pulled in here.
// Firefox and Safari load them through the manifest's "scripts" list instead.
if (typeof importScripts === "function") importScripts("logic.js", "password.js", "insight.js", "brain.js", "partner.js");

const api = typeof browser !== "undefined" ? browser : chrome;
const DVL = globalThis.DevilabsSoteria;
const L = DVL.logic;
const PW = DVL.pw;
const I = DVL.insight;
const B = DVL.brain;
const P = DVL.partner;
const MSG = L.MSG;

const SCRIPT_PREFIX = "devilabs-soteria-guard-";
const MENU_ID = "devilabs-soteria-add-current";
const CONTENT_JS = ["logic.js", "locales-lock.js", "i18n.js", "insight.js", "brain.js", "brand.js", "content.js"];
const CONTENT_CSS = ["content.css"];
const EXTEND_SECONDS = 15 * 60;

// Anything that reads then writes storage goes through this queue so two tabs
// reporting at the same moment can't overwrite each other.
let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

const scriptId = (host) => SCRIPT_PREFIX + host;

// ------------------------------------------------------------ registration

async function registerSiteScript(host) {
  try {
    await api.scripting.unregisterContentScripts({ ids: [scriptId(host)] });
  } catch (e) {
    /* not registered yet */
  }
  try {
    await api.scripting.registerContentScripts([
      {
        id: scriptId(host),
        matches: L.hostOrigins(host),
        js: CONTENT_JS,
        css: CONTENT_CSS,
        runAt: "document_start",
        allFrames: true,
        persistAcrossSessions: true,
      },
    ]);
  } catch (e) {
    console.warn("Soteria: could not register a guard for", host, e);
  }
}

async function unregisterSiteScript(host) {
  try {
    await api.scripting.unregisterContentScripts({ ids: [scriptId(host)] });
  } catch (e) {
    /* already gone */
  }
}

async function syncRegistrations(sites) {
  let existing = [];
  try {
    existing = await api.scripting.getRegisteredContentScripts();
  } catch (e) {
    existing = [];
  }
  const ours = existing.filter((s) => s.id.startsWith(SCRIPT_PREFIX));
  const wanted = new Set(sites.map(scriptId));
  const have = new Set(ours.map((s) => s.id));
  const stale = ours.filter((s) => !wanted.has(s.id)).map((s) => s.id);
  if (stale.length) {
    try {
      await api.scripting.unregisterContentScripts({ ids: stale });
    } catch (e) {
      /* nothing to clean */
    }
  }
  for (const host of sites) if (!have.has(scriptId(host))) await registerSiteScript(host);
}

// Locks a tab that is already open, without waiting for a reload.
async function applyNow(tabId) {
  if (tabId == null) return;
  try {
    await api.scripting.insertCSS({ target: { tabId, allFrames: true }, files: CONTENT_CSS });
    await api.scripting.executeScript({ target: { tabId, allFrames: true }, files: CONTENT_JS });
  } catch (e) {
    /* the tab navigated away, or the page can't be scripted */
  }
}

// ------------------------------------------------------------------ state

async function ensureDefaults() {
  const cur = await api.storage.local.get(null);
  const missing = {};
  for (const [k, v] of Object.entries(L.DEFAULTS)) if (!(k in cur)) missing[k] = k === "firstActive" ? Date.now() : v;
  if (Object.keys(missing).length) await api.storage.local.set(missing);
}

function addSites(hosts) {
  return serial(async () => {
    const { sites } = await api.storage.local.get({ sites: [] });
    const have = new Set(sites);
    let changed = false;
    for (const raw of hosts) {
      const h = L.normalizeHost(raw);
      if (h && !have.has(h)) {
        have.add(h);
        changed = true;
      }
    }
    if (changed) await api.storage.local.set({ sites: [...have] });
    return changed;
  });
}

async function relockEverything() {
  const { lockEpoch } = await api.storage.local.get({ lockEpoch: 0 });
  // Panic and idle re-lock are safety nets, so they cancel any snooze.
  await api.storage.local.set({ lockEpoch: lockEpoch + 1, snoozes: {}, unlocks: {}, manageUntil: 0 });
}

// --------------------------------------------------------------- passwords

function pruneUnlocks(map, now) {
  const out = {};
  for (const [k, v] of Object.entries(map || {})) if (v && v.until > now) out[k] = v;
  return out;
}

// A lock screen appeared: that is a moment you reached for the site.
function handleEvent(msg) {
  return serial(async () => {
    const site = cleanSite(msg.site);
    if (site === "unknown" || msg.kind !== "shown") return;
    const st = await api.storage.local.get({ habits: {}, sites: [], brain: null, alerts: [] });
    if (!st.sites.includes(site)) return;
    const now = Date.now();
    const br = st.brain || B.blank();
    // Only accept a decision that has the shape we produce; a page can't send this.
    const d = msg.decision;
    const ok = d && Array.isArray(d.x) && d.x.length === 11 && d.x.every((n) => Number.isFinite(n)) && Number.isInteger(d.arm) && d.arm >= -1 && d.arm < B.ARMS.length && ["", "calm", "watchful", "high"].includes(d.bucket);
    B.onShown(br, site, now, ok ? { x: d.x, arm: d.arm, bucket: d.bucket } : null);
    const update = { brain: br, habits: I.recordEvent(st.habits, { site, kind: "shown", ts: now }) };
    const dr = B.drift(br, now);
    const today = new Date(now).toDateString();
    if (dr.state === "up" && br.driftAlertDay !== today) {
      br.driftAlertDay = today;
      update.alerts = I.addAlert(st.alerts, { kind: "drift", site: "", ts: now, text: "You have reached for protected sites about " + Math.round(dr.recent) + " times a day this week, against your usual " + Math.round(dr.mean) + "." });
    }
    await api.storage.local.set(update);
  });
}

// A page script tried to remove or hide the lock screen.
function handleTamper(msg) {
  return serial(async () => {
    const site = cleanSite(msg.site);
    const st = await api.storage.local.get({ alerts: [], sites: [] });
    if (!st.sites.includes(site)) return;
    await api.storage.local.set({ alerts: I.addAlert(st.alerts, { kind: "tamper", site, ts: Date.now(), text: "A script on " + site + " tried to remove or hide Soteria's lock screen. It was put back." }) });
  });
}

function syncBadge(alerts) {
  const unseen = (alerts || []).some((a) => !a.seen);
  try {
    if (api.action && api.action.setBadgeText) {
      api.action.setBadgeText({ text: unseen ? "!" : "" });
      if (unseen && api.action.setBadgeBackgroundColor) api.action.setBadgeBackgroundColor({ color: "#c2410c" });
    }
  } catch (e) {
    /* badge unavailable */
  }
}

// While you keep using a site, its unlock slides forward so it never expires
// under your hands. It only runs out after you stop using the site.
function handleTouch(msg) {
  return serial(async () => {
    const st = await api.storage.local.get({ unlocks: {}, rememberMinutes: L.DEFAULTS.rememberMinutes, lockEpoch: 0 });
    const g = st.unlocks[msg.site];
    const now = Date.now();
    if (!g || g.fixed || g.until <= now || g.epoch !== st.lockEpoch || !st.rememberMinutes) return;
    const next = now + st.rememberMinutes * 60000;
    if (next - g.until < 30000) return; // avoid a write on every beat
    await api.storage.local.set({ unlocks: { ...st.unlocks, [msg.site]: { ...g, until: next } } });
  });
}

const cleanSite = (s) => (typeof s === "string" && s.length > 0 && s.length <= 253 ? s : "unknown");

// One place checks passwords for the lock screen, the console unlock and the
// settings page, so a wrong guess counts the same everywhere and reloading a
// tab can't reset the count.
// ------------------------------------------------------- extensions page

// If the person turned this on (it needs the optional "tabs" permission to see
// the address), the browser's extensions page asks for the password first.
// This is a speed bump, not a lock: the browser's right-click "Remove" on the
// toolbar icon can't be blocked by any extension.
async function guardTab(tabId, url) {
  if (!L.isManagePage(url)) return;
  const st = await api.storage.local.get({ guardExtensions: false, manageUntil: 0, passHash: null });
  if (!st.guardExtensions || !st.passHash || st.manageUntil > Date.now()) return;
  await api.tabs.update(tabId, { url: api.runtime.getURL("guard.html") + "?next=" + encodeURIComponent(url) });
}
if (api.tabs && api.tabs.onUpdated) {
  api.tabs.onUpdated.addListener((tabId, info, tab) => {
    const url = info.url || (tab && tab.pendingUrl);
    if (url) guardTab(tabId, url).catch(() => {});
  });
}

// ---------------------------------------------------------------- partner

const ASK_MS = 15 * 60000;

// During quiet hours with partner-only on, the person's own password is not
// accepted: only their partner can open things.
function partnerOnlyNow(st, now) {
  // After the partner-unreachable wait has passed, this protection steps aside.
  if (st.partnerReleaseAt && now >= st.partnerReleaseAt) return false;
  return !!(st.partner && st.partnerOnlyQuiet && st.sanctuaryEnabled && L.inSanctuaryWindow(st.sanctuaryStart, st.sanctuaryEnd, new Date(now), st.sanctuaryDays));
}

// Soteria makes a one-time request for the partner to approve.
function handleAsk(msg) {
  return serial(async () => {
    const st = await api.storage.local.get({ partner: null, asks: {}, sites: [], rememberMinutes: L.DEFAULTS.rememberMinutes });
    if (!st.partner) return { ok: false, error: "no-partner" };
    const now = Date.now();
    const settings = ["__partner__", "__reset__", "__extensions__"].includes(msg.site);
    if (!settings && !st.sites.includes(msg.site)) return { ok: false, error: "not-protected" };
    let minutes = 0;
    if (!settings) {
      const pick = L.clampUnlock(Number(msg.minutes), msg.sliding === true, st.rememberMinutes);
      minutes = pick.ok ? pick.minutes : 15;
    }
    const nonceBytes = new Uint8Array(16);
    crypto.getRandomValues(nonceBytes);
    const r = P.makeRequest({ site: msg.site, minutes, now, nonceBytes });
    const asks = {};
    for (const [k, v] of Object.entries(st.asks || {})) if (v.exp > now) asks[k] = v;
    const keep = Object.keys(asks).sort((a, b) => asks[a].exp - asks[b].exp).slice(-7);
    const next = {};
    for (const k of keep) next[k] = asks[k];
    next[r.nonce] = { site: msg.site, minutes, exp: now + ASK_MS };
    await api.storage.local.set({ asks: next });
    return { ok: true, request: r.text };
  });
}

// Does this reply approve a request Soteria really made, for this site, once?
async function checkApproval(st, requestText, responseText, site, now) {
  if (!st.partner) return { ok: false };
  const req = P.parseRequest(requestText);
  if (!req.ok) return { ok: false };
  const ask = (st.asks || {})[req.nonce];
  if (!ask || ask.exp <= now || ask.site !== site || req.site !== site || ask.minutes !== req.minutes) return { ok: false };
  if (!(await P.verify(st.partner.key, requestText, responseText))) return { ok: false };
  const asks = { ...st.asks };
  delete asks[req.nonce]; // single use
  return { ok: true, minutes: ask.minutes, asks };
}

function handleVerify(msg) {
  return serial(async () => {
    const st = await api.storage.local.get({
      passHash: null,
      salt: null,
      lockout: L.DEFAULTS.lockout,
      watchLog: [],
      sites: [],
      allowances: {},
      usageDate: "",
      usage: {},
      extraTime: {},
      habits: {},
      brain: null,
      alerts: [],
      adaptive: true,
      partner: null,
      partnerOnlyQuiet: false,
      partnerReleaseAt: 0,
      asks: {},
      sanctuaryEnabled: false,
      sanctuaryStart: L.DEFAULTS.sanctuaryStart,
      sanctuaryEnd: L.DEFAULTS.sanctuaryEnd,
      sanctuaryDays: L.DEFAULTS.sanctuaryDays,
    });
    if (!st.passHash || !st.salt) return { ok: false, error: "no-password" };

    const now = Date.now();
    const lk = st.lockout || { fails: 0, until: 0, last: 0 };
    if (lk.until > now) return { ok: false, cooldown: Math.ceil((lk.until - now) / 1000) };

    // Either the person's password, or an approval from their partner.
    let credentialOk = false;
    let partnerMinutes = null;
    let asksAfter = null;
    if (typeof msg.partnerRequest === "string" && typeof msg.partnerResponse === "string") {
      const r = await checkApproval(st, msg.partnerRequest.slice(0, 2048), msg.partnerResponse.slice(0, 512), typeof msg.site === "string" ? msg.site : "", now);
      credentialOk = r.ok;
      if (r.ok) {
        partnerMinutes = r.minutes;
        asksAfter = r.asks;
      }
    } else {
      if (partnerOnlyNow(st, now)) return { ok: false, error: "partner-only" };
      const attempt = typeof msg.attempt === "string" ? msg.attempt.slice(0, 1024) : "";
      credentialOk = await PW.verify(attempt, st.salt, st.passHash);
    }
    if (credentialOk) {
      const update = { lockout: { fails: 0, until: 0, last: now } };
      if (asksAfter) update.asks = asksAfter;
      // Opening the browser's extensions page: allowed for a few minutes.
      if (msg.site === "__extensions__") update.manageUntil = now + 5 * 60000;
      // Entering the password on a "daily limit reached" screen buys more time.
      if (typeof msg.extendHost === "string" && st.sites.includes(msg.extendHost) && st.allowances[msg.extendHost] > 0) {
        const today = L.localDateKey(new Date(now));
        const fresh = st.usageDate === today;
        const extra = fresh ? { ...st.extraTime } : {};
        extra[msg.extendHost] = (extra[msg.extendHost] || 0) + EXTEND_SECONDS;
        update.extraTime = extra;
        if (!fresh) {
          update.usageDate = today;
          update.usage = {};
        }
      }
      // Remember the unlock in extension storage (not the page's), so closing and
      // reopening the tab doesn't ask again. It expires, and panic/idle re-lock
      // (lockEpoch) cancels it.
      const site = typeof msg.site === "string" ? msg.site : "";
      if (site && st.sites.includes(site)) {
        const cur = await api.storage.local.get({ unlocks: {}, rememberMinutes: L.DEFAULTS.rememberMinutes, lockEpoch: 0 });
        const pick = partnerMinutes != null ? { ok: true, sliding: false, minutes: Math.max(partnerMinutes, 1) } : L.clampUnlock(Number(msg.minutes), msg.sliding === true, cur.rememberMinutes);
        if (pick.ok) {
          const unlocks = pruneUnlocks(cur.unlocks, now);
          let mins = pick.minutes;
          if (pick.sliding) {
            // "While I'm using it": harder moments (by your own history) are
            // remembered for less time.
            const dec = B.decide(st.brain || B.blank(), site, now, lk.fails || 0, Math.random);
            const level = dec.known ? dec.level : I.riskNow(st.habits, new Date(now), lk.fails || 0).level;
            const factor = I.friction(level, st.adaptive !== false).rememberFactor;
            mins = Math.max(2, Math.round(mins * factor));
          }
          unlocks[site] = { until: now + mins * 60000, epoch: cur.lockEpoch, s: msg.sanctuary === true, fixed: !pick.sliding };
          update.unlocks = unlocks;
        }
        update.habits = I.recordEvent(st.habits, { site, kind: "unlock", ts: now });
        const br = st.brain || B.blank();
        B.onUnlock(br, site, now, msg.why);
        update.brain = br;
      }
      await api.storage.local.set(update);
      return { ok: true, grant: update.unlocks ? update.unlocks[site] : undefined };
    }

    const stale = now - (lk.last || 0) > 15 * 60 * 1000;
    const fails = (stale ? 0 : lk.fails || 0) + 1;
    const wait = L.lockoutSeconds(fails);
    const log = st.watchLog.slice(-49);
    log.push({ site: cleanSite(msg.site), time: now, flagged: wait > 0 });
    const failUpdate = {
      lockout: { fails, until: wait ? now + wait * 1000 : 0, last: now },
      watchLog: log,
    };
    const site = cleanSite(msg.site);
    if (site !== "unknown") failUpdate.habits = I.recordEvent(st.habits, { site, kind: "fail", ts: now });
    const burst = I.failureBurst(log, now);
    if (burst.burst) {
      // A burst at an hour you almost never use these sites is far more telling.
      const odd = B.unusualness(st.brain || B.blank(), now) > 0.85;
      failUpdate.alerts = I.addAlert(st.alerts, {
        kind: "burst",
        site: "",
        ts: now,
        text: burst.text + (odd ? " This is an hour you almost never use these sites, so it may not be you." : " If that wasn't you, someone may be guessing your password."),
      });
    }
    await api.storage.local.set(failUpdate);
    return { ok: false, cooldown: wait };
  });
}

// ------------------------------------------------------------------- usage

function handleUsage(msg) {
  return serial(async () => {
    const seconds = Math.max(0, Math.min(30, Math.floor(Number(msg.seconds) || 0)));
    const st = await api.storage.local.get({ sites: [], usageDate: "", usage: {}, extraTime: {}, usageDaily: {} });
    if (!seconds || !st.sites.includes(msg.host)) return;
    const today = L.localDateKey(new Date());
    const fresh = st.usageDate === today;
    const usage = fresh ? { ...st.usage } : {};
    const extra = fresh ? st.extraTime : {};
    usage[msg.host] = (usage[msg.host] || 0) + seconds;
    const daily = { ...st.usageDaily };
    daily[today] = (daily[today] || 0) + seconds;
    const keys = Object.keys(daily).sort();
    while (keys.length > 30) delete daily[keys.shift()];
    await api.storage.local.set({ usageDate: today, usage, extraTime: extra, usageDaily: daily });
  });
}

// ----------------------------------------------------------- protect a site

async function finalizeProtect(p) {
  const host = L.normalizeHost(p && p.host);
  if (!host) return;
  // Only protect a site we really hold permission for.
  if (api.permissions && api.permissions.contains) {
    try {
      const ok = await api.permissions.contains({ origins: L.hostOrigins(host) });
      if (!ok) return;
    } catch (e) {
      /* fall through: the guard registration will simply fail */
    }
  }
  await addSites([host]);
  await api.storage.local.remove("pendingProtect");
  if (p.tabId != null) await applyNow(p.tabId);
}

// The permission prompt can close the popup that asked for it, so the
// background finishes the job once the permission lands.
if (api.permissions && api.permissions.onAdded) {
  api.permissions.onAdded.addListener(async (perms) => {
    const { pendingProtect } = await api.storage.local.get({ pendingProtect: null });
    if (!pendingProtect || Date.now() - pendingProtect.ts > 120000) return;
    const origins = (perms && perms.origins) || [];
    if (origins.some((o) => o.includes(pendingProtect.host))) await finalizeProtect(pendingProtect);
  });
}

// ---------------------------------------------------------------- messages

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string" || sender.id !== api.runtime.id) return false;

  switch (msg.type) {
    case MSG.verifyPassword:
      handleVerify(msg).then(sendResponse, () => sendResponse({ ok: false, error: "failed" }));
      return true;
    case MSG.askPartner:
      handleAsk(msg).then(sendResponse, () => sendResponse({ ok: false, error: "failed" }));
      return true;
    case MSG.event:
      handleEvent(msg);
      return false;
    case MSG.tamper:
      handleTamper(msg);
      return false;
    case MSG.touchUnlock:
      handleTouch(msg);
      return false;
    case MSG.usageTick:
      handleUsage(msg);
      return false;
    case MSG.applyNow:
      applyNow(msg.tabId != null ? msg.tabId : sender.tab && sender.tab.id);
      return false;
    case MSG.protectSite:
      finalizeProtect({ host: msg.host, tabId: msg.tabId }).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
      return true;
    case MSG.installConsoleUnlock:
    case MSG.removeConsoleUnlock:
      injectConsoleBridge(msg, sender);
      return false;
    default:
      return false;
  }
});

// Disguise mode has no password field on the page. Instead a tiny function is
// placed in the page's own JS world so typing soteria("...") in the console
// reaches us. It has to be injected from here, into the MAIN world, rather than
// with an inline <script>, which a strict Content-Security-Policy would block.
function injectConsoleBridge(msg, sender) {
  if (!sender.tab || sender.tab.id == null) return;
  const target = { tabId: sender.tab.id, frameIds: sender.frameId != null ? [sender.frameId] : undefined };
  const fnName = String(msg.fnName || "soteria");
  try {
    if (msg.type === MSG.installConsoleUnlock) {
      const eventName = String(msg.eventName || "");
      api.scripting
        .executeScript({
          target,
          world: "MAIN",
          func: (name, evt) => {
            window[name] = function (pw) {
              window.dispatchEvent(new CustomEvent(evt, { detail: pw }));
              return "...";
            };
          },
          args: [fnName, eventName],
        })
        .catch(() => {});
    } else {
      api.scripting
        .executeScript({
          target,
          world: "MAIN",
          func: (name) => {
            delete window[name];
          },
          args: [fnName],
        })
        .catch(() => {});
    }
  } catch (e) {
    /* MAIN-world injection isn't available on this browser version */
  }
}

// ----------------------------------------------------------------- storage

api.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;

  if (changes.sites) {
    const before = changes.sites.oldValue || [];
    const after = changes.sites.newValue || [];
    const removed = before.filter((h) => !after.includes(h));
    const added = after.filter((h) => !before.includes(h));

    for (const host of removed) {
      await unregisterSiteScript(host);
      try {
        await api.permissions.remove({ origins: L.hostOrigins(host) });
      } catch (e) {
        /* already gone */
      }
    }
    if (removed.length) {
      await serial(async () => {
        const st = await api.storage.local.get({ snoozes: {}, siteGroups: {}, allowances: {}, usage: {}, extraTime: {}, unlocks: {} });
        let dirty = false;
        for (const host of removed) {
          for (const key of ["snoozes", "siteGroups", "allowances", "usage", "extraTime", "unlocks"]) {
            if (host in st[key]) {
              delete st[key][host];
              dirty = true;
            }
          }
        }
        if (dirty) await api.storage.local.set(st);
      });
    }
    for (const host of added) await registerSiteScript(host);
  }

  if (changes.alerts) syncBadge(changes.alerts.newValue);
  if (changes.idleRelockMinutes) applyIdleWatch(changes.idleRelockMinutes.newValue);
});

// -------------------------------------------------------- idle & shortcuts

const hasIdleApi = !!(api.idle && api.idle.onStateChanged);

function applyIdleWatch(minutes) {
  if (!hasIdleApi || !minutes || minutes <= 0) return;
  try {
    api.idle.setDetectionInterval(Math.max(15, minutes * 60));
  } catch (e) {
    /* unsupported interval */
  }
}

// Every optional API is feature-detected: on a browser that lacks one, only
// that feature goes quiet. A missing API must never stop the script loading.
if (hasIdleApi) {
  api.idle.onStateChanged.addListener(async (state) => {
    if (state !== "idle" && state !== "locked") return;
    const { idleRelockMinutes } = await api.storage.local.get({ idleRelockMinutes: 5 });
    if (idleRelockMinutes > 0) await relockEverything();
  });
}

if (api.commands && api.commands.onCommand) {
  api.commands.onCommand.addListener(async (command) => {
    if (command === "panic-lock") await relockEverything();
  });
}

if (api.contextMenus && api.contextMenus.onClicked) {
  api.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== MENU_ID || !tab || !tab.url) return;
    const host = L.normalizeHost(new URL(tab.url).hostname);
    if (!host) return;
    await api.storage.local.set({ pendingHost: host });
    api.runtime.openOptionsPage();
  });
}

// --------------------------------------------------------------- lifecycle

// First run: show the welcome page once, whichever way the extension arrived
// (store install, side-load, or a browser that never fires onInstalled).
async function maybeOpenWelcome(attempt) {
  const st = await api.storage.local.get({ onboarded: false, passHash: null, welcomeShown: false });
  if (st.onboarded || st.passHash || st.welcomeShown) return;
  try {
    await api.tabs.create({ url: api.runtime.getURL("welcome.html") });
    await api.storage.local.set({ welcomeShown: true });
  } catch (e) {
    // The browser window may not exist yet this early in startup. Try again
    // shortly; if the worker is stopped first, the next startup tries again.
    if ((attempt || 0) < 5) setTimeout(() => maybeOpenWelcome((attempt || 0) + 1), 1500);
  }
}

async function boot(startup) {
  await ensureDefaults();
  // A fresh browser launch always starts locked.
  if (startup === true) await api.storage.local.set({ unlocks: {} });
  await maybeOpenWelcome();
  const { sites, idleRelockMinutes, alerts } = await api.storage.local.get({ sites: [], idleRelockMinutes: 5, alerts: [] });
  syncBadge(alerts);
  await serial(async () => {
    const { brain } = await api.storage.local.get({ brain: null });
    if (brain) {
      B.settle(brain, Date.now());
      await api.storage.local.set({ brain });
    }
  });
  await syncRegistrations(sites);
  applyIdleWatch(idleRelockMinutes);
}

api.runtime.onInstalled.addListener(async () => {
  if (api.contextMenus && api.contextMenus.create) {
    try {
      if (api.contextMenus.removeAll) await api.contextMenus.removeAll();
      api.contextMenus.create({ id: MENU_ID, title: "Protect this site with Soteria", contexts: ["page"] });
    } catch (e) {
      /* context menus unavailable */
    }
  }
  await boot();
});

api.runtime.onStartup.addListener(() => boot(true));
