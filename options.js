const price24El = document.getElementById("price24");
const price22El = document.getElementById("price22");
const assumeKaratEl = document.getElementById("assumeKarat");
const statusEl = document.getElementById("status");

function load() {
  chrome.storage.sync.get(
    { gold24: 0, gold22: 0, assumeKarat: "auto" },
    (cfg) => {
      price24El.value = cfg.gold24 || "";
      price22El.value = cfg.gold22 || "";
      assumeKaratEl.value = cfg.assumeKarat || "auto";
    }
  );
}

function save() {
  const gold24 = Number(price24El.value || 0);
  const gold22 = Number(price22El.value || 0);
  const assumeKarat = assumeKaratEl.value;

  chrome.storage.sync.set({ gold24, gold22, assumeKarat }, () => {
    statusEl.textContent = "Saved! Reload Myntra/Ajio tabs to apply.";
    setTimeout(() => (statusEl.textContent = ""), 2500);
  });
}

document.getElementById("save").addEventListener("click", save);
load();
