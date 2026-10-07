// ------------------------------------------------------------------ AI redraw (experimental)
// A skill's frames zip (Animations -> Edit -> Frames) redrawn by ComfyUI as another character — same poses, sizes and
// names — into a new zip next to it, which loads into a mod. Shown only where ComfyUI and its script are set up
// (limbusdm/redraw.py).
const rd = { zip: "", char: "", avoid: "", seed: 12345, denoise: 0.85, cn: 0.7, face: 0.45, only: new Set(), mod: "AI" };
try { Object.assign(rd, JSON.parse(localStorage.getItem("redraw") || "{}"), { only: new Set() }); } catch (e) { /* no storage */ }
const rdSave = () => { try { localStorage.setItem("redraw", JSON.stringify({ ...rd, only: undefined })); } catch (e) { /* no storage */ } };

// the character search (Danbooru, through the app): what was typed, the tags found, the one picked and its pictures
const rdFind = { q: "", list: null, tag: "", pics: [] };

api("/api/redraw").then((st) => { if (st.available) $("#navredraw").hidden = false; }).catch(() => {});

routes.redraw = async () => {
  const main = $("#main");
  main.innerHTML = `<h1>AI redraw</h1><div class="sub">Redraw a skill's frames as another character with ComfyUI — same poses, sizes and file names.
    Get the frames from Animations → Edit → Frames (zip), redraw them here, then load the new zip into a mod.</div><div id="rdbody"><div class="muted">Loading…</div></div>`;
  drawRedraw();
};

async function drawRedraw() {
  const box = $("#rdbody");
  if (!box) return;
  const st = await api("/api/redraw").catch((e) => ({ error: e.message, zips: [] }));
  if (!st.available) { box.innerHTML = `<div class="card">ComfyUI with redraw.py isn't set up on this PC.</div>`; return; }
  const srcs = st.zips.filter((z) => !z.ai);
  if (!srcs.some((z) => z.name === rd.zip)) rd.zip = srcs[0]?.name || "";
  const src = srcs.find((z) => z.name === rd.zip);
  const stem = rd.zip.replace(/\.zip$/i, "");
  const results = st.zips.filter((z) => z.ai && z.name.startsWith(stem + " [AI"));
  const thumb = (zip, f) => `/api/redraw/thumb?zip=${encodeURIComponent(zip)}&frame=${encodeURIComponent(f)}`;
  const num = (k, label, step, min, max, title) => `<label class="small" title="${title}">${label}
    <input data-rd="${k}" type="number" step="${step}" min="${min}" max="${max}" value="${rd[k]}" style="width:72px"></label>`;
  // a stopped run of this zip can go on from where it stopped
  const left = st.params && st.src === rd.zip && !st.out ? st.total - st.fresh.length : 0;
  const pct = st.total ? Math.round(100 * st.done / st.total) : 0;
  box.innerHTML = `<div class="card">
      <div class="row" style="gap:8px;flex-wrap:wrap"><span class="small muted">Frames zip</span>
        <select id="rdzip" style="flex:1;min-width:300px">${srcs.map((z) => `<option ${z.name === rd.zip ? "selected" : ""}>${esc(z.name)}</option>`).join("")}</select></div>
      ${srcs.length ? "" : `<div class="muted small" style="margin-top:6px">No frames zips in data/exports yet — export one from Animations → Edit → Frames.</div>`}
      <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap"><span class="small muted">Find a character</span>
        <input id="rdq" placeholder="wis'adel, kaltsit, …" value="${esc(rdFind.q)}" style="flex:1;min-width:200px"><button id="rdfind">Search</button></div>
      ${rdFind.list ? `<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px">${rdFind.list.length ? rdFind.list.map((c) =>
        `<button class="toggle ${c.tag === rdFind.tag ? "on" : ""}" data-tag="${esc(c.tag)}">${esc(c.tag)} <span class="muted small">${c.count}</span></button>`).join("")
        : `<span class="muted small">Nothing found on Danbooru — try another spelling.</span>`}</div>` : ""}
      ${rdFind.pics.length ? `<div class="row" style="gap:6px;margin-top:6px">${rdFind.pics.map((u) =>
        `<img src="/api/redraw/img?url=${encodeURIComponent(u)}" style="height:150px;border-radius:6px">`).join("")}</div>` : ""}
      <div style="margin-top:8px"><span class="small muted">Character — danbooru tags: the name tag, then hair, eyes, clothes, weapon colours (filled in by the search; edit freely)</span>
        <textarea data-rd="char" rows="2" style="width:100%" placeholder="kal'tsit \\(arknights\\), animal ears, cat ears, green eyes, short hair, white hair, white coat, green dress">${esc(rd.char)}</textarea></div>
      <div style="margin-top:4px"><span class="small muted">Keep away (the old character's colours)</span>
        <input data-rd="avoid" style="width:100%" placeholder="blonde hair, yellow hair" value="${esc(rd.avoid)}"></div>
      <div class="row" style="gap:12px;margin-top:8px;flex-wrap:wrap">
        ${num("seed", "Seed", 1, 0, 2147483647, "another seed = another try of the same frames")}
        ${num("denoise", "Redraw", 0.05, 0.3, 1, "how much is redrawn: lower keeps closer to the sprite (colours too)")}
        ${num("cn", "Outlines", 0.05, 0, 1, "how strictly the sprite's outlines are kept: lower lets hair / clothes change shape, pose less exact")}
        ${num("face", "Face", 0.05, 0, 0.8, "the face is drawn again close up; 0 = off")}
        <span class="grow"></span>
        ${!st.running && left > 0 ? `<button id="rdgoon" class="primary" title="the stopped run, from the frames not done yet, with its settings">Continue · ${left} left</button>` : ""}
        ${st.running ? `<button id="rdstop">Stop</button>` : `<button id="rdgo" class="primary" ${src ? "" : "disabled"}>Redraw ${rd.only.size ? `${rd.only.size} picked` : "all"} frames</button>`}
      </div>
      <div class="small muted" style="margin-top:6px">About 2 minutes a frame; the graphics card is fully busy meanwhile. Click frames below to try only those first.</div>
      ${st.running || st.error || st.out ? `<div style="margin-top:8px">
        ${st.running ? `<div class="small">Working… ${st.done} / ${st.total}</div><div style="height:6px;background:var(--line);border-radius:3px"><div style="height:6px;width:${pct}%;background:var(--gold);border-radius:3px"></div></div>` : ""}
        ${st.error ? `<div class="small" style="color:var(--rem)">${esc(st.error)}</div>` : ""}
        ${st.out && !st.running ? `<div class="small">Done: ${esc(st.out)}</div>` : ""}
        ${st.log.length ? `<pre class="small muted" style="max-height:120px;overflow:auto;margin:6px 0 0">${esc(st.log.join("\n"))}</pre>` : ""}</div>` : ""}
    </div>
    ${src ? `<h3>Frames <span class="small muted">${src.frames.length}${rd.only.size ? ` · ${rd.only.size} picked` : ""}</span></h3>
      <div class="row" style="gap:6px;flex-wrap:wrap">${src.frames.map((f) => `<div class="rdf" data-f="${esc(f)}" title="${esc(f)}"
        style="cursor:pointer;padding:4px;border-radius:6px;border:2px solid ${rd.only.has(f) ? "var(--gold)" : "transparent"};background:var(--panel2)">
        <img loading="lazy" src="${thumb(rd.zip, f)}" style="height:110px;display:block"><div class="small muted" style="text-align:center">${esc(f.replace(/\.png$/, ""))}</div></div>`).join("")}</div>` : ""}
    ${st.fresh.length && !st.out && st.src === rd.zip ? `<h3>Done so far <span class="small muted">${st.fresh.length} of ${st.total}</span></h3>
      <div class="row" style="gap:6px;flex-wrap:wrap">${st.fresh.map((f) => `<div title="${esc(f)}" style="padding:4px;border-radius:6px;background:var(--panel2)">
        <img src="${thumb("@work", f)}" style="height:110px;display:block"><div class="small muted" style="text-align:center">${esc(f.replace(/\.png$/, ""))}</div></div>`).join("")}</div>` : ""}
    ${results.length ? `<h3>Redrawn</h3>${results.map((z) => `<div class="card"><div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:6px">
        <b class="grow">${esc(z.name)}</b><input class="rdmod" value="${esc(rd.mod)}" style="width:120px" title="mod name">
        <button data-load="${esc(z.name)}">Load into mod</button></div>
        <div class="row" style="gap:6px;flex-wrap:wrap">${z.frames.map((f) => `<div title="${esc(f)}" style="padding:4px;border-radius:6px;background:var(--panel2)">
          <img loading="lazy" src="${thumb(z.name, f)}&t=${Math.round(z.time)}" style="height:110px;display:block"></div>`).join("")}</div></div>`).join("")}` : ""}`;

  $("#rdzip") && ($("#rdzip").onchange = (e) => { rd.zip = e.target.value; rd.only.clear(); rdSave(); drawRedraw(); });
  box.querySelectorAll("[data-rd]").forEach((el) => el.onchange = () => {
    const k = el.dataset.rd;
    rd[k] = el.type === "number" ? +el.value : el.value;
    rdSave();
  });
  const find = async () => {
    rdFind.q = $("#rdq").value.trim();
    if (!rdFind.q) return;
    $("#rdfind").disabled = true;
    try { rdFind.list = await api(`/api/redraw/search?q=${encodeURIComponent(rdFind.q)}`); } catch (e) { toast(esc(e.message)); }
    drawRedraw();
  };
  $("#rdfind").onclick = find;
  $("#rdq").onkeydown = (e) => { if (e.key === "Enter") find(); };
  box.querySelectorAll("[data-tag]").forEach((b) => b.onclick = async () => {
    rdFind.tag = b.dataset.tag;
    b.disabled = true;
    try {
      const c = await api(`/api/redraw/char?tag=${encodeURIComponent(rdFind.tag)}`);
      rd.char = c.tags;
      rdFind.pics = c.pics;
      rdSave();
    } catch (e) { toast(esc(e.message)); }
    drawRedraw();
  });
  box.querySelectorAll(".rdf").forEach((el) => el.onclick = () => {
    const f = el.dataset.f;
    rd.only.has(f) ? rd.only.delete(f) : rd.only.add(f);
    drawRedraw();
  });
  box.querySelectorAll(".rdmod").forEach((el) => el.onchange = () => { rd.mod = el.value.trim() || "AI"; rdSave(); });
  box.querySelectorAll("[data-load]").forEach((b) => b.onclick = async () => {
    try {
      const r = await api("/api/redraw/load", { zip: b.dataset.load, mod: rd.mod });
      toast(`${r.count} frames loaded into mod “${esc(rd.mod)}” of ${esc(r.id)} — pick it in With effects`);
    } catch (e) { toast(esc(e.message)); }
  });
  if ($("#rdgo")) $("#rdgo").onclick = async () => {
    try {
      await api("/api/redraw/start", { zip: rd.zip, char: rd.char, avoid: rd.avoid, seed: rd.seed, denoise: rd.denoise,
        cn: rd.cn, face: rd.face, only: [...rd.only] });
    } catch (e) { toast(esc(e.message)); }
    drawRedraw();
  };
  if ($("#rdgoon")) $("#rdgoon").onclick = async () => {
    try { await api("/api/redraw/start", { resume: true }); } catch (e) { toast(esc(e.message)); }
    drawRedraw();
  };
  if ($("#rdstop")) $("#rdstop").onclick = async () => { await api("/api/redraw/stop", {}).catch(() => {}); drawRedraw(); };
  if (st.running) setTimeout(() => { if (location.hash.startsWith("#/redraw")) drawRedraw(); }, 3000);
}
