const gold24El = document.getElementById("gold24");
const gold22El = document.getElementById("gold22");
const assumeKaratEl = document.getElementById("assumeKarat");
const autoRefreshEnabledEl = document.getElementById("autoRefreshEnabled");
const refreshSecondsEl = document.getElementById("refreshSeconds");
const statusEl = document.getElementById("status");

const DEFAULTS = {
  gold24: 0,
  gold22: 0,
  assumeKarat: "auto",
  autoRefreshEnabled: true,
  refreshSeconds: 30
};

function setStatus(msg) {
  statusEl.textContent = msg;
  setTimeout(() => (statusEl.textContent = ""), 2000);
}

function load() {
  chrome.storage.sync.get(DEFAULTS, (cfg) => {
    gold24El.value = cfg.gold24 || "";
    gold22El.value = cfg.gold22 || "";
    assumeKaratEl.value = cfg.assumeKarat || "auto";
    autoRefreshEnabledEl.checked = !!cfg.autoRefreshEnabled;
    refreshSecondsEl.value = cfg.refreshSeconds ?? 30;
  });
}

function save() {
  const gold24 = Number(gold24El.value || 0);
  const gold22 = Number(gold22El.value || 0);

  let refreshSeconds = Number(refreshSecondsEl.value || DEFAULTS.refreshSeconds);
  if (!Number.isFinite(refreshSeconds) || refreshSeconds < 5) refreshSeconds = 5;

  const assumeKarat = assumeKaratEl.value;
  const autoRefreshEnabled = !!autoRefreshEnabledEl.checked;

  chrome.storage.sync.set(
    { gold24, gold22, assumeKarat, autoRefreshEnabled, refreshSeconds },
    () => {
      setStatus("Saved ✅");
      // Ask active tab to re-run immediately (content script listens)
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs?.[0]?.id;
        if (!tabId) return;
        chrome.tabs.sendMessage(tabId, { type: "GOLDPG_SETTINGS_UPDATED" });
      });
    }
  );
}

function reloadActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs?.[0]?.id;
    if (!tabId) return;
    chrome.tabs.reload(tabId);
  });
}

document.getElementById("save").addEventListener("click", save);
document.getElementById("reloadTab").addEventListener("click", reloadActiveTab);

load();
