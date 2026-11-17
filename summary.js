/* Soteria by DrSkyle: summary.
 * Writes "Your week" from the counts Soteria already keeps on this device.
 * Every sentence is built from a real number, and a sentence is left out when
 * there is no number to back it. Nothing is estimated and nothing is sent.
 */
(function (root) {
  "use strict";

  const DVL = (root.DevilabsSoteria = root.DevilabsSoteria || {});

  const REASON_LABEL = { messages: "messages", work: "work", bored: "just bored", other: "something else" };
  const dayKey = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many || one + "s");
  const clock = (h) => new Date(2000, 0, 1, ((h % 24) + 24) % 24).toLocaleTimeString([], { hour: "numeric" });
  const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function collect(brain, startOfToday, offset, firstActive) {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(startOfToday);
      d.setDate(d.getDate() - i - offset);
      const rec = (brain.daily || {})[dayKey(d)] || { tries: 0, unlocks: 0 };
      const active = !firstActive || d.getTime() + 86400000 > firstActive;
      days.push({ key: dayKey(d), date: d, tries: rec.tries || 0, unlocks: rec.unlocks || 0, s: rec.s || {}, h: rec.h || {}, r: rec.r || {}, active });
    }
    return days;
  }

  function totals(days) {
    const t = { tries: 0, unlocks: 0, activeDays: 0, cleanDays: 0, longestClean: 0, sites: {}, hours: new Array(24).fill(0), reasons: {} };
    let run = 0;
    for (const d of days) {
      t.tries += d.tries;
      t.unlocks += d.unlocks;
      if (d.active) {
        t.activeDays += 1;
        if (d.unlocks === 0) {
          t.cleanDays += 1;
          run += 1;
          t.longestClean = Math.max(t.longestClean, run);
        } else run = 0;
      }
      for (const [s, v] of Object.entries(d.s)) {
        t.sites[s] = t.sites[s] || { t: 0, u: 0 };
        t.sites[s].t += v.t || 0;
        t.sites[s].u += v.u || 0;
      }
      for (const [h, n] of Object.entries(d.h)) t.hours[Number(h)] += n;
      for (const [r, n] of Object.entries(d.r)) t.reasons[r] = (t.reasons[r] || 0) + n;
    }
    t.walked = Math.max(0, t.tries - t.unlocks);
    return t;
  }

  // The busiest two-hour stretch for unlocks, if there is a real peak.
  function peak(hours) {
    const total = hours.reduce((a, b) => a + b, 0);
    if (total < 4) return null;
    let best = { start: 0, sum: -1 };
    for (let s = 0; s < 24; s++) {
      const sum = hours[s] + hours[(s + 1) % 24];
      if (sum > best.sum) best = { start: s, sum };
    }
    return best.sum / total >= 0.4 ? { start: best.start, share: best.sum / total } : null;
  }

  function build(brain, state, nowMs) {
    const now = new Date(nowMs);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const first = state.firstActive || 0;
    const cur = collect(brain, today, 0, first);
    const prev = collect(brain, today, 7, first);
    const t = totals(cur), p = totals(prev);

    if (t.activeDays < 3 || (t.tries === 0 && t.activeDays < 7)) {
      return { ready: false, headline: "Your first summary is on its way", paragraphs: ["Soteria needs about three days with a protected site to say anything honest about your week. It will show up here."] };
    }

    const hasPrev = p.activeDays >= 3 && p.tries > 0;
    let tone = "steady";
    if (t.tries === 0) tone = "quiet";
    else if (hasPrev && p.unlocks >= 3 && t.unlocks <= p.unlocks * 0.8) tone = "better";
    else if (hasPrev && t.unlocks - p.unlocks >= 3 && t.unlocks >= p.unlocks * 1.3) tone = "harder";
    else if (t.unlocks === 0) tone = "better";
    const headline = { quiet: "A quiet week", better: "A better week", harder: "A harder week", steady: "A steady week" }[tone];

    const out = [];
    if (t.tries === 0) {
      out.push("Nothing tried to open a protected site this week.");
    } else {
      const rate = Math.round((t.walked / t.tries) * 100);
      out.push(
        "A lock screen came up " + plural(t.tries, "time") + ". You walked away from " + t.walked + " of them" +
          (t.tries >= 4 ? " (" + rate + "%)" : "") + " and went in " + t.unlocks + (t.unlocks === 1 ? " time." : " times.")
      );
      if (hasPrev) {
        const diff = t.unlocks - p.unlocks;
        if (diff < 0) out.push("That is " + plural(-diff, "unlock") + " fewer than the week before.");
        else if (diff > 0) out.push("That is " + plural(diff, "unlock") + " more than the week before.");
        else out.push("The same number of unlocks as the week before.");
      }
    }
    if (t.cleanDays > 0 && t.activeDays > 0) {
      out.push(plural(t.cleanDays, "day") + " of " + t.activeDays + " had no unlocks" + (t.longestClean >= 3 ? ", with a run of " + t.longestClean + " in a row." : "."));
    }

    const topSite = Object.entries(t.sites).sort((a, b) => b[1].u - a[1].u || b[1].t - a[1].t)[0];
    const pk = peak(t.hours);
    if (topSite && topSite[1].u >= 2) {
      let line = "Most of your unlocks were on " + topSite[0];
      if (pk) line += ", mostly between " + clock(pk.start) + " and " + clock(pk.start + 2);
      out.push(line + ".");
    } else if (pk) {
      out.push("Your unlocks bunched up between " + clock(pk.start) + " and " + clock(pk.start + 2) + ".");
    }

    const reasonTotal = Object.values(t.reasons).reduce((a, b) => a + b, 0);
    let topReason = null;
    if (reasonTotal >= 3) {
      topReason = Object.entries(t.reasons).sort((a, b) => b[1] - a[1])[0];
      let line = "When you said why, it was most often " + REASON_LABEL[topReason[0]] + " (" + topReason[1] + " of " + reasonTotal + ").";
      if (topReason[0] === "bored") line += " Those are the visits a short pause is made for.";
      out.push(line);
    }

    // One closing line that is true for the tone and never scolds.
    if (tone === "better") out.push("Whatever you did this week, it worked.");
    else if (tone === "harder") out.push("Harder weeks happen, and one doesn't undo the others.");
    else if (tone === "quiet") out.push("A quiet week is a good week.");

    // The single most useful thing to try, if the numbers point at one.
    let nextStep = "";
    if (pk && t.unlocks >= 6) nextStep = "Quiet hours from " + clock(pk.start) + " to " + clock(pk.start + 2) + " would cover " + Math.round(pk.share * 100) + "% of this week's unlocks.";
    else if (topReason && topReason[0] === "bored" && topReason[1] >= 3) nextStep = "Try choosing 5 minutes when you unlock, so each visit has an end.";

    // Bars, one per day: unlocks.
    const bars = cur.map((d) => ({ date: d.key, label: WEEKDAY[d.date.getDay()].slice(0, 3), value: d.unlocks }));
    const reasons = Object.entries(t.reasons).sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, label: REASON_LABEL[id], n }));
    const best = cur.filter((d) => d.tries > 0 && d.unlocks === 0).sort((a, b) => b.tries - a.tries)[0];

    const stats = [
      { label: "Lock screens", value: t.tries },
      { label: "Walked away", value: t.walked },
      { label: "Unlocked", value: t.unlocks },
      { label: "Clean days", value: t.cleanDays + " of " + t.activeDays },
    ];
    const text = ["Soteria: " + headline, ...out, nextStep].filter(Boolean).join("\n");
    const raw = { tries: t.tries, walked: t.walked, unlocked: t.unlocks, clean: t.cleanDays, active: t.activeDays };
    return { ready: true, tone, headline, paragraphs: out, nextStep, stats, bars, reasons, raw, weekStart: cur[0].key, bestDay: best ? WEEKDAY[best.date.getDay()] : "", text };
  }

  // Sunday is when a new summary appears; this is the key for "this week's".
  function weekKey(nowMs) {
    const d = new Date(nowMs);
    d.setDate(d.getDate() - d.getDay());
    return dayKey(d);
  }

  DVL.summary = Object.freeze({ build, weekKey, REASON_LABEL });
  if (typeof module !== "undefined" && module.exports) module.exports = DVL.summary;
})(typeof globalThis !== "undefined" ? globalThis : this);
