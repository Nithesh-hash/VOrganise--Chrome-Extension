# VOrganise — VTOP Course Material Downloader

Smart Chrome extension for VIT students to filter, select, and batch-download course materials from VTOP.

## What's New in v2

- ✅ **Fixed downloads** — triggers the actual VTOP download button via content script click simulation
- 🔍 **Search by material name** — type anything to filter the list
- 👩‍🏫 **Filter by faculty** — dropdown with all detected faculty names
- 📦 **Filter by module number** — click chips (Mod 1, Mod 2 …) to show only those modules
- 📁 **Folder naming** — enter a folder name before downloading; files go to `Downloads/<your folder name>/`
- 🎯 **Dynamic download button** — shows exact count of currently selected (filtered) files
- ⬜ **White UI** — clean, professional light interface

## Install

1. Unzip `vorganise.zip`
2. Go to `chrome://extensions/`
3. Enable **Developer mode**
4. Click **Load unpacked** → select `vorganise` folder

## How to Use

1. Log into **VTOP** → go to **Course Page - view**
2. Select your registered course from the dropdown
3. Wait for course materials to load in the table
4. Click the **VOrganise** extension icon
5. Click **Scan Page** — all materials appear with faculty & module info
6. **Filter**: use Search, Faculty dropdown, or Module chips
7. **Select**: check/uncheck items, or use "Select all"
8. **Name your folder**: type a folder name (e.g. `Data Science Sem7`)
9. Click **Download (N)** — VTOP will download each selected file

## Folder output

Files download to `Downloads/<your folder name>/` in Chrome's default download location.

## Notes on downloads

VTOP generates download links dynamically via JavaScript onclick handlers. The extension simulates real user clicks on each download button in sequence (1.2s apart) to avoid being blocked. This means:
- A Chrome "Save As" or download prompt may appear per file (depending on your VTOP/Chrome settings)
- Files download one at a time to respect VTOP's server

## File structure

```
vorganise/
├── manifest.json
├── background.js      ← Queue manager (service worker)
├── content.js         ← Page scraper + download trigger
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js       ← Full UI
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```
