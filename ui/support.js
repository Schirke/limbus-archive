// Support page: who made it and who translated the game's texts (the language list), how to help, credits.
"use strict";

const SUP = {
  repo: "https://github.com/Schirke/limbus-archive",
  site: "https://limbus-archive.com",
  discord: "hines9278",
  // [name, address, note]; hidden while empty
  money: [],
  // [name, GitHub login, what they did]
  team: [
    ["Schirke", "Schirke", "the app and the site"],
    ["shpepofficial-art", "shpepofficial-art", "Versus and Versus Live, skill effects"],
  ],
  // people who sent money: [tier, [names]]
  backers: [],
};

// the players' translation teams, as the language menu lists them
async function supTranslators() {
  const box = $("#suptr");
  if (!box) return;
  const list = (await langList()).filter((l) => l.link || (l.authors || []).length);
  if (!$("#suptr")) return;
  if (!list.length) { box.closest(".supby").remove(); return; }
  const mark = (l) => typeof langMark === "function" ? langMark(l.id) : "";
  list.sort((a, b) => ["edited", "human"].indexOf(mark(b)) - ["edited", "human"].indexOf(mark(a)));
  box.innerHTML = list.map((l) => `<div class="suptrow"><span class="lg">${esc(l.label)}</span>
    <span class="nm"><b>${mark(l) === "human" ? `<span class="langstar">★</span> ` : ""}${esc(l.name)}</b>${mark(l) === "human" ? `<span class="langhuman" title="Translated by people, without AI tools">Made without AI</span>`
      : mark(l) === "edited" ? `<span class="langhuman ed" title="A machine translation checked and corrected by people">AI, edited by hand</span>` : ""}</span>
    ${l.link ? `<a class="small" href="${esc(l.link)}" target="_blank" rel="noopener">their page ↗</a>` : "<span></span>"}
    <span class="by">${(l.authors || []).map(esc).join(", ")}</span></div>`).join("");
}
routes.support = () => {
  const out = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${text}</a>`;
  const web = document.body.classList.contains("site");
  const ways = [
    ["Free", "Tell people", "",
      out(SUP.repo, "Star on GitHub ↗") + (web ? out(SUP.repo + "/releases/latest", "Desktop app ↗") : out(SUP.site, "The website ↗"))],
    ["Feedback", "Report and suggest", `<p>Discord: <b class="supcopy" title="Copy">${esc(SUP.discord)}</b></p>`,
      out(SUP.repo + "/issues/new", "Report a bug ↗") + out(SUP.repo + "/issues", "Open issues ↗")],
    ["Code", "Join in", "",
      out(SUP.repo, "Source code ↗") + out(SUP.repo + "/pulls", "Pull requests ↗")],
  ];
  if (SUP.money.length) ways.push(["Money", "Chip in", `<p>Hosting and time cost something. Any amount helps and nothing is locked behind it.</p>
      ${SUP.money.filter((m) => m[2]).map((m) => `<p class="muted small">${esc(m[0])}: ${esc(m[2])}</p>`).join("")}`,
    SUP.money.map((m) => out(m[1], esc(m[0]) + " ↗")).join("")]);
  $("#main").innerHTML = `<div class="suppage"><h1>Support</h1>
    <div class="sub">Limbus Archive is a free fan project made in spare time — by these people.</div>
    <div class="suptwo"><div><h2>Made by</h2>
      <div class="supteam">${SUP.team.map(([name, login, what]) => `<a class="supman" href="https://github.com/${esc(login)}" target="_blank" rel="noopener">
        <img loading="lazy" src="https://github.com/${esc(login)}.png?size=96" alt="" onerror="this.remove()"><span><b>${esc(name)}</b><span>${esc(what)}</span></span></a>`).join("")}</div></div>
      <div class="supby"><h2>Translated by</h2>
        <p class="supthanks">The game's texts in other languages are the work of these teams — every name, skill and line you read in your language was translated by them. Thank you.</p>
        <div class="suptrows" id="suptr"></div></div></div>
    <h2>How to help</h2>
    <div class="supways">${ways.map(([tag, title, text, links]) => `<div class="supway"><small>${tag}</small><h2>${title}</h2>${text}<div class="suplinks">${links}</div></div>`).join("")}</div>
    ${SUP.backers.length ? `<h2>Supporters</h2>${SUP.backers.map(([tier, names]) => `<div class="suptier"><small>${esc(tier)}</small>${names.map((n) => `<span>${esc(n)}</span>`).join("")}</div>`).join("")}` : ""}
    <h2>Credits &amp; licenses</h2>
    <div class="supcredits">
      <p><b>Limbus Company</b> and everything from it — characters, art, music, voices, texts — belong to ProjectMoon. Limbus Archive is unofficial and not affiliated with ProjectMoon; the game's content is shown for reference only. ${out("https://limbuscompany.com", "limbuscompany.com ↗")}</p>
      <p><b>Spine</b> skeletons are played with the official Spine web player by Esoteric Software, used under the ${out("https://esotericsoftware.com/spine-runtimes-license", "Spine Runtimes License ↗")}.</p>
      <p><b>Built with</b> ${out("https://github.com/K0lb3/UnityPy", "UnityPy")} (reading the game's files), ${out("https://ffmpeg.org", "FFmpeg")} (sound and video), ${out("https://pywebview.flowrl.com", "pywebview")} (the app's window) and Unity (skills with the game's effects).</p>
      <p><b>News</b> are the developers' notices from the game's Steam page; <b>Community</b> lists live streams from Twitch and YouTube. Both belong to their authors.</p>
      <p class="muted small">Are you from ProjectMoon and want something taken down? Write on Discord: ${esc(SUP.discord)}.</p>
    </div></div>`;
  supTranslators();
  document.querySelectorAll(".supcopy").forEach((b) => b.onclick = () => navigator.clipboard.writeText(SUP.discord).then(() => toast("Discord name copied")).catch(() => {}));
};
