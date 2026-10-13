// Database → Compare (beta): two Identities or two E.G.O side by side at one Uptie and level. #/compare/<id>/<id>
const cq = { ego: false, a: 0, b: 0, ea: 0, eb: 0, up: 4, level: 0 };
const cqList = () => cq.ego ? UNITS.egos : UNITS.ids;
const cqKey = (side) => (cq.ego ? "e" : "") + side;
const cqName = (x) => x.title || x.name;
routes.compare = async (args) => {
  $("#main").innerHTML = `<div class="muted">Loading…</div>`;
  try { await units(); } catch (e) { $("#main").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (!UNITS.ids.length) { $("#main").innerHTML = `<div class="empty">Take a snapshot first — the database is read from it.</div>`; return; }
  cq.level ||= MAX_LEVEL;
  const first = unitById(+args[0]);
  if (first) cq.ego = !first.title;
  const has = (id) => cqList().some((x) => x.id === id);
  if (has(+args[0])) cq[cqKey("a")] = +args[0];
  if (has(+args[1])) cq[cqKey("b")] = +args[1];
  cqDraw();
};
// both sides of the open kind; a missing one = another of the same Sinner
function cqPair() {
  const list = cqList(), ka = cqKey("a"), kb = cqKey("b"), by = (id) => list.find((x) => x.id === id);
  if (!by(cq[ka])) cq[ka] = list[0].id;
  if (!by(cq[kb]) || cq[kb] === cq[ka]) cq[kb] = (list.find((x) => x.sinner === by(cq[ka]).sinner && x.id !== cq[ka]) || list.find((x) => x.id !== cq[ka])).id;
  return [by(cq[ka]), by(cq[kb])];
}
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
  const x = unitById(cq[cqKey(side)]);
  return `<div class="cqpick" data-side="${side}"><img src="${imgThumb(x.img.thumb)}" alt="" onerror="this.style.visibility='hidden'">
    <div class="grow"><div class="cqname">${esc(cqName(x))}</div><div class="muted small">${esc(x.sinnerName)}${x.grade ? ` · ${esc(x.grade)}` : ""}${x.season && x.season < 100 ? ` · Season ${x.season}` : ""}</div></div>
    <input class="cqin" placeholder="Change…" autocomplete="off"><div class="cqlist"></div></div>`;
}
function cqDraw() {
  const [A, B] = cqPair(), ego = cq.ego, lv = cq.level, up = cq.up;
  history.replaceState(null, "", `#/compare/${A.id}/${B.id}`);
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
  const cost = (x) => x.cost.map((c) => `<span class="kwi">${sinIcon(c.sin, "s20")}<b>×${c.n}</b></span>`).join(" ") || "—";
  const costSum = (x) => x.cost.reduce((n, c) => n + c.n, 0);
  const sp = (x) => { const s = x.skills[0]; return s ? cqAt(s, up).sanity || 0 : null; };
  const sins = Object.keys(SIN_COLORS).filter((k) => k !== "None");
  const kws = (x) => x.statuses.map((k) => `<span class="kw ${(UNITS.glossary[k] || {}).type || "neu"}">${statusIcon(k, "s20")}${esc(statusName(k))}</span>`).join(" ") || "—";
  const slots = (x) => ego ? x.skills.map((s) => [s.label || "Skill", s]) : cqSlots(x);
  const pa = new Map(slots(A)), pb = new Map(slots(B));
  const art = (x) => ego ? x.img.thumb : null;
  const labels = [...new Set([...pa.keys(), ...pb.keys()])];
  if (!ego) labels.sort((x, y) => x.localeCompare(y, "en", { numeric: true }));
  const sec = (t) => `<tr class="cqsec"><td></td><th>${t}</th><td></td></tr>`;
  const both = (l) => { const a = pa.get(l), b = pb.get(l); return `<div class="cqcols"><div data-who="${esc(cqName(A))}">${a ? skillView(a, up, lv, l, art(A), true) : `<div class="cqmiss">No ${l}</div>`}</div><div data-who="${esc(cqName(B))}">${b ? skillView(b, up, lv, l, art(B), true) : `<div class="cqmiss">No ${l}</div>`}</div></div>`; };
  $("#main").innerHTML = `<div class="cqpage"><h1>Compare</h1>
    <div class="cqctl"><span class="cqkind"><button class="${ego ? "" : "on"}" data-ego="0">Identities</button><button class="${ego ? "on" : ""}" data-ego="1">E.G.O</button></span>
      <span class="lvlabel">${ego ? "Threadspin" : "Uptie"}</span>${[1, 2, 3, 4].map((n) => `<button class="upbtn ${up === n ? "on" : ""}" data-up="${n}" title="${n}">${ico(`up_${n}`, "s22", "", ROMAN[n - 1])}</button>`).join("")}
      ${ego ? "" : `<span class="lvlabel">Lv. <b id="cqlvn">${lv}</b></span><input type="range" id="cqlv" min="1" max="${MAX_LEVEL}" value="${lv}">`}<button id="cqswap">⇄ Swap</button></div>
    <div class="cqpicks">${cqPicker("a")}<div class="cqvs">VS</div>${cqPicker("b")}</div>
    <table class="cqtab">
      ${ego ? `${sec("E.G.O")}
      <tr><td>${ico(`grade_${A.grade}`, "s28", A.grade, A.grade)}</td><th>Grade</th><td>${ico(`grade_${B.grade}`, "s28", B.grade, B.grade)}</td></tr>
      ${row("Cost", A, B, cost, false, costSum)}
      ${row("SP", sp(A), sp(B), (v) => v ?? "—", false)}
      ${sec("Resistances")}
      ${sins.map((k) => row(sinIcon(k, "s22"), A.resist[k] ?? 1, B.resist[k] ?? 1, resShow, false)).join("")}` : `${sec("Status")}
      ${row("HP", hpOf(A), hpOf(B), (v) => v)}
      ${row("Speed", spOf(A), spOf(B), (v) => `${v[0]}–${v[1]}`, true, (v) => v[0] + v[1])}
      ${row("Defense", lv + A.def, lv + B.def, (v) => v)}
      ${row("Stagger", A.stagger, B.stagger, (v) => v.map((p) => `${p}%`).join(" · ") || "—", false, (v) => v[0] ?? 0)}
      ${sec("Resistances")}
      ${["Slash", "Pierce", "Blunt"].map((k) => row(`${ico(`res_${k}`, "s22", k, "")} ${k}`, A.resist[k] ?? 1, B.resist[k] ?? 1, resShow, false)).join("")}`}
      ${sec("Skills")}
      ${labels.map((l) => { const a = pa.get(l), b = pb.get(l), [ca, cb] = better(a && cqMax(a, up), b && cqMax(b, up));
        return `<tr><td class="${ca}">${skShow(a)}</td><th>${l}</th><td class="${cb}">${skShow(b)}</td></tr>`; }).join("")}
      ${ego ? "" : `<tr><td>${skShow((A.defense || [])[0])}</td><th>Defense</th><td>${skShow((B.defense || [])[0])}</td></tr>
      ${sec("Keywords")}
      <tr><td>${kws(A)}</td><th></th><td>${kws(B)}</td></tr>`}
    </table>
    <h3 class="group">Skills</h3>${labels.map(both).join("")}
    <h3 class="group">Passives</h3>
    <div class="cqcols"><div data-who="${esc(cqName(A))}">${A.passives.map((p) => passiveHtml(pasAt(p, up), true)).join("")}</div><div data-who="${esc(cqName(B))}">${B.passives.map((p) => passiveHtml(pasAt(p, up), true)).join("")}</div></div></div>`;
  $("#main").querySelectorAll("[data-up]").forEach((b) => b.onclick = () => { cq.up = +b.dataset.up; cqDraw(); });
  $("#main").querySelectorAll("[data-ego]").forEach((b) => b.onclick = () => { cq.ego = b.dataset.ego === "1"; cqDraw(); });
  if ($("#cqlv")) {
    $("#cqlv").oninput = (e) => { $("#cqlvn").textContent = e.target.value; };
    $("#cqlv").onchange = (e) => { cq.level = +e.target.value; cqDraw(); };
  }
  $("#cqswap").onclick = () => { const ka = cqKey("a"), kb = cqKey("b"); [cq[ka], cq[kb]] = [cq[kb], cq[ka]]; cqDraw(); };
  $("#main").querySelectorAll(".cqpick").forEach((p) => {
    const inp = p.querySelector("input"), list = p.querySelector(".cqlist");
    inp.oninput = () => {
      const w = sxWords(inp.value);
      const found = w.length ? cqList().filter((x) => { const t = sxNorm(`${cqName(x)} ${x.sinnerName} ${sxEn(cqName(x))} ${sxEn(x.sinnerName)}`); return w.every((q) => t.includes(q)); }).slice(0, 8) : [];
      list.innerHTML = found.map((x) => `<div data-id="${x.id}"><img src="${imgThumb(x.img.thumb)}" alt=""><span>${esc(cqName(x))} <i>${esc(x.sinnerName)}</i></span></div>`).join("");
      list.querySelectorAll("[data-id]").forEach((d) => d.onmousedown = () => { cq[cqKey(p.dataset.side)] = +d.dataset.id; cqDraw(); });
    };
    inp.onfocus = () => sxBack().then(() => { if (inp.value) inp.oninput(); });
    inp.onblur = () => setTimeout(() => { list.innerHTML = ""; }, 150);
  });
}
