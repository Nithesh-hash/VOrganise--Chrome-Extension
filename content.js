// content.js — VOrganise
(function () {
  "use strict";

  function sanitize(str) {
    return (str || "").trim().replace(/[\/\\:*?"<>|]/g, "_").replace(/\s{2,}/g, " ").trim();
  }

  function extractModuleNumbers(text) {
    const matches = text.match(/\d+/g);
    return matches ? matches.map(Number) : [];
  }

  function parseUploaderCell(cell) {
    const lines = cell.innerText.split("\n").map(s => s.trim()).filter(Boolean);
    const raw   = lines[0] || "";
    const date  = lines[1] || "";
    const parts = raw.split(" - ");
    let name = raw;
    if (parts.length >= 2) {
      name = parts.slice(1, parts.length - 1).join(" - ").trim() || parts[1].trim();
    }
    return { raw, name: sanitize(name), date };
  }

  function parseMaterialCell(cell) {
    const text  = cell.innerText.trim();
    const lines = text.split("\n").map(s => s.trim()).filter(Boolean);
    const materialName = lines[0] || "Unknown";
    const secondLine   = lines[1] || "";
    const moduleMatch  = secondLine.match(/^([f\d,\s]+)\s*\((.+)\)/i);
    const moduleNumbers = moduleMatch ? extractModuleNumbers(moduleMatch[1]) : [];
    const docType = moduleMatch ? moduleMatch[2].trim() : "Document";
    return { materialName: sanitize(materialName), moduleNumbers, docType };
  }

  // ── Parse the "Select Registered Course" dropdown ──────────────────────────
  function scrapeCourseList() {
    const sel = document.querySelector("select#courseId, select[name='courseId'], select#registerCourseid, select");
    if (!sel) return [];
    return Array.from(sel.options)
      .filter(o => o.value && o.value !== "0" && o.value !== "")
      .map(o => ({ value: o.value, label: o.text.trim() }));
  }

  // ── Switch course dropdown and wait for table reload ──────────────────────
  function switchCourse(value) {
    const sel = document.querySelector("select#courseId, select[name='courseId'], select#registerCourseid, select");
    if (!sel) return false;
    sel.value = value;
    // Trigger change so VTOP fires its AJAX handler
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  // ── Main scraper ───────────────────────────────────────────────────────────
  function scrapeMaterials() {
    const tables = Array.from(document.querySelectorAll("table"));
    let targetTable = null;
    for (const tbl of tables) {
      const h = tbl.innerText.toLowerCase();
      if (h.includes("course detail") && h.includes("material detail") && h.includes("uploaded by")) {
        targetTable = tbl; break;
      }
    }
    if (!targetTable) return { materials: [], error: "Course Materials table not found." };
    const rows = targetTable.querySelectorAll("tbody tr");
    if (!rows.length) return { materials: [], error: "No rows found. Select a course first." };

    const results = [];
    rows.forEach((row, idx) => {
      const cells = row.querySelectorAll("td");
      if (cells.length < 4) return;
      const courseText  = cells[1]?.innerText.trim() || "";
      const materialCell = cells[2];
      const uploaderCell = cells[3];
      if (!materialCell || !uploaderCell) return;

      const courseLines   = courseText.split("\n").map(s => s.trim()).filter(Boolean);
      const semester      = courseLines[0] || "";
      const courseCodeLine = courseLines[1] || "";
      const codeMatch     = courseCodeLine.match(/^([A-Z0-9]+[L]?)\s*[-–]\s*(.+?)(?:\s*[-–]\s*TH)?$/i);
      const courseCode    = codeMatch ? codeMatch[1] : courseCodeLine.split(" ")[0];
      const courseName    = codeMatch ? codeMatch[2].trim() : courseCodeLine;

      const { materialName, moduleNumbers, docType } = parseMaterialCell(materialCell);
      const { name: facultyName, date: uploadDate }  = parseUploaderCell(uploaderCell);

      // Parse upload date into a sortable timestamp
      // Format from VTOP: "13-08-2025" (DD-MM-YYYY)
      let uploadTimestamp = 0;
      const dm = uploadDate.match(/(\d{2})-(\d{2})-(\d{4})/);
      if (dm) uploadTimestamp = new Date(`${dm[3]}-${dm[2]}-${dm[1]}`).getTime();

      results.push({
        rowNum: cells[0]?.innerText.trim() || String(idx + 1),
        rowIndex: idx,
        semester, courseCode, courseName,
        materialName, moduleNumbers, docType,
        facultyName, uploadDate, uploadTimestamp,
        fileName: `${materialName}.pdf`,
      });
    });

    return { materials: results, error: null };
  }

  // ── Download trigger ───────────────────────────────────────────────────────
  function triggerDownloadAtRow(rowIndex) {
    const tables = Array.from(document.querySelectorAll("table"));
    let targetTable = null;
    for (const tbl of tables) {
      const h = tbl.innerText.toLowerCase();
      if (h.includes("course detail") && h.includes("uploaded by")) { targetTable = tbl; break; }
    }
    if (!targetTable) return { success: false, error: "Table not found" };
    const rows = targetTable.querySelectorAll("tbody tr");
    const row  = rows[rowIndex];
    if (!row) return { success: false, error: `Row ${rowIndex} not found` };
    const cells = row.querySelectorAll("td");
    const downloadCell = cells[4] || cells[cells.length - 1];
    if (!downloadCell) return { success: false, error: "Download cell not found" };
    const anchor = downloadCell.querySelector("a, button");
    if (!anchor) return { success: false, error: "Download anchor not found" };
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return { success: true };
  }

  // ── Message listener ───────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "SCRAPE") {
      try {
        const result   = scrapeMaterials();
        const courses  = scrapeCourseList();
        // Find currently selected course label
        const sel = document.querySelector("select#courseId, select[name='courseId'], select#registerCourseid, select");
        const activeCourse = sel ? { value: sel.value, label: sel.options[sel.selectedIndex]?.text.trim() || "" } : null;
        sendResponse({ success: true, ...result, courses, activeCourse });
      } catch (err) {
        sendResponse({ success: false, error: err.message, materials: [], courses: [] });
      }
      return true;
    }

    if (msg.action === "SWITCH_COURSE") {
      try {
        const ok = switchCourse(msg.value);
        sendResponse({ success: ok });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return true;
    }

    if (msg.action === "TRIGGER_DOWNLOAD") {
      try { sendResponse(triggerDownloadAtRow(msg.rowIndex)); }
      catch (err) { sendResponse({ success: false, error: err.message }); }
      return true;
    }

    if (msg.action === "PING") {
      sendResponse({ pong: true, url: location.href });
      return true;
    }
  });

  chrome.runtime.sendMessage({ action: "TAB_READY", url: location.href }).catch(() => {});
})();
