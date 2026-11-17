/* Soteria by DrSkyle
 * Shared, pure logic. No browser APIs in here, on purpose: the same file is
 * loaded by the content script, the background, every UI page and the tests,
 * so a rule can only ever be written down once.
 */
(function (root) {
  "use strict";

  const DVL = (root.DevilabsSoteria = root.DevilabsSoteria || {});

  const DAY_MS = 24 * 60 * 60 * 1000;
  const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

  // Every message the extension sends to itself. Namespaced so nothing a web
  // page does can be mistaken for one of ours.
  const MSG = Object.freeze({
    verifyPassword: "devilabs.soteria.verify-password",
    usageTick: "devilabs.soteria.usage-tick",
    applyNow: "devilabs.soteria.apply-now",
    protectSite: "devilabs.soteria.protect-site",
    installConsoleUnlock: "devilabs.soteria.install-console-unlock",
    removeConsoleUnlock: "devilabs.soteria.remove-console-unlock",
    touchUnlock: "devilabs.soteria.touch-unlock",
    event: "devilabs.soteria.event",
    askPartner: "devilabs.soteria.ask-partner",
    tamper: "devilabs.soteria.tamper",
  });

  // Defaults for every key Soteria stores. Nothing personal lives here: a fresh
  // install starts empty and everything in storage is something the owner chose.
  const DEFAULTS = Object.freeze({
    sites: [],
    siteGroups: {},
    snoozes: {},
    allowances: {},
    usageDate: "",
    usage: {},
    extraTime: {},
    usageDaily: {},
    watchLog: [],
    lockout: { fails: 0, until: 0, last: 0 },
    passHash: null,
    salt: null,
    disguise: false,
    autoRelockMinutes: 0,
    idleRelockMinutes: 5,
    rememberMinutes: 30,
    unlocks: {},
    adaptive: true,
    supportNoteSeen: false,
    partner: null,
    partnerOnlyQuiet: false,
    asks: {},
    partnerReleaseAt: 0,
    language: "auto",
    ownerName: "",
    checkinSent: "",
    resetAt: 0,
    guardExtensions: false,
    manageUntil: 0,
    habits: {},
    brain: null,
    summarySeen: "",
    customList: [],
    customListName: "",
    alerts: [],
    dismissedTips: [],
    sanctuaryEnabled: false,
    sanctuaryStart: "22:00",
    sanctuaryEnd: "07:00",
    sanctuaryDays: ALL_DAYS,
    lockEpoch: 0,
    firstActive: 0,
    keepsakeNote: "",
    announcedMilestones: [],
    onboarded: false,
    welcomeShown: false,
  });

  // What the content script needs to decide whether a page is locked.
  const CONTENT_KEYS = Object.freeze([
    "sites",
    "passHash",
    "disguise",
    "autoRelockMinutes",
    "rememberMinutes",
    "unlocks",
    "adaptive",
    "partner",
    "partnerOnlyQuiet",
    "language",
    "habits",
    "brain",
    "lockout",
    "lockEpoch",
    "snoozes",
    "allowances",
    "usageDate",
    "usage",
    "extraTime",
    "sanctuaryEnabled",
    "sanctuaryStart",
    "sanctuaryEnd",
    "sanctuaryDays",
  ]);

  // What goes into a backup file.
  const BACKUP_KEYS = Object.freeze([
    "sites",
    "siteGroups",
    "allowances",
    "passHash",
    "salt",
    "disguise",
    "autoRelockMinutes",
    "idleRelockMinutes",
    "rememberMinutes",
    "sanctuaryEnabled",
    "sanctuaryStart",
    "sanctuaryEnd",
    "sanctuaryDays",
    "watchLog",
    "firstActive",
    "keepsakeNote",
    "announcedMilestones",
  ]);

  const BACKUP_FORMAT = "devilabs.soteria.backup";

  // ---------------------------------------------------------------- hosts

  const HOST_RE =
    /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;

  // Turns whatever someone pastes ("https://www.Example.com/a?b=1") into the
  // bare domain Soteria stores ("example.com"). Returns "" if it isn't a
  // domain Soteria can protect (IP addresses, single-label hosts, junk).
  function normalizeHost(raw) {
    if (typeof raw !== "string") return "";
    let v = raw.trim().toLowerCase();
    if (!v || /\s/.test(v)) return "";
    if (!/^[a-z][a-z0-9+.-]*:\/\//.test(v)) v = "http://" + v;
    let host;
    try {
      host = new URL(v).hostname;
    } catch (e) {
      return "";
    }
    host = host.replace(/^www\./, "").replace(/\.$/, "");
    if (!HOST_RE.test(host)) return "";
    if (/^\d+(\.\d+){3}$/.test(host)) return "";
    return host;
  }

  function matchesSite(host, entry) {
    return host === entry || host.endsWith("." + entry);
  }

  function hostOrigins(host) {
    return ["*://" + host + "/*", "*://*." + host + "/*"];
  }

  // ----------------------------------------------------------------- time

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function localDateKey(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function parseHHMM(s) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(typeof s === "string" ? s : "");
    if (!m) return null;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  }

  function formatClock(hhmm, locale) {
    const mins = parseHHMM(hhmm);
    if (mins === null) return "";
    const d = new Date(2000, 0, 1, Math.floor(mins / 60), mins % 60);
    return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  }

  // Is `now` inside the sanctuary window? A window that crosses midnight
  // belongs to the day it starts on, so "Friday 22:00 to 07:00" covers early
  // Saturday morning too.
  function inSanctuaryWindow(start, end, now, days) {
    const s = parseHHMM(start);
    const e = parseHHMM(end);
    if (s === null || e === null || s === e) return false;
    const allowed = Array.isArray(days) ? days : ALL_DAYS;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const dow = now.getDay();
    if (s < e) return allowed.includes(dow) && nowMin >= s && nowMin < e;
    if (nowMin >= s) return allowed.includes(dow);
    if (nowMin < e) return allowed.includes((dow + 6) % 7);
    return false;
  }

  function relativeTime(ts, now) {
    const mins = Math.floor((now - ts) / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return mins + " min ago";
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");
    const days = Math.floor(hours / 24);
    return days + (days === 1 ? " day ago" : " days ago");
  }

  // Forgotten password: a wait, so it can't be used as an impulse bypass.
  const RESET_WAIT_MS = 24 * 3600 * 1000;
  function resetStatus(resetAt, now) {
    if (!resetAt) return { state: "none" };
    if (now >= resetAt) return { state: "ready" };
    return { state: "waiting", hoursLeft: Math.ceil((resetAt - now) / 3600000) };
  }

  // The browser's own pages for managing or removing extensions. Soteria can
  // ask for the password before these open.
  const MANAGE_PAGE = /^(?:chrome|edge|brave|vivaldi|opera|arc):\/\/extensions(?:[\/?#]|$)|^about:addons(?:[?#]|$)/i;
  const isManagePage = (url) => typeof url === "string" && MANAGE_PAGE.test(url.trim());

  // How many hours the quiet-hours window covers (it may wrap past midnight).
  function sanctuaryHours(start, end) {
    const m = (t) => { const [h, mi] = String(t).split(":").map(Number); return h * 60 + (mi || 0); };
    let span = m(end) - m(start);
    if (span <= 0) span += 24 * 60;
    return span / 60;
  }

  // Timed unlocks: when you unlock you say how long you are staying. These are
  // the lengths on offer, never longer than the setting allows.
  const UNLOCK_STEPS = [5, 15, 30, 60];
  function unlockChoices(rememberMinutes) {
    const max = Number(rememberMinutes) || 0;
    if (max <= 0) return { fixed: [], slidingMinutes: 0 };
    let fixed = UNLOCK_STEPS.filter((m) => m <= max);
    if (!fixed.length) fixed = [max];
    return { fixed, slidingMinutes: max };
  }

  // A page asked for an unlock of some length. Only lengths we offer are valid;
  // anything else falls back to the safe default instead of being trusted.
  function clampUnlock(minutes, sliding, rememberMinutes) {
    const c = unlockChoices(rememberMinutes);
    if (!c.slidingMinutes) return { ok: false };
    if (sliding === true) return { ok: true, sliding: true, minutes: c.slidingMinutes };
    if (c.fixed.includes(minutes)) return { ok: true, sliding: false, minutes };
    return { ok: true, sliding: true, minutes: c.slidingMinutes };
  }

  function dayKeys(n, now) {
    const keys = [];
    for (let i = n - 1; i >= 0; i--) {
      keys.push(localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)));
    }
    return keys;
  }

  // ------------------------------------------------------- limits & locking

  // Where a site stands against its daily allowance. Usage from a previous
  // day is ignored, so there is nothing to reset at midnight.
  function limitStatus(state, host, now) {
    const minutes = (state.allowances || {})[host];
    if (!minutes || minutes <= 0) {
      return { hasLimit: false, limited: false, limit: 0, used: 0, extra: 0, remaining: Infinity };
    }
    const fresh = state.usageDate === localDateKey(now);
    const used = fresh ? (state.usage || {})[host] || 0 : 0;
    const extra = fresh ? (state.extraTime || {})[host] || 0 : 0;
    const limit = minutes * 60;
    const remaining = limit + extra - used;
    return { hasLimit: true, limited: remaining <= 0, limit, used, extra, remaining: Math.max(0, remaining) };
  }

  // The one place that decides whether a page is locked, and why.
  // Order matters. During sanctuary hours a snooze is ignored, and only a
  // password entered *during* those hours opens the site (the caller passes
  // that as sessionUnlocked). Outside them, a snooze beats a limit and an
  // earlier unlock counts unless a limit says otherwise.
  function decideLockState(i) {
    if (!i.match || !i.hasPassword) return { locked: false, by: "none" };
    if (i.sanctuaryActive) {
      return i.sessionUnlocked ? { locked: false, by: "session" } : { locked: true, reason: "sanctuary" };
    }
    if (i.snoozedUntil > i.now) return { locked: false, by: "snooze" };
    if (i.limited) return { locked: true, reason: "limit" };
    if (i.sessionUnlocked) return { locked: false, by: "session" };
    return { locked: true, reason: "password" };
  }

  // ------------------------------------------------------------- passwords

  // A plain read on length and variety. No dictionaries, no scolding.
  function passwordScore(pw) {
    if (!pw) return 0;
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 14) score++;
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(pw)).length;
    if (classes >= 2) score++;
    if (classes >= 3) score++;
    return Math.min(score, 4);
  }

  // How long to lock someone out after repeated wrong passwords: nothing for
  // the first four, then 30 seconds after every fifth, doubling up to 15 min.
  function lockoutSeconds(fails) {
    if (fails < 5 || fails % 5 !== 0) return 0;
    const tier = Math.min(Math.floor(fails / 5) - 1, 5);
    return Math.min(30 * Math.pow(2, tier), 15 * 60);
  }

  // ---------------------------------------------------------------- lists

  function groupSites(sites, siteGroups) {
    const buckets = new Map();
    for (const host of sites) {
      const g = (siteGroups && siteGroups[host]) || "";
      if (!buckets.has(g)) buckets.set(g, []);
      buckets.get(g).push(host);
    }
    const named = [...buckets.keys()].filter((g) => g !== "").sort((a, b) => a.localeCompare(b));
    const order = buckets.has("") ? ["", ...named] : named;
    return order.map((name) => ({ name, hosts: buckets.get(name).slice().sort() }));
  }

  function attemptsByDay(watchLog, n, now) {
    const keys = dayKeys(n, now);
    const counts = Object.create(null);
    keys.forEach((k) => (counts[k] = 0));
    for (const e of watchLog || []) {
      const k = localDateKey(new Date(e.time));
      if (k in counts) counts[k]++;
    }
    return keys.map((date) => ({ date, value: counts[date] }));
  }

  function secondsByDay(usageDaily, n, now) {
    return dayKeys(n, now).map((date) => ({ date, value: (usageDaily && usageDaily[date]) || 0 }));
  }

  function formatDuration(seconds) {
    const m = Math.round(seconds / 60);
    if (m < 1) return seconds > 0 ? "Under a minute" : "0 min";
    if (m < 60) return m + " min";
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? h + " h " + r + " min" : h + " h";
  }

  // The same domain always gets the same decoy page, so a site doesn't flip
  // between different fake errors from one visit to the next.
  function hashIndex(str, n) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % n;
  }

  // -------------------------------------------------------------- backups

  const B64_RE = /^[A-Za-z0-9+/=_-]{8,512}$/;
  const clampInt = (v, lo, hi, fallback) =>
    Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : fallback;

  // Never trust a backup file: it may be hand-edited, corrupted, or from
  // somewhere else entirely. Everything is re-validated on the way in.
  function sanitizeState(d) {
    const out = {};
    const seen = new Set();
    const sites = [];
    for (const raw of Array.isArray(d.sites) ? d.sites : []) {
      const h = normalizeHost(raw);
      if (h && !seen.has(h) && sites.length < 500) {
        seen.add(h);
        sites.push(h);
      }
    }
    out.sites = sites;

    const pickMap = (src, map) => {
      const res = {};
      if (src && typeof src === "object" && !Array.isArray(src)) {
        for (const h of sites) {
          if (Object.prototype.hasOwnProperty.call(src, h)) {
            const v = map(src[h]);
            if (v !== undefined) res[h] = v;
          }
        }
      }
      return res;
    };
    out.siteGroups = pickMap(d.siteGroups, (v) => {
      const s = typeof v === "string" ? v.trim().slice(0, 40) : "";
      return s || undefined;
    });
    out.allowances = pickMap(d.allowances, (v) => {
      const n = clampInt(v, 1, 1440, 0);
      return n || undefined;
    });

    if (typeof d.passHash === "string" && typeof d.salt === "string" && B64_RE.test(d.passHash) && B64_RE.test(d.salt)) {
      out.passHash = d.passHash;
      out.salt = d.salt;
    }
    out.disguise = d.disguise === true;
    out.autoRelockMinutes = [0, 1, 5, 15, 30].includes(d.autoRelockMinutes) ? d.autoRelockMinutes : 0;
    out.idleRelockMinutes = [0, 1, 5, 15].includes(d.idleRelockMinutes) ? d.idleRelockMinutes : 5;
    out.sanctuaryEnabled = d.sanctuaryEnabled === true;
    out.sanctuaryStart = parseHHMM(d.sanctuaryStart) !== null ? d.sanctuaryStart : DEFAULTS.sanctuaryStart;
    out.sanctuaryEnd = parseHHMM(d.sanctuaryEnd) !== null ? d.sanctuaryEnd : DEFAULTS.sanctuaryEnd;
    out.sanctuaryDays = Array.isArray(d.sanctuaryDays)
      ? [...new Set(d.sanctuaryDays.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))]
      : ALL_DAYS;
    out.watchLog = (Array.isArray(d.watchLog) ? d.watchLog : [])
      .filter((e) => e && typeof e.site === "string" && Number.isFinite(e.time))
      .slice(-50)
      .map((e) => ({ site: e.site.slice(0, 253), time: e.time, flagged: e.flagged === true }));
    out.rememberMinutes = [0, 5, 15, 30, 60, 240].includes(d.rememberMinutes) ? d.rememberMinutes : DEFAULTS.rememberMinutes;
    out.firstActive = Number.isFinite(d.firstActive) && d.firstActive > 0 ? d.firstActive : 0;
    out.keepsakeNote = typeof d.keepsakeNote === "string" ? d.keepsakeNote.slice(0, 5000) : "";
    out.announcedMilestones = (Array.isArray(d.announcedMilestones) ? d.announcedMilestones : [])
      .filter((n) => Number.isInteger(n) && n > 0 && n < 100000)
      .slice(0, 20);
    return out;
  }

  function parseBackup(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: "unreadable" };
    }
    const legacy = parsed && parsed.soteriaBackup === 1;
    const current = parsed && parsed.format === BACKUP_FORMAT;
    const data = parsed && parsed.data;
    if ((!legacy && !current) || !data || typeof data !== "object" || !Array.isArray(data.sites)) {
      return { ok: false, error: "not-a-backup" };
    }
    return { ok: true, data: sanitizeState(data) };
  }

  DVL.logic = Object.freeze({
    DAY_MS,
    ALL_DAYS,
    MSG,
    DEFAULTS,
    CONTENT_KEYS,
    BACKUP_KEYS,
    BACKUP_FORMAT,
    normalizeHost,
    matchesSite,
    hostOrigins,
    localDateKey,
    parseHHMM,
    formatClock,
    inSanctuaryWindow,
    relativeTime,
    dayKeys,
    RESET_WAIT_MS,
    resetStatus,
    isManagePage,
    sanctuaryHours,
    unlockChoices,
    clampUnlock,
    limitStatus,
    decideLockState,
    passwordScore,
    lockoutSeconds,
    groupSites,
    attemptsByDay,
    secondsByDay,
    formatDuration,
    hashIndex,
    sanitizeState,
    parseBackup,
  });

  if (typeof module !== "undefined" && module.exports) module.exports = DVL.logic;
})(typeof globalThis !== "undefined" ? globalThis : this);
