// Database → Compare (beta): two Identities side by side at one Uptie and level. #/compare/<id>/<id>
const cq = { a: 0, b: 0, up: 4, level: 0 };
const CQ_BETA = `<span class="betatag">BETA</span>`;
routes.compare = async (args) => {
  $("#main").innerHTML = `<div class="muted">Loading…</div>`;
  try { await units(); } catch (e) { $("#main").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (!UNITS.ids.length) { $("#main").innerHTML = `<div class="empty">Take a snapshot first — the database is read from it.</div>`; return; }
  cq.level ||= MAX_LEVEL;
  if (unitById(+args[0])?.title) cq.a = +args[0];
  if (unitById(+args[1])?.title) cq.b = +args[1];
  if (!unitById(cq.a)) cq.a = UNITS.ids[0].id;
  if (!unitById(cq.b) || cq.b === cq.a) cq.b = (UNITS.ids.find((x) => x.sinner === unitById(cq.a).sinner && x.id !== cq.a) || UNITS.ids[1]).id;
  cqDraw();
};
// a skill at an Uptie (the nearest lower one the game gives)
function cqAt(s, up) {
  const ks = Object.keys(s.up).map(Number), low = ks.filter((k) => k <= up);
  return s.up[up] || s.up[low.length ? Math.max(...low) : Math.min(...ks)];
}
const cqMax = (s, up) => { const u = cqAt(s, up); return u.base + (u.op === "SUB" ? 0 : u.coin * u.coins); };
// Skill 1-3 and their alternates (Skill 3.1 …), then skills of no tier ("Extra")
function cqSlots(x) {
  const main = x.skills.filter((s) => s.copies), ex = x.skills.filter((s) => !s.copies), out = [];
  main.forEach((s, i) => { out.push([`Skill ${i + 1}`, s]); ex.filter((e) => e.tier === s.tier).forEach((e, k) => out.push([`Skill ${i + 1}.${k + 1}`, e])); });
  ex.filter((e) => !main.some((s) => s.tier === e.tier)).forEach((e, k) => out.push([`Extra ${k + 1}`, e]));
  return out;
}
function cqPicker(side) {
  const x = unitById(cq[side]);
  return `<div class="cqpick" data-side="${side}"><img src="${imgThumb(x.img.thumb)}" alt="" onerror="this.style.visibility='hidden'">
    <div class="grow"><div class="cqname">${esc(x.title)}</div><div class="muted small">${esc(x.sinnerName)}${x.season && x.season < 100 ? ` · Season ${x.season}` : ""}</div></div>
    <input class="cqin" placeholder="Change…" autocomplete="off"><div class="cqlist"></div></div>`;
}
function cqDraw() {
  const A = unitById(cq.a), B = unitById(cq.b), up = cq.up, lv = cq.level;
  history.replaceState(null, "", `#/compare/${cq.a}/${cq.b}`);
  const hpOf = (x) => Math.floor(x.hp + x.hpLevel * lv), spOf = (x) => x.speed[Math.min(up, x.speed.length) - 1] || [0, 0];
  // the better side green; nothing when equal or when one side has nothing to compare
  const better = (a, b, hi = true) => a === b || a == null || b == null ? ["", ""] : (a > b) === hi ? ["cqwin", "cqlose"] : ["cqlose", "cqwin"];
  const row = (label, va, vb, show, hi = true, num = (v) => v) => {
    const [ca, cb] = better(num(va), num(vb), hi);
    return `<tr><td class="${ca}">${show(va)}</td><th>${label}</th><td class="${cb}">${show(vb)}</td></tr>`;
  };
  const resShow = (v) => { const [l, c] = RESIST(v); return `<span class="${c}">${l}</span> <span class="muted small">×${v}</span>`; };
  const skShow = (s) => {
    if (!s) return `<span class="muted">—</span>`;
    const u = cqAt(s, up);
    return `<span class="cqsk">${sinIcon(u.sin, "s20")}<b>${esc(u.name)}</b></span><span class="cqpow">${u.base} ${u.op === "SUB" ? "−" : "+"}${u.coin} × ${u.coins} coin${u.coins > 1 ? "s" : ""} → <b>${cqMax(s, up)}</b>${s.copies ? ` · ×${s.copies}` : ""}</span>`;
  };
  const kws = (x) => x.statuses.map((k) => `<span class="kw ${(UNITS.glossary[k] || {}).type || "neu"}">${statusIcon(k, "s20")}${esc(statusName(k))}</span>`).join(" ") || "—";
  const pa = new Map(cqSlots(A)), pb = new Map(cqSlots(B));
  const labels = [...new Set([...pa.keys(), ...pb.keys()])].sort((x, y) => x.localeCompare(y, "en", { numeric: true }));
  const sec = (t) => `<tr class="cqsec"><td></td><th>${t}</th><td></td></tr>`;
  const both = (l) => { const a = pa.get(l), b = pb.get(l); return `<div class="cqcols"><div>${a ? skillView(a, up, lv, l, null, true) : `<div class="cqmiss">No ${l}</div>`}</div><div>${b ? skillView(b, up, lv, l, null, true) : `<div class="cqmiss">No ${l}</div>`}</div></div>`; };
  $("#main").innerHTML = `<div class="cqpage"><h1>Compare ${CQ_BETA}</h1>
    <div class="cqctl"><span class="lvlabel">Uptie</span>${[1, 2, 3, 4].map((n) => `<button class="upbtn ${up === n ? "on" : ""}" data-up="${n}" title="${n}">${ico(`up_${n}`, "s22", "", ROMAN[n - 1])}</button>`).join("")}
      <span class="lvlabel">Lv. <b id="cqlvn">${lv}</b></span><input type="range" id="cqlv" min="1" max="${MAX_LEVEL}" value="${lv}"><button id="cqswap">⇄ Swap</button></div>
    <div class="cqpicks">${cqPicker("a")}<div class="cqvs">VS</div>${cqPicker("b")}</div>
    <table class="cqtab">
      ${sec("Status")}
      ${row("HP", hpOf(A), hpOf(B), (v) => v)}
      ${row("Speed", spOf(A), spOf(B), (v) => `${v[0]}–${v[1]}`, true, (v) => v[0] + v[1])}
      ${row("Defense", lv + A.def, lv + B.def, (v) => v)}
      ${row("Stagger", A.stagger, B.stagger, (v) => v.map((p) => `${p}%`).join(" · ") || "—", false, (v) => v[0] ?? 0)}
      ${sec("Resistances")}
      ${["Slash", "Pierce", "Blunt"].map((k) => row(`${ico(`res_${k}`, "s22", k, "")} ${k}`, A.resist[k] ?? 1, B.resist[k] ?? 1, resShow, false)).join("")}
      ${sec("Skills")}
      ${labels.map((l) => { const a = pa.get(l), b = pb.get(l), [ca, cb] = better(a && cqMax(a, up), b && cqMax(b, up));
        return `<tr><td class="${ca}">${skShow(a)}</td><th>${l}</th><td class="${cb}">${skShow(b)}</td></tr>`; }).join("")}
      <tr><td>${skShow((A.defense || [])[0])}</td><th>Defense</th><td>${skShow((B.defense || [])[0])}</td></tr>
      ${sec("Keywords")}
      <tr><td>${kws(A)}</td><th></th><td>${kws(B)}</td></tr>
    </table>
    <h3 class="group">Skills</h3>${labels.map(both).join("")}
    <h3 class="group">Passives</h3>
    <div class="cqcols"><div>${A.passives.map((p) => passiveHtml(pasAt(p, up), true)).join("")}</div><div>${B.passives.map((p) => passiveHtml(pasAt(p, up), true)).join("")}</div></div></div>`;
  $("#main").querySelectorAll("[data-up]").forEach((b) => b.onclick = () => { cq.up = +b.dataset.up; cqDraw(); });
  $("#cqlv").oninput = (e) => { $("#cqlvn").textContent = e.target.value; };
  $("#cqlv").onchange = (e) => { cq.level = +e.target.value; cqDraw(); };
  $("#cqswap").onclick = () => { [cq.a, cq.b] = [cq.b, cq.a]; cqDraw(); };
  $("#main").querySelectorAll(".cqpick").forEach((p) => {
    const inp = p.querySelector("input"), list = p.querySelector(".cqlist");
    inp.oninput = () => {
      const w = sxWords(inp.value);
      const found = w.length ? UNITS.ids.filter((x) => { const t = sxNorm(`${x.title} ${x.sinnerName} ${sxEn(x.title)} ${sxEn(x.sinnerName)}`); return w.every((q) => t.includes(q)); }).slice(0, 8) : [];
      list.innerHTML = found.map((x) => `<div data-id="${x.id}"><img src="${imgThumb(x.img.thumb)}" alt=""><span>${esc(x.title)} <i>${esc(x.sinnerName)}</i></span></div>`).join("");
      list.querySelectorAll("[data-id]").forEach((d) => d.onmousedown = () => { cq[p.dataset.side] = +d.dataset.id; cqDraw(); });
    };
    inp.onfocus = () => sxBack();
    inp.onblur = () => setTimeout(() => { list.innerHTML = ""; }, 150);
  });
}
