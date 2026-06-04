// background.js — VOrganise
// Pure click-trigger queue. No download interception. VTOP handles the file itself.
"use strict";

let queue = [];
let isRunning = false;
let currentTabId = null;
let stats = { total: 0, done: 0, failed: 0 };

async function processNext() {
  if (queue.length === 0) {
    isRunning = false;
    broadcast({ action: "DONE", stats });
    return;
  }

  const item = queue.shift();
  broadcast({ action: "ITEM_START", item, queued: queue.length, stats });

  try {
    const result = await sendToTab(currentTabId, {
      action: "TRIGGER_DOWNLOAD",
      rowIndex: item.rowIndex,
    });

    if (result?.success) {
      await delay(1400); // give VTOP time to start the download
      stats.done++;
      broadcast({ action: "ITEM_DONE", item, queued: queue.length, stats });
    } else {
      stats.failed++;
      broadcast({ action: "ITEM_FAIL", item, error: result?.error || "Click failed", queued: queue.length, stats });
    }
  } catch (err) {
    stats.failed++;
    broadcast({ action: "ITEM_FAIL", item, error: err.message, queued: queue.length, stats });
  }

  await delay(700);
  processNext();
}

function sendToTab(tabId, msg) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, (res) => {
      if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
      else resolve(res || { success: false, error: "No response" });
    });
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function broadcast(msg) { chrome.runtime.sendMessage(msg).catch(() => {}); }

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "TAB_READY") currentTabId = sender.tab?.id;

  if (msg.action === "START_QUEUE") {
    queue = [...msg.items];
    stats = { total: queue.length, done: 0, failed: 0 };
    currentTabId = msg.tabId;
    isRunning = true;
    processNext();
    sendResponse({ success: true });
    return true;
  }

  if (msg.action === "CANCEL_QUEUE") {
    queue = [];
    isRunning = false;
    stats = { total: 0, done: 0, failed: 0 };
    sendResponse({ success: true });
    return true;
  }

  if (msg.action === "GET_STATUS") {
    sendResponse({ isRunning, queued: queue.length, stats });
    return true;
  }
});
