const API = ""; // same origin; set to "http://localhost:5000" if served elsewhere
const PAGE = 50;
let current = null;
let offset = 0;

const $ = (id) => document.getElementById(id);

async function api(path) {
  const res = await fetch(API + path);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || res.statusText);
  return data;
}

async function checkHealth() {
  const el = $("status");
  try {
    await api("/api/health");
    el.textContent = "DB connected";
    el.className = "status ok";
  } catch (e) {
    el.textContent = "DB error";
    el.className = "status error";
    el.title = e.message;
  }
}

async function loadTables() {
  const list = $("tables");
  try {
    const tables = await api("/api/tables");
    list.innerHTML = "";
    for (const t of tables) {
      const li = document.createElement("li");
      li.textContent = t;
      li.onclick = () => selectTable(t, li);
      list.appendChild(li);
    }
  } catch (e) {
    list.textContent = e.message;
  }
}

function selectTable(name, li) {
  document.querySelectorAll("li.active").forEach((n) => n.classList.remove("active"));
  li.classList.add("active");
  current = name;
  offset = 0;
  loadRows();
}

async function loadRows() {
  const grid = $("grid");
  $("title").textContent = current;
  try {
    const d = await api(`/api/tables/${encodeURIComponent(current)}?limit=${PAGE}&offset=${offset}`);
    grid.innerHTML = "";
    const head = grid.createTHead().insertRow();
    for (const c of d.columns) {
      const th = document.createElement("th");
      th.textContent = c;
      head.appendChild(th);
    }
    const body = grid.createTBody();
    for (const r of d.rows) {
      const tr = body.insertRow();
      for (const c of d.columns) {
        const v = r[c];
        tr.insertCell().textContent = v === null ? "" : typeof v === "object" ? JSON.stringify(v) : v;
      }
    }
    const end = Math.min(offset + PAGE, d.total);
    $("range").textContent = d.total ? `${offset + 1}-${end} of ${d.total}` : "empty";
    $("prev").disabled = offset === 0;
    $("next").disabled = end >= d.total;
  } catch (e) {
    grid.innerHTML = "";
    $("range").textContent = e.message;
  }
}

$("prev").onclick = () => { offset = Math.max(0, offset - PAGE); loadRows(); };
$("next").onclick = () => { offset += PAGE; loadRows(); };

// ---- Material IDs ----
const dirty = new Map(); // key -> {vendor, name, mat_id, keywords}
let mOffset = 0;
const key = (v, n) => JSON.stringify([v, n]);

function showTab(id) {
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== id));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === id));
  if (id === "materials-view") loadCombos();
}
document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => showTab(t.dataset.tab)));

function makeInput(value, onInput) {
  const i = document.createElement("input");
  i.value = value;
  i.oninput = () => onInput(i.value);
  return i;
}

async function loadCombos() {
  const grid = $("m-grid");
  const p = new URLSearchParams({ limit: PAGE, offset: mOffset, q: $("m-q").value, status: $("m-status").value });
  try {
    const d = await api("/api/materials/combos?" + p);
    grid.innerHTML = "";
    const head = grid.createTHead().insertRow();
    for (const c of ["Vendor Name", "Item Name", "Material ID", "Keywords (comma separated)"]) {
      const th = document.createElement("th");
      th.textContent = c;
      head.appendChild(th);
    }
    const body = grid.createTBody();
    for (const r of d.rows) {
      const k = key(r.vendor, r.name);
      const edit = dirty.get(k) || {
        vendor: r.vendor,
        name: r.name,
        mat_id: r.mat_id || "",
        keywords: (r.keywords || []).join(", "),
      };
      const change = (field) => (val) => {
        edit[field] = val;
        dirty.set(k, edit);
        tr.classList.add("dirty");
      };
      const tr = body.insertRow();
      if (dirty.has(k)) tr.classList.add("dirty");
      tr.insertCell().textContent = r.vendor;
      tr.insertCell().textContent = r.name;
      tr.insertCell().appendChild(makeInput(edit.mat_id, change("mat_id")));
      tr.insertCell().appendChild(makeInput(edit.keywords, change("keywords")));
    }
    const end = Math.min(mOffset + PAGE, d.total);
    $("m-range").textContent = d.total ? `${mOffset + 1}-${end} of ${d.total}` : "no results";
    $("m-prev").disabled = mOffset === 0;
    $("m-next").disabled = end >= d.total;
  } catch (e) {
    $("m-msg").textContent = e.message;
  }
}

async function saveMaterials() {
  const items = [...dirty.values()].map((e) => ({
    ...e,
    keywords: e.keywords.split(",").map((s) => s.trim()).filter(Boolean),
  }));
  if (!items.length) { $("m-msg").textContent = "Nothing to update."; return; }
  try {
    const res = await fetch(API + "/api/materials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || res.statusText);
    dirty.clear();
    $("m-msg").textContent = `Saved: ${d.inserted} inserted, ${d.updated} updated.`;
    loadCombos();
  } catch (e) {
    $("m-msg").textContent = "Save failed: " + e.message;
  }
}

$("m-prev").onclick = () => { mOffset = Math.max(0, mOffset - PAGE); loadCombos(); };
$("m-next").onclick = () => { mOffset += PAGE; loadCombos(); };
$("m-save").onclick = saveMaterials;
$("m-status").onchange = () => { mOffset = 0; loadCombos(); };
let timer;
$("m-q").oninput = () => { clearTimeout(timer); timer = setTimeout(() => { mOffset = 0; loadCombos(); }, 300); };


checkHealth();
loadTables();
