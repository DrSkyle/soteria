/* Soteria partner page: local only, no network. */
(function () {
  "use strict";
  const DVL = globalThis.DevilabsSoteria;
  const P = DVL && DVL.partner;
  const $ = (id) => document.getElementById(id);
  const KEY = "soteria.partner.key";
  let key = null;

  function say(el, text, kind) {
    el.textContent = text || "";
    el.className = "msg" + (kind ? " " + kind : "");
  }
  async function copy(text, msgEl) {
    try {
      await navigator.clipboard.writeText(text);
      say(msgEl, "Copied", "ok");
    } catch (e) {
      say(msgEl, "Select the code and copy it manually.", "err");
    }
    setTimeout(() => say(msgEl, ""), 1800);
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) key = JSON.parse(raw);
    } catch (e) {
      key = null;
    }
    renderKey();
  }
  function renderKey() {
    const has = !!(key && key.publicCode && key.privateJwk);
    $("backup").disabled = !has;
    $("keyBox").classList.toggle("hidden", !has);
    if (has) $("pubcode").textContent = key.publicCode;
    $("approve").disabled = !has;
  }
  function parseRequest(text) {
    const r = P.parseRequest(text);
    if (!r.ok) return null;
    return r;
  }
  function renderRequest(r) {
    const box = $("reqInfo");
    box.textContent = "";
    if (!r) { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    const rows = [
      ["Site / action", r.site],
      ["For", r.minutes ? r.minutes + " minutes" : "no time limit on the grant"],
    ];
    for (const [k, v] of rows) {
      const b = document.createElement("b"); b.textContent = k;
      const s = document.createElement("span"); s.textContent = v;
      box.append(b, s);
    }
  }

  if (!P || !globalThis.crypto || !globalThis.crypto.subtle) {
    say($("keyMsg"), "This browser can't run the key code here. Open this page over https:// instead of a local file.", "err");
    return;
  }

  $("make").addEventListener("click", async () => {
    $("make").disabled = true;
    try {
      const kp = await P.generateKeyPair();
      key = { publicCode: kp.publicCode, privateJwk: kp.privateJwk, created: Date.now() };
      localStorage.setItem(KEY, JSON.stringify(key));
      renderKey();
      say($("keyMsg"), "Key created. Save your public code and back up the private key.", "ok");
    } catch (e) {
      say($("keyMsg"), "Could not create a key in this browser.", "err");
    }
    $("make").disabled = false;
  });

  $("copyPub").addEventListener("click", () => copy(key ? key.publicCode : "", $("pubMsg")));

  $("backup").addEventListener("click", () => {
    if (!key) return;
    const blob = new Blob([JSON.stringify(key, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "soteria-partner-key.json";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    say($("keyMsg"), "Backup downloaded. Keep it somewhere safe.", "ok");
  });

  $("restore").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const ok = data && typeof data.publicCode === "string" && data.privateJwk && (await P.checkPublicCode(data.publicCode));
      if (!ok) throw new Error("bad key");
      key = { publicCode: data.publicCode, privateJwk: data.privateJwk, created: data.created || Date.now() };
      localStorage.setItem(KEY, JSON.stringify(key));
      renderKey();
      say($("keyMsg"), "Key restored.", "ok");
    } catch (err) {
      say($("keyMsg"), "That file isn't a Soteria partner key.", "err");
    }
    e.target.value = "";
  });

  $("read").addEventListener("click", () => {
    say($("reqMsg"), "");
    $("replyBox").classList.add("hidden");
    const r = parseRequest($("req").value);
    if (!r) {
      renderRequest(null);
      $("approve").disabled = true;
      return say($("reqMsg"), "That doesn't look like a Soteria request.", "err");
    }
    renderRequest(r);
    $("approve").disabled = !key;
    say($("reqMsg"), key ? "Check it, then approve." : "Create or restore your key first.", key ? "ok" : "err");
  });

  $("approve").addEventListener("click", async () => {
    if (!key) return say($("reqMsg"), "Create or restore your key first.", "err");
    const text = $("req").value.trim();
    const r = parseRequest(text);
    if (!r) return say($("reqMsg"), "That doesn't look like a Soteria request.", "err");
    try {
      const reply = await P.sign(key.privateJwk, text);
      $("reply").textContent = reply;
      $("replyBox").classList.remove("hidden");
      say($("reqMsg"), "Approved. Send them the reply code.", "ok");
    } catch (e) {
      say($("reqMsg"), "Could not sign that request with this key.", "err");
    }
  });

  $("copyReply").addEventListener("click", () => copy($("reply").textContent, $("replyMsg")));

  $("readWeek").addEventListener("click", () => {
    const box = $("weekInfo");
    box.textContent = "";
    box.classList.add("hidden");
    say($("weekMsg"), "");
    const r = P.parseCheckin($("checkin").value);
    if (!r.ok) return say($("weekMsg"), r.error === "damaged" ? "That code looks damaged. Ask them to copy it again." : "That doesn't look like a Soteria check-in.", "err");
    box.classList.remove("hidden");
    const rows = [
      ["From", r.name || "Soteria user"],
      ["Week of", r.week],
      ["Lock screens", String(r.tries)],
      ["Walked away", String(r.walked)],
      ["Unlocked", String(r.unlocked)],
      ["Clean days", r.clean + " of " + r.active],
      ["They say", r.tone],
    ];
    for (const [k, v] of rows) {
      const b = document.createElement("b"); b.textContent = k;
      const s = document.createElement("span"); s.textContent = v;
      box.append(b, s);
    }
    say($("weekMsg"), "Self-reported totals, not proof.", "ok");
  });

  load();
})();
