"use strict";
// "? Guide" next to a page's title: lit until clicked once on that page, then a step-by-step tour of what is on it.
// GUIDE: route (":open" = with an item open, e.g. a report) → [[selector, text], …]; steps whose element isn't there are skipped.
const GUIDE = {
  patches: [
    [".rep", "Every game update gets a report: new Identities, E.G.O, enemies, texts, pictures and sounds. Click one to open it."],
    [".rep .chips", "The counts show what the patch changed. Red = highlights: things the game files hold but the game hasn't shown yet."],
  ],
  "patches:open": [
    [".tabs", "The report's sections: highlights, Identities and E.G.O, texts, pictures, sounds and more."],
    [".filters", "Filter by name or text; show only what was added, changed or removed."],
    ["#sec", "Click a row to see it in full: before and after for changed texts and pictures."],
    ["#nwrep", "The developers' notes for this update, when there are any."],
  ],
  news: [
    [".nwlist", "The developers' notices from Steam, newest first. Click one to read it."],
  ],
  changes: [
    [".hvlist", "Pick an Identity, E.G.O or enemy to see what every patch changed in it."],
    [".hvcols", "Changes go patch by patch, newest first, old and new values side by side."],
  ],
  db: [
    ["#main .tabs", "Identities or E.G.O."],
    ["#dbq", "Search by name, skill, passive or keyword."],
    ["#main .dbrow", "Filter by Sinner, sin, status, faction or season."],
    ["#dbgrid", "Click a card for everything about it: skills at each Uptie, coins, passives, art and voice lines."],
  ],
  enemies: [
    ["#enq", "Search enemies, bosses and Abnormalities by name, faction or keyword."],
    ["#engrid", "Pick one from the list…"],
    ["#encard", "…and see its skills, resistances, passives and how it looks in battle."],
  ],
  buffs: [
    ["#bfq", "Search a buff or debuff by name, effect or who has it."],
    [".bfrow", "Buffs, debuffs or neutral; whose: Identities, E.G.O or enemies."],
    ["#bfgrid", "Pick one to see its text, icon, animation and everyone who has it."],
  ],
  compare: [
    [".cqpicks", "Pick two Identities or E.G.O to put side by side."],
    [".cqctl", "Uptie and level for both; Swap changes sides."],
    [".cqtab", "Their numbers line by line, skills below."],
  ],
  anim: [
    ["#aq", "Search an Identity, E.G.O or enemy."],
    ["#afilters", "Show only Identities, E.G.O or enemies; ★ Mine = the ones you starred."],
    ["#alist", "Pick one: its battle animations play here — move, slow down, save as a video."],
  ],
  sounds: [
    ["#sndq", "Search every sound: names, speakers, words of a voice line."],
    [".sndtiles", "Or open a folder: voices, music, battle sounds."],
  ],
  story: [
    [".sttabs", "The main story or the Identities' own stories; search on the right."],
    [".stcantos", "Pick a chapter, then an episode: it plays as in the game, with music and voices."],
  ],
  stages: [
    ["#stside", "Pick a chapter."],
    ["#stmap", "Its map as the game lays it out. Click a stage…"],
    ["#stcard", "…its enemies wave by wave, the rules and the story around it."],
  ],
  workshop: [
    [".wklines", "The lines of your scene: add, move, delete."],
    [".wkmid", "Who speaks, their face and place, the background and the music."],
    [".wkbar", "Name the scene, play it, share it as a link or a file."],
  ],
  announcers: [
    ["#ncq", "Search an announcer or words of a line."],
    ["#ncgrid", "Pick one…"],
    ["#nccard", "…every line of theirs, with its sound."],
  ],
  abnologs: [
    ["#alq", "Search an Abnormality by name or code."],
    [".alfilters", "Filter by risk level or by the Sinner who wrote the log."],
    [".algrid", "Pick one to read what the Sinners wrote about it."],
  ],
  games: [
    [".gmday", "Today's game and the daily challenge: the same rounds for everyone."],
    [".pfstrip", "Your level, quests and save code are in Profile."],
    [".gmgrpbar", "All the games by kind."],
    ["#gmduel", "Got a duel link or a live room code from a friend? Paste it here."],
  ],
  biggames: [
    [".bgday", "Bigger games made from the game's own sprites and sounds. Press Play."],
  ],
  live: [
    [".gmstart", "Make a room and send its code to friends, or join theirs."],
  ],
  gamegacha: [
    ["#gebox", "Pull on the game's own banners with their real rates, for the lunacy you win in the games."],
    ["#gebelow", "Your pulls so far; Start over resets them."],
  ],
  banners: [
    [".bngrid", "Every banner the app has seen, with its Identities and E.G.O."],
  ],
  versus: [
    ["#vspick", "Pick a fighter: search, filter or take a random one."],
    [".vscards", "The two fighters. Click a card to change it."],
    ["#vsgoslot", "Start the fight: it is drawn as a video with the game's effects."],
    [".vsteamsw", "Team: several fighters on each side."],
  ],
  community: [
    ["#main .dbrow", "Language and platform."],
    [".cmlist", "Who streams Limbus right now. Click one to watch."],
  ],
  teams: [
    [".tcrow", "Have a team in the game? Paste its code here. In the game: Sinners → the two-papers icon → Copy team code."],
    [".tbteam", "Click a Sinner to pick an Identity and E.G.O. The number on a card = the order they deploy in."],
    [".tbstats", "What the team brings: statuses, damage types and sins."],
    [".tbrate", "Sins a turn: whether your E.G.O and passives get enough of each sin."],
    [".tbpanel", "MD gifts that fit this team, and passives that won't switch on."],
    ["#tccopy", "Done? Copy the code and load it in the game: Sinners → the two-papers icon → Load team code."],
  ],
  mirror: [
    [".mpbar .seg", "Pick the mode: Normal or Hard, 5, 10 or 15 floors. The route follows it."],
    [".mpcols > .card:first-child", "Click the gifts you want for your run. Right-click a gift (tap on a phone) for its full card, with its + / ++ upgrades."],
    [".mpstartb", "Starting gift: pick it as in the game. The planner won't look for it on the floors."],
    [".mpcols > .card:nth-child(2)", "Your build: for every gift, the floor and the theme pack where it drops."],
    [".mpcols > div:last-child", "The route: which theme pack to take on each floor. Click a floor to see other packs and pin one."],
  ],
  calc: [
    [".dcyou", "Your Identity or E.G.O, its Uptie and level."],
    ["#dcskbar", "Its skills. Drag one onto a card below to plan the turns."],
    ["#dcrot", "The turns in a row: statuses carry over from one to the next."],
    ["#dcres", "The damage of the chosen skill, coin by coin."],
    [".dcdum", "The target: resistances, statuses, defense."],
    [".dcwhy", "How the number is counted."],
  ],
  growth: [
    [".upgadd", "Add the Identities and E.G.O you want to raise."],
    [".upglist", "For each one: the Uptie and level you want."],
    [".upghave", "What you already have."],
    [".upgside", "Your settings: pass, refills and more."],
    [".upgtiles", "What it takes: threads, shards, experience and how many runs."],
  ],
  sprites: [
    ["#sppage .card", "Pick a frames zip: its frames are laid out as one sheet to edit in any image editor, then packed back."],
    ["#spgrid", "The frames, ready to save."],
  ],
  profile: [
    ["#pfsave", "Your save code: keep it to move your progress to another browser or phone."],
    [".pftop", "Your level and today's quests."],
    ["#pfcard", "Your card: pick its Identity and background."],
    ["#pfalbum", "Everything you have pulled in Extraction."],
  ],
};
// pages without an <h1>: where the button goes
const GUIDE_AT = { anim: ".an-rhead", story: ".sttabs" };

function guideKey() {
  const [, r = "patches", arg] = location.hash.split("/");
  const base = r.split("?")[0];
  return arg && GUIDE[base + ":open"] ? base + ":open" : GUIDE[base] ? base : "";
}
const guideShown = (sel) => { const el = document.querySelector(sel); return !!el && el.getClientRects().length > 0; };  // (a phone tab hides some)
const guideSeen = (k) => { try { return localStorage.getItem("guide_seen_" + k) === "1"; } catch { return false; } };

function guideButton() {
  const k = guideKey();
  if (!k || document.querySelector("#main .gdbtn") || document.getElementById("gdbox")) return;
  if (!GUIDE[k].some(([sel]) => guideShown(sel))) return;
  const at = document.querySelector("#main h1") || document.querySelector(GUIDE_AT[k.split(":")[0]] || "#none");
  if (!at) return;
  at.insertAdjacentHTML("beforeend", `<button class="gdbtn ${guideSeen(k) ? "" : "new"}" title="How this page works"><b>?</b>Guide</button>`);
  at.querySelector(".gdbtn").onclick = (e) => {
    e.preventDefault(); e.stopPropagation();
    try { localStorage.setItem("guide_seen_" + k, "1"); } catch { /* shown again next time */ }
    e.currentTarget.classList.remove("new");
    guideTour(k);
  };
}
new MutationObserver(guideButton).observe(document.getElementById("main"), { childList: true, subtree: true });

function guideTour(k) {
  const steps = GUIDE[k].filter(([sel]) => guideShown(sel));
  if (!steps.length) return;
  let i = 0;
  document.body.insertAdjacentHTML("beforeend", '<div id="gdcatch"></div><div id="gdhole"></div><div id="gdbox" role="dialog"></div>');
  const hole = document.getElementById("gdhole"), box = document.getElementById("gdbox");
  const end = () => { ["gdcatch", "gdhole", "gdbox"].forEach((id) => document.getElementById(id)?.remove()); removeEventListener("keydown", key); removeEventListener("resize", place); removeEventListener("hashchange", end); };
  const key = (e) => { if (e.key === "Escape") end(); else if (e.key === "ArrowRight") go(1); else if (e.key === "ArrowLeft") go(-1); };
  const go = (d) => { i = Math.max(0, i + d); if (i >= steps.length) end(); else show(); };
  const place = () => {
    const el = document.querySelector(steps[i][0]);
    if (!el) return end();
    const b = el.getBoundingClientRect(), pad = 6, top = Math.max(4, b.top - pad), bottom = Math.min(innerHeight - 4, b.bottom + pad);
    Object.assign(hole.style, { left: b.left - pad + "px", top: top + "px", width: b.width + 2 * pad + "px", height: Math.max(20, bottom - top) + "px" });
    const bw = box.offsetWidth, bh = box.offsetHeight;
    let left, y;
    if (innerWidth < 700) { left = (innerWidth - bw) / 2; y = bottom + 12 + bh < innerHeight ? bottom + 12 : Math.max(12, top - bh - 12); }  // (phones: under or over the part)
    else if (b.right + 16 + bw < innerWidth - 12) { left = b.right + 16; y = top; }
    else { left = Math.max(12, Math.min(b.left, innerWidth - bw - 12)); y = bottom + 12 + bh < innerHeight ? bottom + 12 : Math.max(12, top - bh - 12); }
    Object.assign(box.style, { left: left + "px", top: Math.max(12, Math.min(y, innerHeight - bh - 12)) + "px" });
  };
  const show = () => {
    document.querySelector(steps[i][0]).scrollIntoView({ block: "center", behavior: "instant" });
    box.innerHTML = `<div class="gdn">Step ${i + 1} of ${steps.length}</div><p>${esc(steps[i][1])}</p><div class="gdrow"><button data-gd="x">Skip</button><span class="grow"></span>
      ${i ? '<button data-gd="-1">Back</button>' : ""}<button class="primary" data-gd="1">${i === steps.length - 1 ? "Got it" : "Next"}</button></div>`;
    place();
    setTimeout(place, 80);  // (again once the text is translated: the box changes size)
  };
  box.onclick = (e) => { const t = e.target.closest("[data-gd]"); if (t) { if (t.dataset.gd === "x") end(); else go(+t.dataset.gd); } };
  document.getElementById("gdcatch").onclick = end;
  addEventListener("keydown", key);
  addEventListener("resize", place);
  addEventListener("hashchange", end);
  show();
}
