// popup.js — VOrganise
"use strict";

// ── State ──────────────────────────────────────────────────────────────────────
let allMaterials  = [];
let filtered      = [];
let checked       = new Set();
let faculties     = [];
let moduleNums    = [];        // regular modules (1+)
let hasExamItems  = false;     // true if any module === 0
let isSkillsCourse = false;    // ISTS code or skills faculty detected
let courseList    = [];        // [{value, label}] from VTOP dropdown
let activeCourse  = null;      // {value, label}
let filters       = { search: "", faculty: "", modules: new Set(), showExam: false, sort: "default" };
let isDownloading = false;
let isSwitching   = false;
let stats         = { total: 0, done: 0, failed: 0 };
let logs          = [];
let isScanning    = false;
let scanError     = "";
let onVtop        = false;

// Skills course detection
const SKILLS_CODES    = ["ISTS"];
const SKILLS_FACULTY  = ["face", "ethnus", "sixphase"];

const app = document.getElementById("app");

// ── Init ───────────────────────────────────────────────────────────────────────
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  onVtop = !!(tab?.url?.includes("vit.ac.in"));
  chrome.runtime.sendMessage({ action: "GET_STATUS" }, res => {
    if (res?.isRunning) { isDownloading = true; stats = res.stats || stats; }
    render();
  });
}

// ── Full render every time ─────────────────────────────────────────────────────
function render() {
  app.innerHTML = buildHeader() + (isDownloading ? buildProgress() : buildMain());
  attachAll();
}

// ── Header ─────────────────────────────────────────────────────────────────────
function buildHeader() {
  return `
  <div class="header">
    <div class="logo-mark">
      <svg viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
        <rect width="36" height="36" rx="8" fill="#003087"/>
        <text x="18" y="12" text-anchor="middle" fill="#fff"
          font-family="DM Sans,sans-serif" font-size="6" font-weight="700">VTOP</text>
        <line x1="18" y1="15" x2="18" y2="24" stroke="#cc0000" stroke-width="2.5" stroke-linecap="round"/>
        <polyline points="13,21 18,26 23,21" fill="none" stroke="#cc0000"
          stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        <line x1="12" y1="29" x2="24" y2="29" stroke="white" stroke-width="2"
          stroke-linecap="round" opacity="0.7"/>
      </svg>
    </div>
    <div class="header-copy">
      <div class="header-name">V<span>Organise</span></div>
      <div class="header-tagline">VTOP Course Material Manager</div>
    </div>
    <div class="header-vitian">Made for Vitian</div>
  </div>`;
}

// ── Main page ──────────────────────────────────────────────────────────────────
function buildMain() {
  if (!onVtop) return `
    <div class="idle">
      <div class="idle-icon">📚</div>
      <div class="idle-title">Not on VTOP</div>
      <div class="idle-desc">Open your VTOP Course Page and select a registered course to view materials.</div>
      <div class="idle-chip">vtop.vit.ac.in → Course Page</div>
    </div>`;

  const hasMats = allMaterials.length > 0;
  const cnt     = checkedCount();

  let statusHtml;
  if (isScanning || isSwitching)
    statusHtml = `<span class="scan-status"><span class="spin"></span> ${isSwitching ? "Switching course…" : "Scanning…"}</span>`;
  else if (scanError)
    statusHtml = `<span class="scan-status err">⚠ ${esc(scanError)}</span>`;
  else if (hasMats)
    statusHtml = `<span class="scan-status ok">✓ ${allMaterials.length} materials</span>`;
  else
    statusHtml = `<span class="scan-status">Open Course Page → Scan</span>`;

  return `
  <div class="main">

    <!-- Scan row -->
    <div class="scan-row">
      ${statusHtml}
      <button class="btn btn-primary" id="scan-btn" ${isScanning || isSwitching ? "disabled" : ""}>
        🔍 Scan
      </button>
    </div>

    <!-- Course switcher (shown after first scan) -->
    ${courseList.length > 0 ? buildCourseSwitcher() : ""}

    <!-- Filters -->
    ${hasMats ? buildFilters() : ""}

    <!-- List header -->
    ${hasMats ? `
    <div class="list-header">
      <div class="list-count">Showing <strong>${filtered.length}</strong> of ${allMaterials.length}</div>
      <span class="chk-all" id="chk-all">
        ${filtered.length > 0 && filtered.every(i => checked.has(i.fileName)) ? "Deselect all" : "Select all"}
      </span>
    </div>` : ""}

    <!-- List body -->
    ${buildList()}

    <!-- Action bar -->
    ${hasMats ? `
    <div class="action-bar">
      <div class="dl-row">
        <div class="dl-count"><strong>${cnt}</strong> file${cnt !== 1 ? "s" : ""} selected</div>
        <button class="btn btn-vit" id="dl-btn" ${cnt === 0 ? "disabled" : ""}>
          ⬇ Download ${cnt > 0 ? `(${cnt})` : ""}
        </button>
      </div>
    </div>` : ""}

  </div>`;
}

// ── Course switcher ────────────────────────────────────────────────────────────
function buildCourseSwitcher() {
  const current = activeCourse?.label || "Select course";
  const opts = courseList.map(c =>
    `<option value="${esc(c.value)}" ${activeCourse?.value === c.value ? "selected" : ""}>${esc(c.label)}</option>`
  ).join("");
  return `
  <div class="course-switcher">
    <span class="cs-icon">🎓</span>
    <select class="select cs-select" id="course-switcher">
      ${opts}
    </select>
  </div>`;
}

// ── Filters ────────────────────────────────────────────────────────────────────
function buildFilters() {
  const facultyOpts = faculties.map(f =>
    `<option value="${esc(f)}" ${filters.faculty === f ? "selected" : ""}>${esc(f)}</option>`
  ).join("");

  // Module chips — only non-zero modules
  const chipHtml = isSkillsCourse
    ? `<span class="skills-note">Skills course — filter by faculty above</span>`
    : moduleNums.map(n =>
        `<span class="chip ${filters.modules.has(n) ? "active" : ""}" data-mod="${n}">Mod ${n}</span>`
      ).join("") +
      (hasExamItems
        ? `<span class="chip exam-chip ${filters.showExam ? "active" : ""}" data-action="toggle-exam">📋 Exam</span>`
        : "") +
      (filters.modules.size > 0 || filters.showExam
        ? `<span class="chip clear" data-action="clear-mods">✕ Clear</span>` : "");

  return `
  <div class="filters">
    <div class="filter-row">
      <span class="filter-label">Search</span>
      <input class="input" id="f-search" placeholder="Material name…" value="${esc(filters.search)}"/>
    </div>
    <div class="filter-row">
      <span class="filter-label">Faculty</span>
      <select class="select" id="f-faculty">
        <option value="">All faculty</option>
        ${facultyOpts}
      </select>
    </div>
    ${!isSkillsCourse || hasExamItems ? `
    <div class="filter-row">
      <span class="filter-label">Module</span>
      <div class="module-chips" id="module-chips">${chipHtml}</div>
    </div>` : `
    <div class="filter-row">
      <span class="filter-label">Module</span>
      <div class="module-chips"><span class="skills-note">Skills course — use faculty filter</span></div>
    </div>`}
    <div class="filter-row">
      <span class="filter-label">Sort</span>
      <select class="select" id="f-sort">
        <option value="default"  ${filters.sort === "default"  ? "selected" : ""}>Default order</option>
        <option value="latest"   ${filters.sort === "latest"   ? "selected" : ""}>Latest first</option>
        <option value="oldest"   ${filters.sort === "oldest"   ? "selected" : ""}>Oldest first</option>
      </select>
    </div>
  </div>`;
}

// ── List ───────────────────────────────────────────────────────────────────────
function buildList() {
  if (!allMaterials.length) return `
    <div class="empty">
      <div class="empty-ico">📂</div>
      <div class="empty-t">No materials yet</div>
      <div class="empty-d">Click Scan on the VTOP Course Page</div>
    </div>`;
  if (!filtered.length) return `
    <div class="empty">
      <div class="empty-ico">🔎</div>
      <div class="empty-t">No matches</div>
      <div class="empty-d">Try a different filter</div>
    </div>`;

  // Separate exam materials (mod 0) from regular in the rendered list
  const examItems    = filtered.filter(m => m.moduleNumbers.length > 0 && m.moduleNumbers.every(n => n === 0));
  const regularItems = filtered.filter(m => !examItems.includes(m));

  let html = "";
  if (regularItems.length) html += regularItems.map(itemRow).join("");
  if (examItems.length) {
    html += `<div class="exam-section-header">📋 Exam Materials</div>`;
    html += examItems.map(itemRow).join("");
  }

  return `<div class="list" id="mat-list">${html}</div>`;
}

function itemRow(item) {
  const tag      = docTag(item.docType);
  const isExam   = item.moduleNumbers.length > 0 && item.moduleNumbers.every(n => n === 0);
  const modLabel = isExam
    ? ""
    : item.moduleNumbers.length
      ? `<span class="item-modules">Mod ${item.moduleNumbers.join(",")}</span>`
      : "";

  return `
  <div class="item ${checked.has(item.fileName) ? "checked" : ""}" data-fn="${esc(item.fileName)}">
    <div class="chk-box">${checked.has(item.fileName) ? "✓" : ""}</div>
    <div class="item-body">
      <div class="item-name" title="${esc(item.materialName)}">${esc(item.materialName)}</div>
      <div class="item-meta">
        <span class="tag ${tag.cls}">${tag.label}</span>
        ${modLabel}
        <span class="item-faculty">· ${esc(item.facultyName)}</span>
        ${item.uploadDate ? `<span class="item-date">${esc(item.uploadDate)}</span>` : ""}
      </div>
    </div>
  </div>`;
}

// ── Progress page ──────────────────────────────────────────────────────────────
function buildProgress() {
  const total    = stats.total || 1;
  const done     = stats.done + stats.failed;
  const pct      = Math.round((done / total) * 100);
  const complete = done >= stats.total && stats.total > 0;
  return `
  <div class="progress-wrap">
    <div class="prog-header">
      <div>
        <div class="prog-title">${complete ? "✅ Done!" : "Downloading…"}</div>
        <div class="prog-sub">${done} of ${stats.total} files</div>
      </div>
      ${!complete ? `<div class="spin"></div>` : ""}
    </div>
    <div class="prog-stats">
      <div class="stat s-total"><div class="stat-n">${stats.total}</div><div class="stat-l">Total</div></div>
      <div class="stat s-done"><div class="stat-n">${stats.done}</div><div class="stat-l">Done</div></div>
      <div class="stat s-fail"><div class="stat-n">${stats.failed}</div><div class="stat-l">Failed</div></div>
    </div>
    <div class="prog-bar-wrap">
      <div class="prog-bar-track"><div class="prog-bar-fill" style="width:${pct}%"></div></div>
      <div class="prog-pct"><span>${pct}%</span><span>${done} done</span></div>
    </div>
    <div class="prog-log" id="prog-log">${logs.slice(-60).map(buildLogLine).join("")}</div>
    <div class="prog-actions">
      ${complete
        ? `<button class="btn btn-ghost" id="back-btn" style="flex:1">← Back</button>
           ${stats.failed > 0 ? `<button class="btn btn-primary" id="retry-btn">↺ Retry</button>` : ""}`
        : `<button class="btn btn-danger" id="cancel-btn" style="flex:1">✕ Cancel</button>`}
    </div>
  </div>`;
}

function buildLogLine(l) {
  const ic  = { start:"→", done:"✓", fail:"✗", retry:"↺", info:"·", cancel:"⊘" }[l.t] || "·";
  const cls = { done:"ok", fail:"er", retry:"wa" }[l.t] || "";
  return `
  <div class="log-line">
    <span class="log-ic">${ic}</span>
    <span class="log-msg">
      <span class="${cls}">[${l.t.toUpperCase()}]</span>
      <span class="hl"> ${esc(l.name)}</span>
      ${l.extra ? `<span> — ${esc(l.extra)}</span>` : ""}
    </span>
  </div>`;
}

// ── Attach all listeners ───────────────────────────────────────────────────────
function attachAll() {
  // Scan
  document.getElementById("scan-btn")?.addEventListener("click", doScan);

  // Course switcher
  document.getElementById("course-switcher")?.addEventListener("change", async e => {
    const val = e.target.value;
    if (!val || val === activeCourse?.value) return;
    await doSwitchCourse(val);
  });

  // Filters
  document.getElementById("f-search")?.addEventListener("input", e => {
    filters.search = e.target.value;
    applyFilters();
    render();
  });

  document.getElementById("f-faculty")?.addEventListener("change", e => {
    filters.faculty = e.target.value;
    applyFilters();
    render();
  });

  document.getElementById("f-sort")?.addEventListener("change", e => {
    filters.sort = e.target.value;
    applyFilters();
    render();
  });

  // Module chips — single delegated listener
  document.getElementById("module-chips")?.addEventListener("click", e => {
    const chip = e.target.closest(".chip");
    if (!chip) return;

    const action = chip.dataset.action;

    if (action === "clear-mods") {
      filters.modules  = new Set();
      filters.showExam = false;
      applyFilters();
      render();
      return;
    }

    if (action === "toggle-exam") {
      filters.showExam = !filters.showExam;
      applyFilters();
      render();
      return;
    }

    const mod = Number(chip.dataset.mod);
    if (isNaN(mod)) return;
    if (filters.modules.has(mod)) filters.modules.delete(mod);
    else filters.modules.add(mod);
    applyFilters();
    render();
  });

  // Select / deselect all
  document.getElementById("chk-all")?.addEventListener("click", () => {
    const allSel = filtered.every(i => checked.has(i.fileName));
    if (allSel) filtered.forEach(i => checked.delete(i.fileName));
    else        filtered.forEach(i => checked.add(i.fileName));
    render();
  });

  // Row toggle — delegated
  document.getElementById("mat-list")?.addEventListener("click", e => {
    const row = e.target.closest(".item");
    if (!row) return;
    const fn = row.dataset.fn;
    if (checked.has(fn)) checked.delete(fn);
    else checked.add(fn);
    render();
  });

  // Download
  document.getElementById("dl-btn")?.addEventListener("click", doDownload);

  // Progress
  document.getElementById("cancel-btn")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "CANCEL_QUEUE" });
    logs.push({ t: "cancel", name: "Cancelled", extra: "" });
    isDownloading = false;
    render();
  });

  document.getElementById("back-btn")?.addEventListener("click", () => {
    isDownloading = false;
    stats = { total: 0, done: 0, failed: 0 };
    logs  = [];
    render();
  });

  document.getElementById("retry-btn")?.addEventListener("click", async () => {
    const failNames   = new Set(logs.filter(l => l.t === "fail").map(l => l.name));
    const failedItems = allMaterials.filter(m => failNames.has(m.materialName));
    if (!failedItems.length) return;
    stats = { total: failedItems.length, done: 0, failed: 0 };
    logs  = [{ t: "info", name: `Retrying ${failedItems.length} items`, extra: "" }];
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.runtime.sendMessage({ action: "START_QUEUE", items: failedItems, tabId: tab.id });
    render();
  });

  // Scroll log
  const log = document.getElementById("prog-log");
  if (log) log.scrollTop = log.scrollHeight;
}

// ── Filter + sort logic ────────────────────────────────────────────────────────
function applyFilters() {
  const hasModuleFilter = filters.modules.size > 0 || filters.showExam;

  filtered = allMaterials.filter(m => {
    if (filters.search) {
      if (!m.materialName.toLowerCase().includes(filters.search.toLowerCase())) return false;
    }
    if (filters.faculty && m.facultyName !== filters.faculty) return false;

    if (hasModuleFilter) {
      const isExam = m.moduleNumbers.length > 0 && m.moduleNumbers.every(n => n === 0);
      if (isExam) {
        if (!filters.showExam) return false;
      } else {
        if (filters.modules.size > 0 && !m.moduleNumbers.some(n => filters.modules.has(n))) return false;
        // If only showExam is active and not modules, hide non-exam items? No — show both if modules selected
        if (filters.modules.size === 0 && filters.showExam && !isExam) return false;
      }
    }

    return true;
  });

  // Sort
  if (filters.sort === "latest") {
    filtered.sort((a, b) => b.uploadTimestamp - a.uploadTimestamp);
  } else if (filters.sort === "oldest") {
    filtered.sort((a, b) => a.uploadTimestamp - b.uploadTimestamp);
  }
  // default: keep original scrape order
}

// ── Actions ────────────────────────────────────────────────────────────────────
async function doScan() {
  isScanning = true;
  scanError  = "";
  render();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error("No active tab");

    try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] }); }
    catch (_) {}

    const pong = await msgTab(tab.id, { action: "PING" });
    if (!pong?.pong) throw new Error("Not on VTOP Course Page.");

    const res = await msgTab(tab.id, { action: "SCRAPE" });
    if (!res?.success) throw new Error(res?.error || "Scrape failed");

    allMaterials  = res.materials || [];
    courseList    = res.courses   || [];
    activeCourse  = res.activeCourse || null;

    if (!allMaterials.length) throw new Error(res.error || "No materials. Select a course first.");

    buildMetadata();
    filters  = { search: "", faculty: "", modules: new Set(), showExam: false, sort: "default" };
    applyFilters();
    checked  = new Set(filtered.map(m => m.fileName));
    scanError = "";
  } catch (err) {
    scanError    = err.message;
    allMaterials = [];
    filtered     = [];
  }

  isScanning = false;
  onVtop     = true;
  render();
}

async function doSwitchCourse(value) {
  isSwitching = true;
  render();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error("No active tab");

    // Tell content script to change the dropdown
    const sw = await msgTab(tab.id, { action: "SWITCH_COURSE", value });
    if (!sw?.success) throw new Error("Could not switch course");

    // Wait for VTOP's AJAX to reload the table — poll until rows change or timeout
    let attempts = 0;
    let newMats  = [];
    while (attempts < 15) {
      await delay(1000);
      const res = await msgTab(tab.id, { action: "SCRAPE" });
      if (res?.success && res.materials?.length) {
        // Check if data actually changed (different course)
        const firstCode = res.materials[0]?.courseCode;
        const oldCode   = allMaterials[0]?.courseCode;
        if (firstCode !== oldCode || attempts > 5) {
          newMats      = res.materials;
          courseList   = res.courses  || courseList;
          activeCourse = res.activeCourse || { value, label: courseList.find(c => c.value === value)?.label || value };
          break;
        }
      }
      attempts++;
    }

    if (!newMats.length) throw new Error("Course switched but no materials loaded yet. Try scanning manually.");

    allMaterials = newMats;
    buildMetadata();
    filters  = { search: "", faculty: "", modules: new Set(), showExam: false, sort: "default" };
    applyFilters();
    checked  = new Set(filtered.map(m => m.fileName));
    scanError = "";
  } catch (err) {
    scanError = err.message;
  }

  isSwitching = false;
  render();
}

async function doDownload() {
  const toDownload = filtered.filter(m => checked.has(m.fileName));
  if (!toDownload.length) { toast("No files selected"); return; }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { toast("No active tab"); return; }

  stats = { total: toDownload.length, done: 0, failed: 0 };
  logs  = [{ t: "info", name: `Queuing ${toDownload.length} files…`, extra: "" }];
  isDownloading = true;
  render();

  chrome.runtime.sendMessage({ action: "START_QUEUE", items: toDownload, tabId: tab.id });
}

// ── Build metadata from scraped materials ──────────────────────────────────────
function buildMetadata() {
  faculties = [...new Set(allMaterials.map(m => m.facultyName).filter(Boolean))].sort();

  // Module 0 = exam items
  hasExamItems = allMaterials.some(m => m.moduleNumbers.some(n => n === 0));

  // Non-zero module numbers
  const mods = new Set();
  allMaterials.forEach(m => m.moduleNumbers.filter(n => n > 0).forEach(n => mods.add(n)));
  moduleNums = [...mods].sort((a, b) => a - b);

  // Detect skills course — by course code OR faculty names
  const code = allMaterials[0]?.courseCode || "";
  const isSkillsCode    = SKILLS_CODES.some(s => code.toUpperCase().includes(s));
  const isSkillsFaculty = faculties.some(f =>
    SKILLS_FACULTY.some(sf => f.toLowerCase().includes(sf))
  );
  isSkillsCourse = isSkillsCode || isSkillsFaculty;
}

// ── Background listener ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener(msg => {
  if (msg.stats) stats = { ...stats, ...msg.stats };

  if (msg.action === "ITEM_START") {
    logs.push({ t: "start", name: msg.item.materialName, extra: `${msg.queued} queued` });
  } else if (msg.action === "ITEM_DONE") {
    logs.push({ t: "done", name: msg.item.materialName, extra: "" });
  } else if (msg.action === "ITEM_FAIL") {
    logs.push({ t: "fail", name: msg.item.materialName, extra: msg.error });
  } else if (msg.action === "DONE") {
    logs.push({ t: "info", name: "All done!", extra: "" });
    isDownloading = true;
  } else {
    return;
  }

  render();
});

// ── Helpers ────────────────────────────────────────────────────────────────────
function checkedCount() {
  return filtered.filter(m => checked.has(m.fileName)).length;
}

function msgTab(tabId, msg) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, msg, res => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(res);
    });
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function esc(s) {
  return (s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function docTag(type) {
  const t = (type || "").toLowerCase();
  if (t.includes("pdf")) return { cls:"tag-pdf", label:"PDF" };
  if (t.includes("doc")) return { cls:"tag-doc", label:"DOC" };
  if (t.includes("vid")) return { cls:"tag-vid", label:"VID" };
  return { cls:"tag-other", label: type || "FILE" };
}

let _toastTimer;
function toast(msg) {
  let el = document.querySelector(".toast");
  if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove("show"), 2500);
}

init();
