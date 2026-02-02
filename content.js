// ===== Myntra Gold Per Gram Overlay (PLP + PDP) =====
// - Compact pill by default; full details on hover (glass effect)
// - Deal highlighting when perGram <= spot; Skip when perGram > spot
// - Auto refresh on PLP with SPA URL-change handling

const IS_MYNTRA = location.hostname.includes("myntra.com");
if (!IS_MYNTRA) {}

// Requested regex update
const GRAMS_RE = /(\d+(?:\.\d+)?)\s*(g|gm|grams|Gms)\b/i;
const KARAT_RE = /\b(22|24)\s*(k|kt)\b/i;
const RS_RE = /\bRs\.?\s*([\d,]+)/i;
const INR_RE = /₹\s*([\d,]+)/i;

const DEFAULTS = {
  gold24: 0,
  gold22: 0,
  assumeKarat: "auto", // auto | "22" | "24"
  autoRefreshEnabled: true,
  refreshSeconds: 30
};

function getText(el) {
  return (el?.textContent || "").replace(/\s+/g, " ").trim();
}

function normalizeNumFromText(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/,/g, "");
  const m = cleaned.match(/[\d.]+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function parseGrams(text) {
  const m = text?.match(GRAMS_RE);
  if (!m) return null;
  return normalizeNumFromText(m[1]);
}

function parseKarat(text) {
  const m = text?.match(KARAT_RE);
  if (!m) return null;
  return Number(m[1]) === 22 ? 22 : 24;
}

function parsePriceFromTextBlob(text) {
  if (!text) return null;
  const inr = text.match(INR_RE);
  if (inr) return normalizeNumFromText(inr[1]);
  const rs = text.match(RS_RE);
  if (rs) return normalizeNumFromText(rs[1]);
  return null;
}

function formatMoney(n) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function format2(n) {
  return Number(n).toFixed(2);
}

async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULTS, resolve);
  });
}

function chooseReferenceRate(cfg, karatDetected) {
  let karat = karatDetected;
  if (cfg.assumeKarat === "22") karat = 22;
  if (cfg.assumeKarat === "24") karat = 24;

  const rate =
    karat === 24 ? Number(cfg.gold24 || 0) :
    karat === 22 ? Number(cfg.gold22 || 0) :
    0;

  return { karat, rate: rate > 0 ? rate : null };
}

// Router helpers
function isPDP() { return location.pathname.includes("/buy"); }
function isGoldCoinPLP() { return location.pathname.startsWith("/gold-coin"); }

// ----- PLP badge placement -----
function getTileImageHost(tile) {
  return (
    tile.querySelector(".product-imageSliderContainer") ||
    tile.querySelector(".product-sliderContainer") ||
    tile.querySelector("a") ||
    tile
  );
}

function upsertTileBadge(tile, html, state) {
  const host = getTileImageHost(tile);
  if (!host) return;

  host.classList.add("goldpg-img-host");

  let badge = host.querySelector(":scope > .goldpg-badge");
  if (!badge) {
    badge = document.createElement("div");
    badge.className = "goldpg-badge";
    host.appendChild(badge);
  }

  badge.classList.remove("deal", "over");
  if (state === "deal") badge.classList.add("deal");
  else if (state === "over") badge.classList.add("over");

  badge.innerHTML = html;
}

function readTileData(tile) {
  const discountedText = getText(tile.querySelector(".product-discountedPrice"));
  const priceBoxText = getText(tile.querySelector(".product-price"));
  const allTileText = getText(tile);

  const price =
    parsePriceFromTextBlob(discountedText) ??
    parsePriceFromTextBlob(priceBoxText) ??
    parsePriceFromTextBlob(allTileText);

  const nameText = getText(tile.querySelector(".product-product"));
  const brandText = getText(tile.querySelector(".product-brand"));

  const img = tile.querySelector("img[alt], img[title]");
  const imgText = (img?.getAttribute("alt") || "") + " " + (img?.getAttribute("title") || "");

  const blob = `${brandText} ${nameText} ${imgText}`.trim();

  const grams = parseGrams(blob);
  const karat = parseKarat(blob);

  return { price, grams, karat };
}

async function processMyntraPLP() {
  const cfg = await getConfig();
  const tiles = document.querySelectorAll("li.product-base");

  tiles.forEach((tile) => {
    const { price, grams, karat } = readTileData(tile);
    if (!price) return;

    const { karat: kFinal, rate } = chooseReferenceRate(cfg, karat);

    // Compact-only when grams missing
    if (!grams || grams <= 0) {
      upsertTileBadge(tile, `
        <div class="goldpg-compact">
          <span class="pg">₹?/g</span>
          <span class="kt">${kFinal ? kFinal + "K" : "K?"}</span>
          <span class="chip">CHECK</span>
        </div>
        <div class="goldpg-details">
          <div class="goldpg-row"><span class="goldpg-label">Price</span><span class="goldpg-value">${formatMoney(price)}</span></div>
          <div class="goldpg-row"><span class="goldpg-label">Wt</span><span class="goldpg-value">not found</span></div>
        </div>
      `, "neutral");
      return;
    }

    const perGram = price / grams;

    let state = "neutral";
    let chipText = "SET RATE";
    let detailsBlock = `
      <div class="goldpg-row"><span class="goldpg-label">Price</span><span class="goldpg-value">${formatMoney(price)}</span></div>
      <div class="goldpg-row"><span class="goldpg-label">Wt</span><span class="goldpg-value">${format2(grams)}g</span></div>
      <div class="goldpg-row"><span class="goldpg-label">Ref</span><span class="goldpg-value">Set in popup</span></div>
    `;

    if (rate) {
      state = perGram <= rate ? "deal" : "over";
      chipText = perGram <= rate ? "DEAL ✅" : "SKIP ❌";

      const delta = perGram - rate;
      const cls = delta >= 0 ? "delta-pos" : "delta-neg";
      const sign = delta >= 0 ? "+" : "";

      detailsBlock = `
        <div class="goldpg-row"><span class="goldpg-label">Price</span><span class="goldpg-value">${formatMoney(price)}</span></div>
        <div class="goldpg-row"><span class="goldpg-label">Wt</span><span class="goldpg-value">${format2(grams)}g</span></div>
        <div class="goldpg-row"><span class="goldpg-label">Ref</span><span class="goldpg-value">${formatMoney(rate)}/g</span></div>
        <div class="goldpg-row"><span class="goldpg-label">Diff</span><span class="goldpg-value ${cls}">${sign}${formatMoney(delta)}/g</span></div>
      `;
    }

    upsertTileBadge(tile, `
      <div class="goldpg-compact">
        <span class="pg">${formatMoney(perGram)}/g</span>
        <span class="kt">${kFinal ? kFinal + "K" : "K?"}</span>
        <span class="chip">${chipText}</span>
      </div>

      <div class="goldpg-details">
        ${detailsBlock}
      </div>
    `, state);
  });
}

// ----- PDP (kept as-is) -----
function upsertPdpBadge(html) {
  const anchor =
    document.querySelector(".pdp-price-info .pdp-discount-container") ||
    document.querySelector(".pdp-price-info") ||
    document.querySelector(".pdp-description-container");
  if (!anchor) return;

  let badge = document.getElementById("goldpg-pdp-badge");
  if (!badge) {
    badge = document.createElement("div");
    badge.id = "goldpg-pdp-badge";
    badge.className = "goldpg-pdp-badge";
    anchor.appendChild(badge);
  }
  badge.innerHTML = html;
}

async function processMyntraPDP() {
  const cfg = await getConfig();

  const nameText = getText(document.querySelector(".pdp-name"));
  const titleText = getText(document.querySelector(".pdp-title"));
  const detailsText = getText(document.querySelector(".pdp-product-description-content"));

  const blob = `${titleText} ${nameText} ${detailsText}`.trim();

  const grams = parseGrams(blob);
  const karatDetected = parseKarat(blob);

  const price =
    normalizeNumFromText(getText(document.querySelector(".pdp-price strong"))) ??
    parsePriceFromTextBlob(getText(document.body));

  if (!price) return;

  const { karat, rate } = chooseReferenceRate(cfg, karatDetected);

  if (!grams || grams <= 0) {
    upsertPdpBadge(`
      <div class="goldpg-pdp-title">Gold per gram <span class="muted">(${karat ? karat + "K" : "K?"})</span></div>
      <div class="goldpg-pdp-row">Price: <b>${formatMoney(price)}</b></div>
      <div class="goldpg-pdp-row">Weight: <b>not found</b></div>
      <div class="goldpg-pdp-row muted">Open “Product Details” if needed</div>
    `);
    return;
  }

  const perGram = price / grams;

  let compareHtml = `<div class="goldpg-pdp-row muted">Set 22K/24K ref rate in popup</div>`;
  if (rate) {
    const delta = perGram - rate;
    const cls = delta >= 0 ? "delta-pos" : "delta-neg";
    const sign = delta >= 0 ? "+" : "";
    const tag = perGram <= rate ? "DEAL ✅" : "SKIP ❌";

    compareHtml = `
      <div class="goldpg-pdp-row muted">
        Ref: ${formatMoney(rate)}/g • <span class="${cls}">${sign}${formatMoney(delta)}/g</span> • ${tag}
      </div>
    `;
  }

  upsertPdpBadge(`
    <div class="goldpg-pdp-title">${formatMoney(perGram)}/g <span class="muted">(${karat ? karat + "K" : "K?"})</span></div>
    <div class="goldpg-pdp-row">Price: <b>${formatMoney(price)}</b></div>
    <div class="goldpg-pdp-row">Weight: <b>${format2(grams)}g</b></div>
    ${compareHtml}
  `);
}

// =====================
// Auto-refresh (working) + SPA handling
// =====================

function debounce(fn, wait = 350) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

let __goldpgRefreshTimer = null;
let __goldpgRefreshKey = "";

async function setupAutoRefreshIfNeeded() {
  if (!IS_MYNTRA) return;

  const onPLP = isGoldCoinPLP() && !isPDP();
  const cfg = await getConfig();

  const enabled = !!cfg.autoRefreshEnabled && onPLP;
  let seconds = Number(cfg.refreshSeconds || 30);
  if (!Number.isFinite(seconds) || seconds < 5) seconds = 5;

  const desiredKey = `${enabled ? "on" : "off"}:${seconds}:${location.pathname}`;
  if (desiredKey === __goldpgRefreshKey) return;
  __goldpgRefreshKey = desiredKey;

  if (__goldpgRefreshTimer) {
    clearInterval(__goldpgRefreshTimer);
    __goldpgRefreshTimer = null;
  }

  if (!enabled) return;

  __goldpgRefreshTimer = setInterval(() => {
    if (isGoldCoinPLP() && !isPDP()) location.reload();
  }, seconds * 1000);
}

const run = debounce(() => {
  if (!IS_MYNTRA) return;
  if (isGoldCoinPLP()) processMyntraPLP();
  if (isPDP()) processMyntraPDP();
  setupAutoRefreshIfNeeded();
}, 400);

run();

let __goldpgLastUrl = location.href;
setInterval(() => {
  if (location.href !== __goldpgLastUrl) {
    __goldpgLastUrl = location.href;
    __goldpgRefreshKey = "";
    run();
  }
}, 700);

const obs = new MutationObserver(run);
obs.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("scroll", run, { passive: true });

chrome.runtime?.onMessage?.addListener((msg) => {
  if (msg?.type === "GOLDPG_SETTINGS_UPDATED") {
    __goldpgRefreshKey = "";
    run();
  }
});
