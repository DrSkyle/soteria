/* Soteria by DrSkyle: card.
 * Draws the "Your week" image people can save and share. Drawn on this device
 * with a canvas. It carries only totals, never site names or anything personal.
 */
(function (root) {
  "use strict";

  const DVL = (root.DevilabsSoteria = root.DevilabsSoteria || {});

  // What the card says, from a built summary. No site names, on purpose.
  function cardData(summary, weekLabel) {
    const s = Object.fromEntries(summary.stats.map((x) => [x.label, x.value]));
    const tries = s["Lock screens"], walked = s["Walked away"];
    const big = tries >= 4 ? Math.round((walked / tries) * 100) + "%" : String(walked);
    const label = tries >= 4 ? "of lock screens walked away from" : walked === 1 ? "lock screen walked away from" : "lock screens walked away from";
    return { headline: summary.headline, big, label, stats: summary.stats, weekLabel };
  }

  function wrap(ctx, text, maxWidth) {
    const words = text.split(" ");
    const lines = [];
    let line = "";
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  // 1080 x 1350: the shape social feeds show best.
  function draw(ctx, W, H, d) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#161513");
    g.addColorStop(1, "#24211d");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const font = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    const pad = 96;

    ctx.fillStyle = "#a29d92";
    ctx.font = "500 34px " + font;
    ctx.fillText(d.weekLabel.toUpperCase(), pad, 150);

    ctx.fillStyle = "#f2efe9";
    ctx.font = "600 76px " + font;
    let y = 270;
    for (const line of wrap(ctx, d.headline, W - pad * 2)) {
      ctx.fillText(line, pad, y);
      y += 88;
    }

    ctx.font = "700 300px " + font;
    ctx.fillStyle = "#f2efe9";
    ctx.fillText(d.big, pad - 8, 700);

    ctx.font = "400 44px " + font;
    ctx.fillStyle = "#a29d92";
    let ly = 770;
    for (const line of wrap(ctx, d.label, W - pad * 2)) {
      ctx.fillText(line, pad, ly);
      ly += 56;
    }

    // Four numbers along the bottom.
    const colW = (W - pad * 2) / 4;
    d.stats.forEach((s, i) => {
      const x = pad + i * colW;
      ctx.fillStyle = "#f2efe9";
      ctx.font = "600 64px " + font;
      ctx.fillText(String(s.value), x, 1030);
      ctx.fillStyle = "#a29d92";
      ctx.font = "400 28px " + font;
      ctx.fillText(s.label, x, 1076);
    });

    ctx.fillStyle = "#3a3731";
    ctx.fillRect(pad, 1160, W - pad * 2, 2);
    ctx.fillStyle = "#f2efe9";
    ctx.font = "600 40px " + font;
    ctx.fillText("Soteria", pad, 1240);
    ctx.fillStyle = "#a29d92";
    ctx.font = "400 30px " + font;
    ctx.fillText("A private website blocker with a password", pad, 1288);
  }

  DVL.card = Object.freeze({ cardData, draw, W: 1080, H: 1350 });
  if (typeof module !== "undefined" && module.exports) module.exports = DVL.card;
})(typeof globalThis !== "undefined" ? globalThis : this);
