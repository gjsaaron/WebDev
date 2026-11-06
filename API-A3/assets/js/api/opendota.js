const BASE_URL = "https://api.opendota.com/api";
const CACHE_PREFIX = "draftArena:api:";
const CACHE_TTL = 6 * 60 * 60 * 1000;

const EXPECTED_SIZES = {
  heroStats: 165000,
  hero_abilities: 170000,
  abilities: 1340000
};

function readCache(key) {
  try {
    const item = JSON.parse(localStorage.getItem(CACHE_PREFIX + key));
    if (item && Date.now() - item.savedAt < CACHE_TTL) return item.data;
  } catch { /* Ignore invalid or unavailable cache. */ }
  return null;
}

function writeCache(key, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch { /* Storage can be full or disabled. */ }
}

async function fetchWithProgress(url, sizeKey, onProgress) {
  let timer = null;
  let simulatedPct = 12;

  if (onProgress) {
    onProgress(simulatedPct, "Connecting to OpenDota API...");
    timer = setInterval(() => {
      if (simulatedPct < 85) {
        simulatedPct += Math.floor(Math.random() * 8) + 4;
        onProgress(Math.min(85, simulatedPct), "Receiving stream chunks...");
      }
    }, 150);
  }

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const headerLen = response.headers.get("content-length");
    const total = headerLen ? parseInt(headerLen, 10) : (EXPECTED_SIZES[sizeKey] || 165000);

    let data;
    if (response.body && typeof response.body.getReader === "function") {
      try {
        const reader = response.body.getReader();
        const chunks = [];
        let received = 0;
        if (timer) clearInterval(timer);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          if (onProgress) {
            const pct = Math.min(97, Math.max(simulatedPct, Math.round((received / total) * 100)));
            const kb = Math.round(received / 1024);
            const totalKb = Math.round(total / 1024);
            onProgress(pct, `${kb} KB / ${totalKb} KB`);
          }
        }

        const allChunks = new Uint8Array(received);
        let pos = 0;
        for (const chunk of chunks) {
          allChunks.set(chunk, pos);
          pos += chunk.length;
        }
        const text = new TextDecoder("utf-8").decode(allChunks);
        data = JSON.parse(text);
      } catch (streamErr) {
        console.warn("Streaming reader fallback:", streamErr);
        data = await response.json();
      }
    } else {
      data = await response.json();
    }

    if (timer) clearInterval(timer);
    if (onProgress) onProgress(100, "Processing complete");
    return data;
  } catch (err) {
    if (timer) clearInterval(timer);
    throw err;
  }
}

export async function fetchHeroStats({ forceRefresh = false, onProgress = null } = {}) {
  const cacheKey = "heroStats";
  if (!forceRefresh) {
    const cached = readCache(cacheKey);
    if (cached) {
      if (onProgress) onProgress(100, "Loaded from cache");
      return { data: cached, cached: true, source: "cache" };
    }
  }

  const data = await fetchWithProgress(`${BASE_URL}/heroStats`, "heroStats", onProgress);
  if (!Array.isArray(data)) throw new Error("Unexpected hero data received from OpenDota.");
  writeCache(cacheKey, data);
  return { data, cached: false, source: "opendota" };
}

export async function fetchHeroAbilitiesMap({ forceRefresh = false, onProgress = null } = {}) {
  const cacheKey = "heroAbilitiesMap";
  if (!forceRefresh) {
    const cached = readCache(cacheKey);
    if (cached) {
      if (onProgress) onProgress(100, "Loaded from cache");
      return { data: cached, cached: true, source: "cache" };
    }
  }

  let haProgress = 0;
  let aProgress = 0;

  const updateCombinedProgress = () => {
    if (!onProgress) return;
    const combined = Math.round(haProgress * 0.2 + aProgress * 0.8);
    onProgress(combined, `Abilities: ${combined}%`);
  };

  const [ha, a] = await Promise.all([
    fetchWithProgress(`${BASE_URL}/constants/hero_abilities`, "hero_abilities", (pct) => {
      haProgress = pct;
      updateCombinedProgress();
    }),
    fetchWithProgress(`${BASE_URL}/constants/abilities`, "abilities", (pct) => {
      aProgress = pct;
      updateCombinedProgress();
    })
  ]);

  const compact = {};
  for (const [heroName, data] of Object.entries(ha)) {
    compact[heroName] = (data.abilities || [])
      .filter(k => k && k !== "generic_hidden")
      .map(k => {
        const item = a[k];
        if (!item) return null;
        return {
          key: k,
          name: item.dname || k,
          desc: item.desc || "",
          img: item.img ? `https://cdn.cloudflare.steamstatic.com${item.img}` : "",
          dmg: item.dmg_type || "",
          cd: Array.isArray(item.cd) ? item.cd.join("/") : (item.cd || ""),
          mc: Array.isArray(item.mc) ? item.mc.join("/") : (item.mc || ""),
          behavior: Array.isArray(item.behavior) ? item.behavior.join(", ") : (item.behavior || "")
        };
      })
      .filter(Boolean);
  }

  writeCache(cacheKey, compact);
  if (onProgress) onProgress(100, "Abilities ready");
  return { data: compact, cached: false, source: "ready" };
}
