/* Soteria by DrSkyle
 * The one quiet line under her name in settings. It isn't feeling anything: it
 * is a small weighted scorer over her real local history (how long she has run,
 * how often she has been tested, how quiet it has been). Seeded by that state,
 * so it holds steady within a day instead of flickering.
 */
(function (root) {
  "use strict";

  const DVL = (root.DevilabsSoteria = root.DevilabsSoteria || {});

  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashSeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  const PHRASES = {
    new: ["Just getting started.", "Early days."],
    vigilant: ["A busier week than usual.", "Someone has been trying."],
    settled: ["Quiet lately.", "Nothing has tried her in a while."],
    proud: ["Still standing.", "Steady as ever."],
    steady: ["Watching, same as always.", "Everything is where you left it."],
    milestone7: ["One week in."],
    milestone30: ["Thirty days."],
    milestone100: ["One hundred days."],
    milestone365: ["A full year."],
  };
  const MILESTONES = [7, 30, 100, 365];

  function computeMood(stats) {
    const s = stats || {};
    const now = s.now || Date.now();
    const log = s.watchLog || [];
    const announced = s.announcedMilestones || [];
    if (!s.firstActive) return { mood: "new", phrase: PHRASES.new[0], milestone: null };

    const day = 86400000;
    const days = Math.max(0, Math.floor((now - s.firstActive) / day));
    const recent = log.filter((e) => now - e.time < 7 * day).length;
    const flaggedRecent = log.filter((e) => e.flagged && now - e.time < 14 * day).length;
    const rand = mulberry32(hashSeed(days + ":" + log.length + ":" + recent));

    const crossed = MILESTONES.filter((m) => days >= m && !announced.includes(m));
    if (crossed.length) {
      const m = Math.max.apply(null, crossed);
      const pool = PHRASES["milestone" + m];
      return { mood: "milestone" + m, phrase: pool[Math.floor(rand() * pool.length)], milestone: m };
    }

    const scores = {
      new: days < 3 ? 3 : 0,
      vigilant: recent >= 2 || flaggedRecent >= 1 ? 2 + recent : 0,
      settled: days >= 14 && recent === 0 ? 2 : 0,
      proud: days >= 30 && log.length >= 3 && flaggedRecent === 0 ? 2 : 0,
      steady: 1,
    };
    let best = "steady";
    let bestScore = -1;
    for (const k of Object.keys(scores)) {
      const sc = scores[k] + rand() * 0.3;
      if (sc > bestScore) {
        bestScore = sc;
        best = k;
      }
    }
    const pool = PHRASES[best];
    return { mood: best, phrase: pool[Math.floor(rand() * pool.length)], milestone: null };
  }

  DVL.mood = Object.freeze({ computeMood });
  if (typeof module !== "undefined" && module.exports) module.exports = DVL.mood;
})(typeof globalThis !== "undefined" ? globalThis : this);
