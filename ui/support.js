// Support: how to help the project (word of mouth, bug reports and ideas, code, money once there is somewhere to
// send it), who made it, and whose work it stands on. Plain text and links: the page asks the server for nothing,
// so the web copy shows it as it is.
"use strict";

const SUP = {
  repo: "https://github.com/Schirke/limbus-archive",
  site: "https://limbus.shpep.workers.dev",
  discord: "hines9278",
  // where money can be sent: [name, address, note] — the block is not drawn while this is empty
  money: [],
  // [name, GitHub login, what they did]
  team: [
    ["Schirke", "Schirke", "the app and the site"],
    ["shpepofficial-art", "shpepofficial-art", "Versus and Versus Live, skill effects"],
  ],
  // people who sent money: [tier, [names]]
  backers: [],
};

routes.support = () => {
  const out = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${text}</a>`;
  const web = document.body.classList.contains("site");
  const ways = [
    ["Free", "Tell people", `<p>Show the ${web ? "site" : "app"} to friends who play, post your Daily challenge result, drop a link where Limbus Company is talked about.</p>
      <p>A star on GitHub helps others find it.</p>`,
      out(SUP.repo, "Star on GitHub ↗") + (web ? out(SUP.repo + "/releases/latest", "Desktop app ↗") : out(SUP.site, "The website ↗"))],
    ["Feedback", "Report and suggest", `<p>Something is wrong, missing or named badly — a wrong track name, an enemy without a picture, a page that doesn't open? Say so: most fixes start with one message.</p>
      <p>Discord: <b class="supcopy" title="Copy">${esc(SUP.discord)}</b></p>`,
      out(SUP.repo + "/issues/new", "Report a bug ↗") + out(SUP.repo + "/issues", "Open issues ↗")],
    ["Code", "Join in", `<p>The code is open. Take an issue or bring your own idea and send a pull request — or write on Discord first to agree on what to do.</p>
      <p>Nobody is paid: this is a hobby project.</p>`,
      out(SUP.repo, "Source code ↗") + out(SUP.repo + "/pulls", "Pull requests ↗")],
  ];
  if (SUP.money.length) ways.push(["Money", "Chip in", `<p>Hosting and time cost something. Any amount helps and nothing is locked behind it.</p>
      ${SUP.money.filter((m) => m[2]).map((m) => `<p class="muted small">${esc(m[0])}: ${esc(m[2])}</p>`).join("")}`,
    SUP.money.map((m) => out(m[1], esc(m[0]) + " ↗")).join("")]);
  $("#main").innerHTML = `<div class="suppage"><h1>Support</h1>
    <div class="sub">Limbus Archive is a free fan project made in spare time. If it is useful to you, here is how to help it grow.</div>
    <div class="supways">${ways.map(([tag, title, text, links]) => `<div class="supway"><small>${tag}</small><h2>${title}</h2>${text}<div class="suplinks">${links}</div></div>`).join("")}</div>
    <h2>Made by</h2>
    <div class="supteam">${SUP.team.map(([name, login, what]) => `<a class="supman" href="https://github.com/${esc(login)}" target="_blank" rel="noopener">
      <img loading="lazy" src="https://github.com/${esc(login)}.png?size=96" alt="" onerror="this.remove()"><span><b>${esc(name)}</b><span>${esc(what)}</span></span></a>`).join("")}</div>
    ${SUP.backers.length ? `<h2>Supporters</h2>${SUP.backers.map(([tier, names]) => `<div class="suptier"><small>${esc(tier)}</small>${names.map((n) => `<span>${esc(n)}</span>`).join("")}</div>`).join("")}` : ""}
    <h2>Credits &amp; licenses</h2>
    <div class="supcredits">
      <p><b>Limbus Company</b> and everything from it — characters, art, music, voices, texts — belong to ProjectMoon. Limbus Archive is unofficial and not affiliated with ProjectMoon; the game's content is shown for reference only. ${out("https://limbuscompany.com", "limbuscompany.com ↗")}</p>
      <p><b>Spine</b> skeletons are played with the official Spine web player by Esoteric Software, used under the ${out("https://esotericsoftware.com/spine-runtimes-license", "Spine Runtimes License ↗")}.</p>
      <p><b>Built with</b> ${out("https://github.com/K0lb3/UnityPy", "UnityPy")} (reading the game's files), ${out("https://ffmpeg.org", "FFmpeg")} (sound and video), ${out("https://pywebview.flowrl.com", "pywebview")} (the app's window) and Unity (skills with the game's effects).</p>
      <p><b>News</b> are the developers' notices from the game's Steam page; <b>Community</b> lists live streams from Twitch and YouTube. Both belong to their authors.</p>
      <p class="muted small">Are you from ProjectMoon and want something taken down? Write on Discord: ${esc(SUP.discord)}.</p>
    </div></div>`;
  document.querySelectorAll(".supcopy").forEach((b) => b.onclick = () => navigator.clipboard.writeText(SUP.discord).then(() => toast("Discord name copied")).catch(() => {}));
};
