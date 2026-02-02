// ===== Gold Per Gram Overlay (Myntra + Ajio) =====
// - Compact pill by default; full details on hover (CSS)
// - Deal highlighting when perGram <= spot; Skip when perGram > spot
// - Auto refresh on PLP/search with SPA URL-change handling

const HOST = location.hostname;

// Site flags
const IS_MYNTRA = HOST.includes("myntra.com");
const IS_AJIO = HOST.includes("ajio.com");

// Requested regex update
const GRAMS_RE = /(\d+(?:\.\d+)?)\s*(g|gm|grams|Gms|gram|Gm|GM)\b/i;
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

// ---------- Router helpers ----------
function debounce(fn, wait = 350) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

// =====================
// MYNTRA
// =====================
function isMyntraPDP() { return location.pathname.includes("/buy"); }
function isMyntraGoldCoinPLP() { return location.pathname.startsWith("/gold-coin"); }

function getMyntraTileImageHost(tile) {
  return (
    tile.querySelector(".product-imageSliderContainer") ||
    tile.querySelector(".product-sliderContainer") ||
    tile.querySelector("a") ||
    tile
  );
}

function upsertTileBadgeOnHost(host, html, state) {
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

function upsertMyntraTileBadge(tile, html, state) {
  const host = getMyntraTileImageHost(tile);
  upsertTileBadgeOnHost(host, html, state);
}

function readMyntraTileData(tile) {
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

function buildBadgeHTML({ perGram, grams, price, karat, rate }) {
  // Compact-only when grams missing
  if (!grams || grams <= 0 || !perGram) {
    return {
      state: "neutral",
      html: `
        <div class="goldpg-compact">
          <span class="pg">₹?/g</span>
          <span class="kt">${karat ? karat + "K" : "K?"}</span>
          <span class="chip">CHECK</span>
        </div>
        <div class="goldpg-details">
          <div class="goldpg-row"><span class="goldpg-label">Price</span><span class="goldpg-value">${price ? formatMoney(price) : "—"}</span></div>
          <div class="goldpg-row"><span class="goldpg-label">Wt</span><span class="goldpg-value">not found</span></div>
        </div>
      `
    };
  }

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

    const delta = perGram - rate; // + expensive, - cheaper
    const cls = delta >= 0 ? "delta-pos" : "delta-neg";
    const sign = delta >= 0 ? "+" : "";

    detailsBlock = `
      <div class="goldpg-row"><span class="goldpg-label">Price</span><span class="goldpg-value">${formatMoney(price)}</span></div>
      <div class="goldpg-row"><span class="goldpg-label">Wt</span><span class="goldpg-value">${format2(grams)}g</span></div>
      <div class="goldpg-row"><span class="goldpg-label">Ref</span><span class="goldpg-value">${formatMoney(rate)}/g</span></div>
      <div class="goldpg-row"><span class="goldpg-label">Diff</span><span class="goldpg-value ${cls}">${sign}${formatMoney(delta)}/g</span></div>
    `;
  }

  return {
    state,
    html: `
      <div class="goldpg-compact">
        <span class="pg">${formatMoney(perGram)}/g</span>
        <span class="kt">${karat ? karat + "K" : "K?"}</span>
        <span class="chip">${chipText}</span>
      </div>
      <div class="goldpg-details">${detailsBlock}</div>
    `
  };
}

async function processMyntraPLP() {
  const cfg = await getConfig();
  const tiles = document.querySelectorAll("li.product-base");
  tiles.forEach((tile) => {
    const { price, grams, karat: kDetected } = readMyntraTileData(tile);
    if (!price) return;

    const { karat, rate } = chooseReferenceRate(cfg, kDetected);
    const perGram = grams ? price / grams : null;

    const badge = buildBadgeHTML({ perGram, grams, price, karat, rate });
    upsertMyntraTileBadge(tile, badge.html, badge.state);
  });
}

function upsertMyntraPdpBadge(html) {
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
  const perGram = grams ? price / grams : null;

  if (!grams || grams <= 0 || !perGram) {
    upsertMyntraPdpBadge(`
      <div class="goldpg-pdp-title">Gold per gram <span class="muted">(${karat ? karat + "K" : "K?"})</span></div>
      <div class="goldpg-pdp-row">Price: <b>${formatMoney(price)}</b></div>
      <div class="goldpg-pdp-row">Weight: <b>not found</b></div>
      <div class="goldpg-pdp-row muted">Open “Product Details” if needed</div>
    `);
    return;
  }

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

  upsertMyntraPdpBadge(`
    <div class="goldpg-pdp-title">${formatMoney(perGram)}/g <span class="muted">(${karat ? karat + "K" : "K?"})</span></div>
    <div class="goldpg-pdp-row">Price: <b>${formatMoney(price)}</b></div>
    <div class="goldpg-pdp-row">Weight: <b>${format2(grams)}g</b></div>
    ${compareHtml}
  `);
}

// =====================
// AJIO
// =====================
function isAjioPDP() {
  return /\/p\/\d+/.test(location.pathname) || document.querySelector(".prod-content");
}

function isAjioSearchPLP() {
  // Ajio search page is typically /search/?text=...
  return location.pathname.startsWith("/search/");
}

function getAjioTileHost(tile) {
  // best host: image holder so we don't cover content text
  return tile.querySelector(".imgHolder") || tile.querySelector("a") || tile;
}

function readAjioTileData(tile) {
  // Price: prefer Offer Price if present, else current price
  const offer = tile.querySelector(".offer-pricess-new");
  const strongPrice = tile.querySelector(".price strong");
  const rawOffer = getText(offer);       // e.g. "₹95,288" or "95,288"
  const rawStrong = getText(strongPrice); // e.g. "₹97,233"

  const price =
    parsePriceFromTextBlob(rawOffer) ??
    parsePriceFromTextBlob(rawStrong) ??
    parsePriceFromTextBlob(getText(tile));

  // grams + karat often in: nameCls, aria-label of <a>, alt of img
  const name = getText(tile.querySelector(".nameCls"));
  const brand = getText(tile.querySelector(".brand"));
  const a = tile.querySelector("a[aria-label]");
  const aria = a?.getAttribute("aria-label") || "";

  const img = tile.querySelector("img[alt]");
  const alt = img?.getAttribute("alt") || "";

  const blob = `${brand} ${name} ${aria} ${alt}`.trim();

  const grams = parseGrams(blob);
  const karat = parseKarat(blob);

  return { price, grams, karat };
}

async function processAjioPLP() {
  const cfg = await getConfig();

  // Ajio tiles: .rilrtl-products-list__item
  const tiles = document.querySelectorAll(".rilrtl-products-list__item");
  tiles.forEach((tile) => {
    const { price, grams, karat: kDetected } = readAjioTileData(tile);
    if (!price) return;

    const { karat, rate } = chooseReferenceRate(cfg, kDetected);
    const perGram = grams ? price / grams : null;

    const badge = buildBadgeHTML({ perGram, grams, price, karat, rate });

    const host = getAjioTileHost(tile);
    upsertTileBadgeOnHost(host, badge.html, badge.state);
  });
}

function upsertAjioPdpBadge(html) {
  // place badge near price area
  const anchor =
    document.querySelector(".prod-price-section") ||
    document.querySelector(".prod-content") ||
    document.body;

  let badge = document.getElementById("goldpg-ajio-pdp-badge");
  if (!badge) {
    badge = document.createElement("div");
    badge.id = "goldpg-ajio-pdp-badge";
    badge.className = "goldpg-pdp-badge";
    anchor.appendChild(badge);
  }
  badge.innerHTML = html;
}

async function processAjioPDP() {
  const cfg = await getConfig();

  const prod = document.querySelector(".prod-content");
  if (!prod) return;

  // Product name often includes " | 24 Kt (999) | 5.0 gm"
  const brand = getText(prod.querySelector(".brand-name"));
  const name = getText(prod.querySelector(".prod-name"));
  const blob = `${brand} ${name} ${getText(prod)}`;

  const grams = parseGrams(blob);
  const karatDetected = parseKarat(blob);

  // Price: prefer promo discounted (Get it for), else selling price
  const sp = document.querySelector(".prod-sp");
  const promo = document.querySelector(".promo-discounted-price span, .promo-discounted-price");
  const rawPromo = promo ? promo.textContent : "";
  const price =
    parsePriceFromTextBlob(rawPromo) ??
    parsePriceFromTextBlob(getText(sp)) ??
    parsePriceFromTextBlob(getText(prod));

  if (!price) return;

  const { karat, rate } = chooseReferenceRate(cfg, karatDetected);
  const perGram = grams ? price / grams : null;

  if (!grams || grams <= 0 || !perGram) {
    upsertAjioPdpBadge(`
      <div class="goldpg-pdp-title">Gold per gram <span class="muted">(${karat ? karat + "K" : "K?"})</span></div>
      <div class="goldpg-pdp-row">Price: <b>${formatMoney(price)}</b></div>
      <div class="goldpg-pdp-row">Weight: <b>not found</b></div>
      <div class="goldpg-pdp-row muted">Weight usually appears like “5.0 gm” in title</div>
    `);
    return;
  }

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

  upsertAjioPdpBadge(`
    <div class="goldpg-pdp-title">${formatMoney(perGram)}/g <span class="muted">(${karat ? karat + "K" : "K?"})</span></div>
    <div class="goldpg-pdp-row">Price: <b>${formatMoney(price)}</b></div>
    <div class="goldpg-pdp-row">Weight: <b>${format2(grams)}g</b></div>
    ${compareHtml}
  `);
}

// =====================
// Auto-refresh (Myntra PLP + Ajio Search)
// =====================
let __refreshTimer = null;
let __refreshKey = "";

async function setupAutoRefreshIfNeeded() {
  const cfg = await getConfig();

  const enabled = !!cfg.autoRefreshEnabled;
  let seconds = Number(cfg.refreshSeconds || 30);
  if (!Number.isFinite(seconds) || seconds < 5) seconds = 5;

  const onMyntraPLP = IS_MYNTRA && isMyntraGoldCoinPLP() && !isMyntraPDP();
  const onAjioPLP = IS_AJIO && isAjioSearchPLP() && !isAjioPDP();

  const should = enabled && (onMyntraPLP || onAjioPLP);

  const desiredKey = `${should ? "on" : "off"}:${seconds}:${location.pathname}:${location.search}`;
  if (desiredKey === __refreshKey) return;
  __refreshKey = desiredKey;

  if (__refreshTimer) {
    clearInterval(__refreshTimer);
    __refreshTimer = null;
  }
  if (!should) return;

  __refreshTimer = setInterval(() => {
    // Only reload when still on those pages
    if ((IS_MYNTRA && isMyntraGoldCoinPLP() && !isMyntraPDP()) ||
        (IS_AJIO && isAjioSearchPLP() && !isAjioPDP())) {
      location.reload();
    }
  }, seconds * 1000);
}

// =====================
// Main runner
// =====================
const run = debounce(() => {
  try {
    if (IS_MYNTRA) {
      if (isMyntraGoldCoinPLP()) processMyntraPLP();
      if (isMyntraPDP()) processMyntraPDP();
    }

    if (IS_AJIO) {
      if (isAjioSearchPLP()) processAjioPLP();
      if (isAjioPDP()) processAjioPDP();
    }

    setupAutoRefreshIfNeeded();
  } catch (e) {
    // keep silent to avoid breaking pages
  }
}, 400);

run();

// SPA URL change watcher
let __lastUrl = location.href;
setInterval(() => {
  if (location.href !== __lastUrl) {
    __lastUrl = location.href;
    __refreshKey = "";
    run();
  }
}, 700);

// DOM changes (Ajio & Myntra are dynamic)
const obs = new MutationObserver(run);
obs.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("scroll", run, { passive: true });

// Receive settings updates from popup
chrome.runtime?.onMessage?.addListener((msg) => {
  if (msg?.type === "GOLDPG_SETTINGS_UPDATED") {
    __refreshKey = "";
    run();
  }
});
