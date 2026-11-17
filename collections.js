/* Soteria by DrSkyle
 * Starter collections: public, well-known domains grouped so a new person can
 * protect a whole category in one step instead of typing sites one by one.
 */
(function (root) {
  "use strict";

  const DVL = (root.DevilabsSoteria = root.DevilabsSoteria || {});

  const COLLECTIONS = Object.freeze([
    {
      id: "social",
      name: "Social media",
      blurb: "Feeds and networks",
      hosts: ["facebook.com", "instagram.com", "x.com", "twitter.com", "tiktok.com", "reddit.com", "snapchat.com", "linkedin.com", "pinterest.com", "threads.net", "tumblr.com"],
    },
    {
      id: "video",
      name: "Video and streaming",
      blurb: "Watch-for-hours sites",
      hosts: ["youtube.com", "netflix.com", "twitch.tv", "primevideo.com", "disneyplus.com", "hulu.com", "max.com", "vimeo.com", "dailymotion.com"],
    },
    {
      id: "news",
      name: "News",
      blurb: "Headlines and doomscrolling",
      hosts: ["nytimes.com", "cnn.com", "bbc.com", "theguardian.com", "washingtonpost.com", "foxnews.com", "reuters.com", "news.ycombinator.com"],
    },
    {
      id: "shopping",
      name: "Shopping",
      blurb: "Carts and wish lists",
      hosts: ["amazon.com", "ebay.com", "aliexpress.com", "etsy.com", "walmart.com", "temu.com", "shein.com"],
    },
    {
      id: "messaging",
      name: "Mail and messaging",
      blurb: "Inboxes and chats",
      hosts: ["mail.google.com", "outlook.live.com", "outlook.office.com", "web.whatsapp.com", "web.telegram.org", "discord.com", "messenger.com"],
    },
    {
      id: "games",
      name: "Games",
      blurb: "Stores and game sites",
      hosts: ["store.steampowered.com", "steamcommunity.com", "roblox.com", "epicgames.com", "chess.com", "miniclip.com"],
    },
    {
      id: "dating",
      name: "Dating",
      blurb: "Apps and profiles",
      hosts: ["tinder.com", "bumble.com", "hinge.co", "match.com", "okcupid.com"],
    },
  ]);

  function hostsFor(ids) {
    const out = [];
    for (const c of COLLECTIONS) {
      if (ids.includes(c.id)) for (const h of c.hosts) if (!out.includes(h)) out.push(h);
    }
    return out;
  }

  // ---- Share a list as a short code anyone can paste. Offline: the code IS the
  // list. Format: SOTERIA1.<payload>.<check>. Importing validates everything,
  // so a code can only ever add plain domain names.
  const MAX_SHARED = 100;
  const DOMAIN = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

  function toB64u(s) {
    const b = typeof Buffer !== "undefined" ? Buffer.from(s, "utf8").toString("base64") : btoa(unescape(encodeURIComponent(s)));
    return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function fromB64u(s) {
    const b = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
    return typeof Buffer !== "undefined" ? Buffer.from(b, "base64").toString("utf8") : decodeURIComponent(escape(atob(b)));
  }
  function check(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return (h & 0xffff).toString(16).padStart(4, "0");
  }

  function encodeShare(name, hosts) {
    const clean = [...new Set((hosts || []).map((x) => String(x).toLowerCase()).filter((x) => DOMAIN.test(x)))].slice(0, MAX_SHARED);
    const label = String(name || "My Soteria list").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40) || "My Soteria list";
    const payload = toB64u(JSON.stringify({ v: 1, n: label, h: clean }));
    return "SOTERIA1." + payload + "." + check(payload);
  }

  function decodeShare(text) {
    const t = String(text || "").replace(/\s+/g, "");
    const m = /^SOTERIA1\.([A-Za-z0-9_-]+)\.([0-9a-f]{4})$/.exec(t);
    if (!m) return { ok: false, error: "That doesn't look like a Soteria code." };
    if (check(m[1]) !== m[2]) return { ok: false, error: "The code looks damaged. Copy it again in full." };
    let d;
    try {
      d = JSON.parse(fromB64u(m[1]));
    } catch (e) {
      return { ok: false, error: "The code couldn't be read." };
    }
    if (!d || d.v !== 1 || !Array.isArray(d.h)) return { ok: false, error: "The code couldn't be read." };
    const hosts = [...new Set(d.h.map((x) => String(x).toLowerCase()).filter((x) => DOMAIN.test(x)))].slice(0, MAX_SHARED);
    if (!hosts.length) return { ok: false, error: "There are no sites in that code." };
    const name = String(d.n || "Shared list").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40) || "Shared list";
    return { ok: true, name, hosts };
  }

  DVL.collections = Object.freeze({ COLLECTIONS, hostsFor, encodeShare, decodeShare, MAX_SHARED });
  if (typeof module !== "undefined" && module.exports) module.exports = DVL.collections;
})(typeof globalThis !== "undefined" ? globalThis : this);
