// Profile (prefix pf): level from what the games pay, quests of the day, the album of Extraction, a card, and a save
// code that keeps the games' progress (browser storage) on the server under a random code: no account, nothing personal.
"use strict";

const PF_KEEP = "games_profile";
const pf = { st: { xp: null, used: 0, avatar: 0, code: "", saved: 0, q: null, ...(() => { try { return JSON.parse(localStorage.getItem(PF_KEEP) || "{}"); } catch { return {}; } })() },
  units: null, tab: "ids", pushed: "", busy: false, sure: false };
const pfKeep = () => { try { localStorage.setItem(PF_KEEP, JSON.stringify(pf.st)); } catch {} };
// (the first visit: what was already earned counts)
if (pf.st.xp == null) { pf.st.xp = GM_ACH.filter(([k]) => gmW.ach[k]).reduce((s, a) => s + a[3], 0); pfKeep(); }

// level: the City's ranks, then Color
const PF_RANKS = ["Rat", "Grade 9 Fixer", "Grade 8 Fixer", "Grade 7 Fixer", "Grade 6 Fixer", "Grade 5 Fixer", "Grade 4 Fixer", "Grade 3 Fixer", "Grade 2 Fixer", "Grade 1 Fixer", "Color"];
const pfAt = (l) => 250 * l * (l - 1);  // xp a level starts at
// the frame by rank: grey, bronze, silver, gold, red; a Color takes the colour of the card's Sinner
const PF_FRAME = ["#6d6359", "#a86b3c", "#a86b3c", "#a86b3c", "#b9c0c8", "#b9c0c8", "#b9c0c8", "#c9a227", "#c9a227", "#e0503a"];
const PF_RANKUP = 1300;  // lunacy for a new rank: a ten-pull
function pfLevel(xp = pf.st.xp) {
  let l = 1;
  while (pfAt(l + 1) <= xp) l++;
  return { l, rank: PF_RANKS[Math.min(l, PF_RANKS.length) - 1], from: pfAt(l), to: pfAt(l + 1) };
}
// a Color names itself: "The <colour> <thing>", from two fixed lists
const PF_EPI = [["Red", "Blue", "Purple", "Black", "Amber", "Crimson", "Azure", "Violet", "Silver", "Golden", "Scarlet", "Ivory", "Jade", "Ashen", "Pale", "Iron"],
  ["Mist", "Pupil", "Tear", "Fang", "Blade", "Flame", "Gale", "Thorn", "Shadow", "Lantern", "Hound", "Dawn", "Silence", "Wake", "Bell", "Spear"]];
const pfTitle = (lv = pfLevel()) => lv.l >= PF_RANKS.length && pf.st.epi ? `The ${PF_EPI[0][pf.st.epi[0]]} ${PF_EPI[1][pf.st.epi[1]]}` : lv.rank;
// card backgrounds, opened by rank: [name, from level, colour at the top]
const PF_BACK = [["Plain", 1, "#0f0c0d"], ["Backstreets", 2, "#2a2420"], ["Workshop", 4, "#3a2412"], ["Association", 5, "#2a3036"], ["Wing", 8, "#3d3210"], ["Grade 1", 10, "#4a1410"], ["Color", 11, ""]];
const pfBack = (l = pfLevel().l) => { const b = PF_BACK[pf.st.back || 0]; return !b || b[1] > l ? PF_BACK[0] : b; };
const pfBackTop = (b, l) => b[2] || pfFrame(l) + "55";
function pfFrame(l = pfLevel().l) {
  if (l <= PF_FRAME.length) return PF_FRAME[l - 1];
  return GA_SINNER[pf.st.faceS - 1] || "#ffffff";
}

// quests: three a day from the list, the same for everybody that day
const PF_QUESTS = [["daily1", "Play a Daily challenge", 1, 100], ["daily3", "Finish 3 Daily challenges", 3, 200], ["play5", "Finish 5 games", 5, 150],
  ["ear", "Finish 2 games By ear", 2, 120], ["eye", "Finish 2 games By eye", 2, 120], ["puz", "Finish 2 Puzzles", 2, 120],
  ["grade", "Get “Limbus enjoyer” or better", 1, 150], ["top", "Get “Dantehhh”", 1, 250], ["pull", "Extract 10 times", 10, 100]];
const PF_Q4 = 6;  // the level of a fourth quest
function pfQuests() {
  const day = gmDay() + (pf.st.qs || ""), want = pfLevel().l >= PF_Q4 ? 4 : 3;
  if (!pf.st.q || pf.st.q.day !== day) { pf.st.q = { day, n: {}, paid: {} }; pfKeep(); }
  if (Object.keys(pf.st.q.n).length < want) {
    const rnd = gmSeed("quests" + day);
    for (const k of PF_QUESTS.map((q) => [rnd(), q[0]]).sort((a, b) => a[0] - b[0]).map((x) => x[1])) if (Object.keys(pf.st.q.n).length < want && !(k in pf.st.q.n)) pf.st.q.n[k] = 0;
    pfKeep();
  }
  return Object.keys(pf.st.q.n).map((k) => { const [, name, need, pay] = PF_QUESTS.find((q) => q[0] === k); return { k, name, need, pay, n: Math.min(need, pf.st.q.n[k]) }; });
}
// steps a finished game makes; finished quests are paid with the game
function pfStep(keys, got) {
  for (const q of pfQuests()) {
    if (!keys.includes(q.k) || q.n >= q.need) continue;
    pf.st.q.n[q.k]++;
    const n = q.n + 1;
    if (n >= q.need && !pf.st.q.paid[q.k]) { pf.st.q.paid[q.k] = 1; got.push([q.pay, `Quest done: ${q.name}`]); }
    else got.push([0, `Quest ${n}/${q.need}: ${q.name}`]);
  }
  pfKeep();
}

// the end of a game: quest steps join its pay; everything paid is xp too
const pfOver = gmOver;
let pfGame = null;
gmOver = function (game, g, score) { pfGame = g.paid ? null : [game, g]; try { pfOver(game, g, score); } finally { pfGame = null; } };
const pfPay = gmPay;
gmPay = function (got, ach = []) {
  const notes = [];
  if (pfGame) {
    const [game, g] = pfGame, grp = (GM_GROUPS.find(([, keys]) => keys.includes(game)) || [""])[0], keys = ["play5"];
    if (g.daily && !g.duel) keys.push("daily1", "daily3");
    if (grp === "By ear") keys.push("ear");
    if (grp === "By eye") keys.push("eye");
    if (grp === "Puzzles") keys.push("puz");
    if (g.grade && g.grade.tier >= 2) keys.push("grade");
    if (g.grade && g.grade.tier >= 3) keys.push("top");
    const steps = [];
    pfStep(keys, steps);
    got.push(...steps.filter(([n]) => n > 0));
    notes.push(...steps.filter(([n]) => !n).map(([, t]) => t));
  }
  const n0 = gmW.lunacy;
  pfPay(got, ach);
  const earned = gmW.lunacy - n0;
  if (earned > 0) pfXp(earned, notes, false);
  pfChip();
  pfSoon();
};
// xp gained: a new rank pays a ten-pull; told in the open toast (or a new one)
function pfXp(n, notes = [], own = true) {
  const before = pfLevel().l;
  pf.st.xp = Math.max(0, pf.st.xp + n);
  pfKeep();
  const lv = pfLevel(), up = lv.l - before;
  if (up > 0) { gmW.lunacy += PF_RANKUP * up; gmWKeep(); }
  const html = `<div class="pftoast">${notes.map((t) => `<div>${esc(t)}</div>`).join("")}<div><b>${n >= 0 ? "+" : ""}${n.toLocaleString("en")}</b> XP · LV ${lv.l} · <a href="#/profile">Profile</a></div>${up > 0 ? `<div class="pfup">New rank: <b>${esc(lv.rank)}</b> · +${PF_RANKUP * up} lunacy</div>` : ""}</div>`;
  const box = $("#toast");
  if (!own && box && !box.classList.contains("hidden")) box.insertAdjacentHTML("beforeend", html); else toast(html, 6000);
  pfChip();
  pfSoon();
}
// a pull is a quest step too
const pfGot = gaGot;
gaGot = function (id) { const r = pfGot(id); pfStep(["pull"], []); pfSoon(); return r; };

// ------------------------------------------------------------------ the album
const PF_DUP = { r1: 1, r2: 10, r3: 50, ego: 50 }, PF_COST = { r1: 10, r2: 40, r3: 100, ego: 100 };
const pfGacha = () => { if (ga.st) return ga.st; try { return { ...gaNew(), ...JSON.parse(localStorage.getItem(GA_KEEP) || "{}") }; } catch { return gaNew(); } };
async function pfUnits() {
  if (pf.units) return pf.units;
  const u = await api("/api/units").catch(() => null), all = new Map(), sinners = [];
  for (const x of (u || {}).ids || []) if (x.img && x.img.thumb) {
    all.set(x.id, { id: x.id, title: x.title, who: x.sinnerName, sinner: x.sinner, kind: "r" + x.rank, thumb: giThumb(x.img.thumb), art: gaFull(x.img.art2 || x.img.art),
      art1: gaFull(x.img.art), ...(x.img.art2 && x.img.art2 !== x.img.art ? { art3: gaFull(x.img.art2), thumb3: giThumb(x.img.art2) } : {}) });
    sinners[x.sinner - 1] = x.sinnerName;
  }
  for (const e of (u || {}).egos || []) if (e.img && e.img.thumb)
    all.set(e.id, { id: e.id, title: e.name, who: e.sinnerName, sinner: e.sinner, kind: "ego", grade: e.grade, thumb: giThumb(e.img.thumb), art: gaFull(e.img.art) });
  return (pf.units = { all, sinners });
}
// the card's art: before Uptie III or after it (the choice kept; an Identity without a second art has one)
const pfLook = (f) => { const up = pf.st.up !== false && f.art3; return { art: up ? f.art3 : f.art1 || f.art, thumb: up ? f.thumb3 : f.thumb }; };
const pfShards = () => Object.entries(pfGacha().got || {}).reduce((s, [id, n]) => s + (n - 1) * (PF_DUP[(pf.units.all.get(+id) || {}).kind] || 0), 0) - pf.st.used;
function pfAlbum() {
  const got = pfGacha().got || {}, U = [...pf.units.all.values()], ego = pf.tab === "ego", list = U.filter((x) => (x.kind === "ego") === ego);
  const own = list.filter((x) => got[x.id]).length, shards = pfShards();
  const rows = pf.units.sinners.map((name, i) => {
    const mine = list.filter((x) => x.sinner === i + 1).sort((a, b) => (got[b.id] ? 1 : 0) - (got[a.id] ? 1 : 0) || a.id - b.id);
    if (!mine.length) return "";
    return `<div class="pfrow"><div class="pfwho" style="--c:${GA_SINNER[i]}">${esc(name)}<small>${mine.filter((x) => got[x.id]).length} / ${mine.length}</small></div><div class="pfslots">${mine.map((x) => {
      const n = got[x.id] || 0;
      return `<button class="pfslot ${n ? "own" : ""} ${x.kind}" data-id="${x.id}" title="${esc(x.title + " — " + x.who)}${n ? (n > 1 ? ` · ×${n}` : "") : ` · not yet · ${PF_COST[x.kind]} Egoshards`}"><img loading="lazy" src="${x.thumb}" alt="">${n > 1 ? `<i>×${n}</i>` : ""}</button>`; }).join("")}</div></div>`; }).join("");
  $("#pfalbum").innerHTML = `<div class="pfhead"><span class="pflbl">Collection</span>
      <div class="pftabs">${[["ids", "Identities", U.filter((x) => x.kind !== "ego")], ["ego", "E.G.O", U.filter((x) => x.kind === "ego")]].map(([k, t, xs]) => `<button class="toggle ${pf.tab === k ? "on" : ""}" data-tab="${k}">${t} ${xs.filter((x) => got[x.id]).length}/${xs.length}</button>`).join("")}</div></div>
    <div class="pfshard"><b>${shards}</b><span>Egoshards from duplicates · a missing one costs ${ego ? PF_COST.ego : `${PF_COST.r3} (000) · ${PF_COST.r2} (00)`} — click it</span><a class="toggle" href="#/gamegacha">Extraction</a></div>
    <div class="pfrows">${rows}</div><div class="sub">${own} of ${list.length} · the art comes from your pulls in Extraction</div>`;
  document.querySelectorAll("#pfalbum [data-tab]").forEach((b) => b.onclick = () => { pf.tab = b.dataset.tab; pfAlbum(); });
  document.querySelectorAll("#pfalbum .pfslot").forEach((b) => b.onclick = () => pfSlot(+b.dataset.id));
}
// owned: make it the card's picture; missing: get it for Egoshards (asked on the button itself)
function pfSlot(id) {
  const x = pf.units.all.get(id), got = pfGacha().got || {};
  if (got[id]) { if (x.kind !== "ego") { pf.st.avatar = id; pfKeep(); pfSoon(); pfDraw(); toast(`${esc(x.title)} is on your card now.`); } return; }
  const cost = PF_COST[x.kind], el = document.querySelector(`.pfslot[data-id="${id}"]`);
  if (pfShards() < cost) return toast(`${esc(x.title)} costs ${cost} Egoshards — you have ${pfShards()}. Duplicates from Extraction give them.`);
  if (!el.classList.contains("ask")) { document.querySelectorAll(".pfslot.ask").forEach((s) => s.classList.remove("ask")); el.classList.add("ask"); return toast(`Click it again to get <b>${esc(x.title)}</b> for ${cost} Egoshards.`); }
  const st = pfGacha();
  st.got = { ...(st.got || {}), [id]: 1 };
  if (ga.st) gaKeep(); else try { localStorage.setItem(GA_KEEP, JSON.stringify(st)); } catch {}
  pf.st.used += cost;
  pfKeep();
  pfSoon();
  toast(`<b>${esc(x.title)}</b> joins your collection.`);
  pfAlbum();
  pfCardDraw();
}

// ------------------------------------------------------------------ the card
function pfCardData() {
  const got = pfGacha().got || {}, ids = [...pf.units.all.values()].filter((x) => x.kind !== "ego" && got[x.id]);
  const face = pf.units.all.get(pf.st.avatar) && got[pf.st.avatar] ? pf.units.all.get(pf.st.avatar) : ids.find((x) => x.kind === "r3") || ids[0];
  const ach = GM_ACH.filter(([k]) => gmW.ach[k]).sort((a, b) => String(gmW.ach[b[0]]).localeCompare(String(gmW.ach[a[0]])));
  // (the top bar shows the face without reading every unit)
  if (face && (pf.st.face !== pfLook(face).thumb || pf.st.faceS !== face.sinner)) { pf.st.face = pfLook(face).thumb; pf.st.faceS = face.sinner; pfKeep(); pfChip(); }
  return { face, ids: ids.length, all: [...pf.units.all.values()].filter((x) => x.kind !== "ego").length, ach, lv: pfLevel() };
}
function pfCardDraw() {
  const c = pfCardData();
  const back = pfBack(c.lv.l), title = pfTitle(c.lv);
  $("#pfcard").innerHTML = `<div class="pfcard" style="border-color:${pfFrame(c.lv.l)};--back:${pfBackTop(back, c.lv.l)}"><div class="pfbn" style="${c.face ? `background-image:url('${pfLook(c.face).art}')` : ""}"></div><div class="pfin">
      <div class="pfrank">${esc(title)}</div><div class="pfsub">${title !== c.lv.rank ? "Color · " : ""}LV ${c.lv.l}${c.face ? ` · ${esc(c.face.title)}` : ""}</div>
      <div class="pfnums"><div><b>${c.ids}</b><span>Identities</span></div><div><b>${c.ach.length}</b><span>Achievements</span></div><div><b>${gmW.streak || 0}</b><span>Streak</span></div></div>
      <div class="pfbadges">${c.ach.slice(0, 3).map(([, name]) => `<span>${esc(name)}</span>`).join("") || `<span class="none">No achievements yet</span>`}</div>
      <div class="pfsite">limbus-archive.com</div></div></div>
    ${c.face && c.face.art3 ? `<div class="pfbacks"><span class="sub">Art</span>${[[false, "Uptie I–II"], [true, "Uptie III"]].map(([up, t]) => `<button class="pfbk ${(pf.st.up !== false) === up ? "on" : ""}" data-up="${up ? 1 : 0}">${t}</button>`).join("")}</div>` : ""}
    <div class="pfbacks">${PF_BACK.map(([name, from], i) => { const open = c.lv.l >= from; return `<button class="pfbk ${back === PF_BACK[i] ? "on" : ""}" data-bk="${i}" ${open ? "" : "disabled"} style="--b:${pfBackTop(PF_BACK[i], c.lv.l)}" title="${esc(name)}${open ? "" : " · opens at " + esc(PF_RANKS[from - 1])}"><i></i>${esc(name)}${open ? "" : `<small>${esc(PF_RANKS[from - 1].replace(" Fixer", ""))}</small>`}</button>`; }).join("")}</div>
    ${c.lv.l >= PF_RANKS.length ? `<div class="pfepi"><span class="sub">Your name as a Color:</span> The <select id="pfepi0"><option value="" disabled ${pf.st.epi ? "" : "selected"}>pick</option>${PF_EPI[0].map((w, i) => `<option value="${i}" ${pf.st.epi && pf.st.epi[0] === i ? "selected" : ""}>${w}</option>`).join("")}</select>
      <select id="pfepi1"><option value="" disabled ${pf.st.epi ? "" : "selected"}>pick</option>${PF_EPI[1].map((w, i) => `<option value="${i}" ${pf.st.epi && pf.st.epi[1] === i ? "selected" : ""}>${w}</option>`).join("")}</select></div>` : ""}
    <div class="pfbtns"><span class="sub">Click an Identity you own in the album to put it here.</span><button class="primary" id="pfpng">Save picture</button></div>`;
  $("#pfpng").onclick = () => pfPng(c);
  document.querySelectorAll("#pfcard [data-up]").forEach((b) => b.onclick = () => { pf.st.up = b.dataset.up === "1"; pfKeep(); pfSoon(); pfCardDraw(); });
  document.querySelectorAll("#pfcard [data-bk]").forEach((b) => b.onclick = () => { pf.st.back = +b.dataset.bk; pfKeep(); pfSoon(); pfCardDraw(); });
  const epi = () => { if ($("#pfepi0").value === "" || $("#pfepi1").value === "") return; pf.st.epi = [+$("#pfepi0").value, +$("#pfepi1").value]; pfKeep(); pfSoon(); pfCardDraw(); pfChip(); };
  if ($("#pfepi0")) { $("#pfepi0").onchange = epi; $("#pfepi1").onchange = epi; }
}
// the card as a PNG, drawn on a canvas
async function pfPng(c) {
  const W = 900, H = 500, cv = document.createElement("canvas"), x = cv.getContext("2d");
  cv.width = W; cv.height = H;
  const bg = x.createLinearGradient(0, 260, 0, H); bg.addColorStop(0, pfBackTop(pfBack(c.lv.l), c.lv.l)); bg.addColorStop(1, "#0f0c0d");
  x.fillStyle = "#0f0c0d"; x.fillRect(0, 0, W, H); x.fillStyle = bg; x.fillRect(0, 260, W, H - 260);
  if (c.face) {
    const im = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = pfLook(c.face).art; });
    if (im) {  // (the art only above the text, faded out at its foot)
      const k = Math.max(W / im.width, 300 / im.height);
      x.save(); x.beginPath(); x.rect(0, 0, W, 300); x.clip();
      x.drawImage(im, (W - im.width * k) / 2, (300 - im.height * k) / 3, im.width * k, im.height * k);
      x.restore();
    }
  }
  const fade = x.createLinearGradient(0, 170, 0, 300); fade.addColorStop(0, "rgba(15,12,13,0)"); fade.addColorStop(1, "#0f0c0d");
  x.fillStyle = fade; x.fillRect(0, 0, W, 301);
  x.strokeStyle = pfFrame(c.lv.l); x.lineWidth = 4; x.strokeRect(2, 2, W - 4, H - 4);
  await document.fonts.load('40px "LC Bebas"').catch(() => {});
  x.fillStyle = "#fff"; x.font = '56px "LC Bebas", "Segoe UI", sans-serif'; x.fillText(pfTitle(c.lv).toUpperCase(), 32, 330);
  x.fillStyle = "#f3d77a"; x.font = '20px "Segoe UI", sans-serif'; x.fillText(`${pfTitle(c.lv) !== c.lv.rank ? "Color · " : ""}LV ${c.lv.l}${c.face ? " · " + c.face.title : ""}`, 34, 362);
  [[c.ids, "IDENTITIES"], [c.ach.length, "ACHIEVEMENTS"], [gmW.streak || 0, "DAY STREAK"]].forEach(([n, t], i) => {
    const bx = 32 + i * 200;
    x.fillStyle = "#231e21"; x.fillRect(bx, 386, 186, 74);
    x.fillStyle = "#fff"; x.font = '38px "LC Bebas", "Segoe UI", sans-serif'; x.fillText(String(n), bx + 14, 428);
    x.fillStyle = "#9d9189"; x.font = '13px "Segoe UI", sans-serif'; x.fillText(t, bx + 14, 450);
  });
  x.fillStyle = "#9d9189"; x.font = '16px "Segoe UI", sans-serif'; x.textAlign = "right"; x.fillText("limbus-archive.com", W - 30, H - 26);
  const a = document.createElement("a");
  a.href = cv.toDataURL("image/png"); a.download = "limbus-archive-card.png"; a.click();
}

// ------------------------------------------------------------------ the save code
// What goes under the code: the games' own storage, and nothing else (live rooms left out).
const pfMine = (k) => k.startsWith("games") && !k.startsWith("games_live");
function pfSave() {
  const out = {};
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (pfMine(k)) out[k] = localStorage.getItem(k); } } catch {}
  return out;
}
// what changed is sent a few seconds later; the first progress makes the code
let pfTimer = 0;
function pfSoon() { clearTimeout(pfTimer); pfTimer = setTimeout(pfPush, 4000); }
async function pfPush(force) {
  if (pf.busy) return;
  const data = pfSave(), text = JSON.stringify(Object.entries(data).filter(([k]) => k !== PF_KEEP).sort());
  if (!force && text === pf.pushed) return;
  pf.busy = true;
  try {
    if (!pf.st.code) navigator.storage?.persist?.().catch(() => {});
    const r = await api("/api/pfsave", { code: pf.st.code || "", data });
    pf.pushed = text;
    pf.st.code = r.code; pf.st.saved = Date.now();
    pfKeep();
    if (location.hash.startsWith("#/profile")) pfSaveDraw();
  } catch { /* offline: next time */ } finally { pf.busy = false; }
}
document.addEventListener("visibilitychange", () => { if (document.hidden) pfPush(); });
setTimeout(() => pfPush(), 3000);

const pfAgo = (t) => { const s = (Date.now() - t) / 1000; return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toISOString().slice(0, 10); };
async function pfSaveDraw() {
  const kept = await navigator.storage?.persisted?.().catch(() => false);
  $("#pfsave").innerHTML = `<div><span class="pflbl">Your save code</span>
      <span class="pfcode">${pf.st.code ? esc(pf.st.code) : "—"}</span>
      <span class="sub">${pf.st.code ? "The code holds your games' progress and nothing else. Anyone with it can load it, so keep it to yourself." : "The code appears after your first game."}</span>
      ${pf.st.saved ? `<div class="pfok"><i></i>Saved ${pfAgo(pf.st.saved)}</div>` : ""}
      <div class="pfok ${kept ? "" : "warn"}"><i></i>${kept ? "This browser is asked to keep your progress" : "This browser may still clear it on its own — keep the code"}</div>
      <div class="pfbtns"><button class="primary" id="pfcopy" ${pf.st.code ? "" : "disabled"}>Copy code</button><button id="pfnew" title="Your progress moves to a fresh code; the old one stops working">New code</button></div></div>
    <div><span class="pflbl">Load progress</span>
      <span class="sub">New phone, cleared browser, or playing on PC too? Enter your code — the collection, lunacy, level and achievements come back.</span>
      <div class="pfin2"><input id="pfcodein" placeholder="XXXX-XXXX" maxlength="9" autocomplete="off" spellcheck="false"><button class="primary" id="pfload">Load</button></div>
      <span class="sub" id="pfloadmsg">Loading replaces what this browser has now.</span></div>`;
  $("#pfcopy").onclick = () => navigator.clipboard.writeText(pf.st.code).then(() => toast("Code copied."), () => toast("Copy it by hand: " + esc(pf.st.code)));
  $("#pfnew").onclick = async () => { pf.st.code = ""; pfKeep(); await pfPush(true); toast(`Your new code: <b>${esc(pf.st.code)}</b>`); };
  $("#pfcodein").oninput = (e) => { let v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8); if (v.length > 4) v = v.slice(0, 4) + "-" + v.slice(4); e.target.value = v; pf.sure = false; $("#pfload").textContent = "Load"; };
  $("#pfload").onclick = pfLoad;
}
async function pfLoad() {
  const code = $("#pfcodein").value.trim(), msg = $("#pfloadmsg");
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) { msg.textContent = "A code looks like K7QM-2XRP."; return; }
  if (code === pf.st.code) { msg.textContent = "That is this browser's own code."; return; }
  let r;
  try { r = await api("/api/pfsave?code=" + code); } catch { msg.textContent = "No progress under that code. Check the letters."; return; }
  if (!pf.sure) {
    const w = JSON.parse(r.data.games_wallet || "{}"), g = JSON.parse(r.data.games_gacha || "{}");
    msg.innerHTML = `Found: <b>${(w.lunacy || 0).toLocaleString("en")}</b> lunacy, <b>${Object.keys(g.got || {}).length}</b> extracted, saved ${pfAgo(r.at)}. Click <b>Replace</b> to load it here.`;
    pf.sure = true; $("#pfload").textContent = "Replace";
    return;
  }
  try {
    for (const k of Object.keys(pfSave())) localStorage.removeItem(k);
    for (const [k, v] of Object.entries(r.data)) if (pfMine(k)) localStorage.setItem(k, v);
    const p = JSON.parse(localStorage.getItem(PF_KEEP) || "{}");
    p.code = code; p.saved = r.at;
    localStorage.setItem(PF_KEEP, JSON.stringify(p));
  } catch { msg.textContent = "This browser refused to store it (private window?)."; return; }
  location.hash = "#/profile";
  location.reload();
}

// ------------------------------------------------------------------ the page and the hub's strip
function pfStrip() {
  const lv = pfLevel(), qs = pfQuests(), done = qs.filter((q) => q.n >= q.need).length;
  return `<a class="pfstrip" href="#/profile"><span class="pfava" style="border-color:${pfFrame(lv.l)};${pf.st.face ? `background-image:url('${pf.st.face}')` : ""}"></span>
    <span class="pflv"><b>LV ${lv.l} · ${esc(pfTitle(lv))}</b><small>${(pf.st.xp - lv.from).toLocaleString("en")} / ${(lv.to - lv.from).toLocaleString("en")} XP</small><span class="pfbar"><i style="width:${Math.round(100 * (pf.st.xp - lv.from) / (lv.to - lv.from))}%"></i></span></span>
    <span class="pfqs">${qs.map((q) => `<span class="${q.n >= q.need ? "done" : ""}" title="${esc(q.name)} · +${q.pay} lunacy">${esc(q.name)} <i>${q.n}/${q.need}</i></span>`).join("")}</span>
    <span class="pfgo">Quests ${done}/${qs.length} · Profile →</span></a>`;
}
// the top bar: the card's face and rank, next to the lunacy (on a phone the face only)
function pfChip() {
  let el = $("#pfchip");
  if (!el) { el = document.createElement("a"); el.id = "pfchip"; el.href = "#/profile"; $("#hstack")?.before(el); }
  const lv = pfLevel();
  el.title = `${pfTitle(lv)} · LV ${lv.l} — your profile`;
  el.innerHTML = `<span class="pfava" style="border-color:${pfFrame(lv.l)};${pf.st.face ? `background-image:url('${pf.st.face}')` : ""}"></span><span class="pfct"><b>${esc(pfTitle(lv))}</b><small>LV ${lv.l}</small></span>`;
}
pfChip();
const pfHub = gmHub;
gmHub = function () { pfHub(); $(".gmhubhead")?.insertAdjacentHTML("afterend", pfStrip()); };

function pfDraw() {
  const lv = pfLevel(), qs = pfQuests();
  $("#main").innerHTML = `<h1>Profile</h1>
    <div class="pfpriv"><b>No account. Nothing about you.</b>
      <p>We don't ask for a name, an email or a login, and we don't want them. Your progress lives in your own browser — so it's yours, not ours. The flip side: browsers sometimes wipe it.</p>
      <ul><li>iPhone / Safari clears it after 7 days away from the site</li><li>clearing browser data, private windows, another device</li></ul>
      <p>Keep your save code below and nothing is lost.</p></div>
    <div class="pfsave" id="pfsave"></div>
    <div class="pftest"><b>TEST · not for release</b>${[["xp1", "+1,000 XP"], ["up", "Next rank"], ["down", "Rank down"], ["color", "Color"], ["rat", "Back to Rat"],
      ["lun", "+1,300 lunacy"], ["shard", "+100 Egoshards"], ["quests", "Finish quests"], ["newq", "New quests"]].map(([k, t]) => `<button data-test="${k}">${t}</button>`).join("")}</div>
    <div class="pftop"><div><span class="pflbl">LV ${lv.l} · ${esc(pfTitle(lv))}</span>
        <div class="pfbar big"><i style="width:${Math.round(100 * (pf.st.xp - lv.from) / (lv.to - lv.from))}%"></i></div>
        <span class="sub">${(pf.st.xp - lv.from).toLocaleString("en")} / ${(lv.to - lv.from).toLocaleString("en")} XP to ${esc(pfLevel(lv.to).rank)} · every lunacy the games pay is XP too</span>
        <span class="pflbl" style="margin-top:14px">Today's quests</span>
        <div class="pfquests">${qs.map((q) => `<div class="${q.n >= q.need ? "done" : ""}"><span>${esc(q.name)}</span><i>${q.n >= q.need ? "Done" : `${q.n}/${q.need}`}</i><div class="pfbar"><i style="width:${100 * q.n / q.need}%"></i></div><small>+${q.pay} lunacy</small></div>`).join("")}</div>
        <span class="sub">New quests with the Daily challenge${lv.l < PF_Q4 ? ` · a fourth one from ${esc(PF_RANKS[PF_Q4 - 1])}` : ""}.</span></div>
      <div id="pfcard"><div class="sub">Reading…</div></div></div>
    <div id="pfalbum" class="pfalbum"><div class="sub">Reading the collection…</div></div>
    <div class="gmgrp gmachhead">Achievements <small>${GM_ACH.filter(([k]) => gmW.ach[k]).length} / ${GM_ACH.length}</small></div>
    <div class="gmach">${GM_ACH.map(([k, name, what, n]) => `<span class="${gmW.ach[k] ? "done" : ""}" title="${esc(what)}"><b>${esc(name)}</b><small>${esc(what)}</small><i>${gmW.ach[k] ? "✓" : "+" + n}</i></span>`).join("")}</div>`;
  document.querySelectorAll("[data-test]").forEach((b) => b.onclick = () => { pfTest(b.dataset.test); pfDraw(); });
  pfSaveDraw();
  pfUnits().then(() => { if (!location.hash.startsWith("#/profile")) return; pfCardDraw(); pfAlbum(); });
}
// TEMPORARY test buttons
function pfTest(k) {
  const lv = pfLevel();
  if (k === "xp1") pfXp(1000);
  if (k === "up") pfXp(lv.to - pf.st.xp);
  if (k === "down") pfXp(pfAt(Math.max(1, lv.l - 1)) - pf.st.xp);
  if (k === "color") pfXp(pfAt(PF_RANKS.length) - pf.st.xp);
  if (k === "rat") { pf.st.xp = 0; pf.st.back = 0; pfKeep(); pfChip(); }
  if (k === "lun") { gmW.lunacy += 1300; gmWKeep(); }
  if (k === "shard") { pf.st.used -= 100; pfKeep(); }
  if (k === "quests") { const got = []; for (const q of pfQuests()) { pf.st.q.n[q.k] = q.need; if (!pf.st.q.paid[q.k]) { pf.st.q.paid[q.k] = 1; got.push([q.pay, "Quest done: " + q.name]); } } pfKeep(); if (got.length) gmPay(got); }
  if (k === "newq") { pf.st.qs = Math.random().toString(36).slice(2, 6); pf.st.q = null; pfKeep(); }
  pfSoon();
}
routes.profile = () => { gmStop(); pfDraw(); };

// ------------------------------------------------------------------ Live rooms: everybody's rank by the name
// (the room only knows names: each player says its rank as a message when somebody comes in)
const pfLive = {}, pfGlGot = glGot;
let pfLiveWho = "";
const pfMineLive = () => { const lv = pfLevel(); return { l: lv.l, e: lv.l >= PF_RANKS.length && pf.st.epi ? pf.st.epi : null, s: pf.st.faceS || 0, f: pf.st.face || "" }; };
glGot = function (m) {
  const d = m && m.data;
  if (m && m.t === "msg" && d && d.pf && typeof d.pf === "object") {
    const p = d.pf, l = Math.max(1, Math.min(99, +p.l || 1)), e = Array.isArray(p.e) && PF_EPI[0][p.e[0]] && PF_EPI[1][p.e[1]] ? [+p.e[0], +p.e[1]] : null;
    pfLive[m.from] = { l, e, s: +p.s || 0, f: typeof p.f === "string" && p.f.startsWith("/api/asset_thumb?path=") && p.f.length < 400 ? p.f : "" };
    if (gl.match) glPanel(); else if (location.hash.startsWith("#/live/")) glLobby();
    return;
  }
  if (m && m.t === "room") {
    const who = (m.players || []).map((p) => p.id).sort().join(",");
    if (who !== pfLiveWho) { pfLiveWho = who; setTimeout(() => glSay({ pf: pfMineLive() }), 300); }
  }
  return pfGlGot(m);
};
// the face (or the level) in the rank's frame, the name, the rank under it
const pfGlWho = glWho;
glWho = function (id, name) {
  const r = id === gl.id ? pfMineLive() : pfLive[id];
  if (!r) return pfGlWho(id, name);
  const rank = r.l >= PF_RANKS.length && r.e ? `The ${PF_EPI[0][r.e[0]]} ${PF_EPI[1][r.e[1]]}` : PF_RANKS[Math.min(r.l, PF_RANKS.length) - 1];
  const frame = r.l <= PF_FRAME.length ? PF_FRAME[r.l - 1] : GA_SINNER[r.s - 1] || "#ffffff";
  return `<span class="glwho" title="${esc(rank)} · LV ${r.l}"><span class="pfava" style="border-color:${frame};${r.f ? `background-image:url('${esc(r.f)}')` : ""}">${r.f ? "" : r.l}</span><span class="glnm">${esc(name)}<small>${esc(rank)}</small></span></span>`;
};
