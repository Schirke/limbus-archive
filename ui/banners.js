"use strict";
// Extraction → Banner archive: the timed banners the app has seen, with the game's own pools and chances. The game's
// files describe only the banners of the day, so the app keeps each one it reads and the list grows patch by patch.
// "Pull" opens a banner in Extraction — an ended one too. Data: /api/gacha "archive" (limbusdm/gacha.py).
routes.banners = async () => {
  const main = $("#main");
  main.innerHTML = `<h1>Banner archive</h1><div class="muted">Reading the game's files…</div>`;
  let g;
  try { [g] = await Promise.all([api("/api/gacha"), units()]); } catch (e) { main.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (!location.hash.startsWith("#/banners")) return;
  const list = g.archive || [];
  if (!list.length) { main.innerHTML = `<h1>Banner archive</h1><div class="empty">No banner has been read yet — take a snapshot first.</div>`; return; }
  const name = (id) => { const u = unitById(id); return (u ? (u.title ? `${u.title} ${u.sinnerName}` : `${u.name} · ${u.sinnerName}`) : "").replace(/::\s*/g, ": "); };
  const pc = (b, ...gs) => { const all = b.groups.reduce((s, x) => s + (x.occ.DEFAULT || 0), 0) || 1;
    return (100 * b.groups.filter((x) => gs.includes(x.g)).reduce((s, x) => s + (x.occ.DEFAULT || 0), 0) / all).toFixed(2).replace(/\.?0+$/, "") + "%"; };
  const card = (b) => `<div class="card bncard ${b.open ? "open" : ""}">${b.tile ? `<img src="${imgFull(b.tile)}" loading="lazy" onerror="this.style.visibility='hidden'">` : "<i></i>"}
    <div class="bd"><b>${b.pick.map(name).filter(Boolean).map(esc).join("<br>") || "Banner " + b.id}</b>
      <small>000 ${pc(b, "3", "3_pickup")}${b.groups.some((x) => x.g === "3_pickup") ? ` · featured ${pc(b, "3_pickup")}` : ""} · E.G.O ${pc(b, "EGO", "EGO_pickup")}</small>
      <div class="ft"><span class="${b.open ? "bnlive" : "bnended"}">${b.open ? "OPEN" : "ENDED"}</span><small>${b.end ? (b.open ? "until " : "ended ") + esc(b.end.slice(0, 10)) : ""}</small>
        <button class="primary" data-pull="${b.id}" title="Open this banner in Extraction">Pull</button></div></div></div>`;
  main.innerHTML = `<h1>Banner archive</h1><div class="sub">The banners the app has seen, with the game's own pools and chances. The game describes only the banners of the day, so each new one is kept and the list grows; Pull opens any of them in Extraction — ended ones too.</div>
    <div class="bngrid">${list.map(card).join("")}</div>`;
  main.querySelectorAll("[data-pull]").forEach((el) => (el.onclick = () => { location.hash = "#/gamegacha/" + el.dataset.pull; }));
};
