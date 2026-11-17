/* Soteria by DrSkyle: ask.
 * A small question-and-answer helper. It matches what you type against a
 * handful of topics and answers from your own local numbers, in plain
 * sentences. Nothing is sent anywhere.
 */
(function (root) {
  "use strict";

  const DVL = (root.DevilabsSoteria = root.DevilabsSoteria || {});

  const dayKey = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");

  // Consecutive days, counting back from today, with no unlocks. Capped at the
  // number of days Soteria has actually been running.
  function streakDays(brain, now, firstActive) {
    const daily = (brain && brain.daily) || {};
    const since = firstActive ? Math.floor((now - firstActive) / 86400000) : 0;
    let n = 0;
    for (let i = 0; i <= 41 && i <= since; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const rec = daily[dayKey(d)];
      if (rec && rec.unlocks > 0) break;
      n++;
    }
    return n;
  }

  function today(brain, now) {
    const rec = ((brain && brain.daily) || {})[dayKey(new Date(now))] || { tries: 0, unlocks: 0 };
    return { tries: rec.tries, unlocks: rec.unlocks, resisted: Math.max(0, rec.tries - rec.unlocks) };
  }

  const TOPICS = [
    { id: "today", words: ["today", "so far", "tonight"] },
    { id: "streak", words: ["streak", "days", "record", "best", "long", "clean"] },
    { id: "when", words: ["when", "time", "hour", "slip", "pattern", "usually", "worst", "peak"] },
    { id: "change", words: ["change", "suggest", "should", "improve", "better", "advice", "tip", "do"] },
    { id: "summary", words: ["summary", "weekly", "recap", "week"] },
    { id: "trend", words: ["trend", "week", "worse", "better", "more", "less", "progress", "improving", "doing"] },
    { id: "safe", words: ["safe", "threat", "phishing", "alert", "attack", "hack", "suspicious", "tamper"] },
    { id: "work", words: ["work", "working", "pause", "help", "helps", "effective"] },
    { id: "learn", words: ["learn", "know", "data", "store", "privacy", "see"] },
    { id: "help", words: ["help", "what can", "commands", "ask"] },
  ];

  function pick(text) {
    const q = " " + String(text || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ") + " ";
    let best = null, bestScore = 0;
    for (const t of TOPICS) {
      let score = 0;
      for (const w of t.words) if (q.includes(" " + w + " ") || (w.length > 4 && q.includes(" " + w))) score += w.includes(" ") ? 2 : 1;
      if (score > bestScore) {
        best = t.id;
        bestScore = score;
      }
    }
    return best;
  }

  function answer(question, st, now) {
    const I = DVL.insight, B = DVL.brain;
    const brain = st.brain || (B && B.blank());
    const t = pick(question);
    const sites = (st.sites || []).length;

    if (!sites) return "Nothing is protected yet, so there is nothing for me to tell you about. Add a site first.";

    switch (t) {
      case "today": {
        const d = today(brain, now);
        if (!d.tries) return "Nothing has tried to open a protected site today.";
        return "Today there were " + plural(d.tries, "lock screen") + ". You unlocked " + d.unlocks + " and walked away from " + d.resisted + ".";
      }
      case "streak": {
        const n = streakDays(brain, now, st.firstActive);
        if (!st.firstActive || n === 0) return "No clean days in a row yet. Today counts as the start if you stop now.";
        return n === 1 ? "One day without unlocking a protected site." : n + " days in a row without unlocking a protected site.";
      }
      case "when": {
        const h = I.headline(st.habits || {}, new Date(now));
        return h;
      }
      case "change": {
        const tips = I.suggestions(st, st.habits || {}, { canLimit: true });
        if (!tips.length) return "I have nothing to change yet. When I see something worth adjusting, it will show under Suggestions.";
        return "The most useful change right now: " + tips[0].title + ". " + tips[0].body;
      }
      case "summary": {
        const r = DVL.summary ? DVL.summary.build(brain, st, now) : null;
        if (!r) return "I can't write a summary right now.";
        return r.ready ? r.headline + ". " + r.paragraphs.join(" ") : r.paragraphs[0];
      }
      case "trend": {
        const dr = B.drift(brain, now);
        if (dr.state === "up") return "You have reached for these sites more than usual lately: about " + Math.round(dr.recent) + " times a day against your usual " + Math.round(dr.mean) + ".";
        if (dr.state === "down") return "Down from your usual. About " + Math.round(dr.recent) + " times a day against " + Math.round(dr.mean) + " before.";
        if (dr.state === "steady") return "Steady. About " + Math.round(dr.recent) + " times a day, in line with your usual.";
        return "Not enough days yet to say. I need about three weeks to compare against.";
      }
      case "safe": {
        const unseen = (st.alerts || []).filter((a) => !a.seen).length;
        if (unseen) return "You have " + plural(unseen, "unread alert") + ". Open the Alerts section to read them.";
        return "No alerts. I check the sites you visit against a list of known phishing domains, and watch for anything trying to remove the lock screen.";
      }
      case "work": {
        const a = B.armSummary(brain);
        if (!a.length) return "I have not tried enough pauses yet to say what works for you.";
        return a.map((x) => "In " + (x.bucket === "high" ? "hard" : "busier") + " moments " + (x.pause ? "a " + x.pause + " second pause" : "no pause") + " has worked best, resisting " + Math.round(x.mean * 100) + "% of the time.").join(" ");
      }
      case "learn":
        return "I keep counts: which hours you unlock at, how often, and whether you gave in or walked away. No page content, no history, and none of it leaves this device. You can erase it from Insights.";
      case "help":
      default:
        return "I can tell you about today, your streak, when you tend to slip, how this week compares, what to change, what has been working, and whether anything looks unsafe. Try one of those.";
    }
  }

  DVL.ask = Object.freeze({ answer, streakDays, today, pick });
  if (typeof module !== "undefined" && module.exports) module.exports = DVL.ask;
})(typeof globalThis !== "undefined" ? globalThis : this);
