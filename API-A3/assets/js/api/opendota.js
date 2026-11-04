const BASE_URL = "https://api.opendota.com/api";
const CACHE_PREFIX = "draftArena:api:";
const CACHE_TTL = 6 * 60 * 60 * 1000;

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

export async function fetchHeroStats({ forceRefresh = false } = {}) {
  const cacheKey = "heroStats";
  if (!forceRefresh) {
    const cached = readCache(cacheKey);
    if (cached) return { data: cached, cached: true };
  }

  const response = await fetch(`${BASE_URL}/heroStats`);
  if (!response.ok) throw new Error(`OpenDota returned HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error("Unexpected hero data received from OpenDota.");
  writeCache(cacheKey, data);
  return { data, cached: false };
}

export async function fetchHeroAbilitiesMap({ forceRefresh = false } = {}) {
  const cacheKey = "heroAbilitiesMap";
  if (!forceRefresh) {
    const cached = readCache(cacheKey);
    if (cached) return { data: cached, cached: true };
  }

  const [haRes, aRes] = await Promise.all([
    fetch(`${BASE_URL}/constants/hero_abilities`),
    fetch(`${BASE_URL}/constants/abilities`)
  ]);

  if (!haRes.ok || !aRes.ok) {
    throw new Error("Failed to load hero abilities constants from OpenDota.");
  }

  const [ha, a] = await Promise.all([haRes.json(), aRes.json()]);

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
  return { data: compact, cached: false };
}
