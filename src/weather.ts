// Weather for the calendar: daily forecast at home (Open-Meteo, 16 days) and
// hourly weather at an event's own location (Nominatim geocode → Open-Meteo).
const PID = 'family-calendar';
const sdk = () => (window as any).__HS_SDK__;

export type DayWx = { code: number; hi: number; lo: number; pop: number };
export type PointWx = { code: number; temp: number; pop: number };
export type Geo = { lat: number; lon: number; town: string };

/** WMO weather code → emoji + words. */
export function wmo(code: number, night = false): { icon: string; label: string } {
  if (code === 0) return night ? { icon: '🌙', label: 'Clear' } : { icon: '☀️', label: 'Sunny' };
  if (code <= 2) return { icon: night ? '☁️' : '⛅', label: 'Partly cloudy' };
  if (code === 3) return { icon: '☁️', label: 'Cloudy' };
  if (code === 45 || code === 48) return { icon: '🌫️', label: 'Fog' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: '❄️', label: 'Snow' };
  if (code >= 95) return { icon: '⛈️', label: 'Thunderstorms' };
  if (code >= 51 && code <= 57) return { icon: '🌦️', label: 'Drizzle' };
  if (code >= 61) return { icon: '🌧️', label: 'Rain' };
  return { icon: '☁️', label: 'Cloudy' };
}

async function getJson(url: string, ttl: number) {
  const r: Response = await sdk().pluginFetch(PID, { url, cacheTtlMs: ttl });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

let dailyCache: { key: string; at: number; v: Map<string, DayWx> } | null = null;
export async function homeDaily(lat: number, lon: number, tz: string): Promise<Map<string, DayWx>> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (dailyCache && dailyCache.key === key && Date.now() - dailyCache.at < 1800000) return dailyCache.v;
  const j = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}`
    + `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=${encodeURIComponent(tz)}&forecast_days=16`, 1800000);
  const d = j.daily ?? {}; const m = new Map<string, DayWx>();
  (d.time ?? []).forEach((t: string, i: number) => m.set(t, { code: d.weather_code[i], hi: d.temperature_2m_max[i], lo: d.temperature_2m_min[i], pop: d.precipitation_probability_max?.[i] ?? 0 }));
  dailyCache = { key, at: Date.now(), v: m }; return m;
}

const hourlyCache = new Map<string, { at: number; v: any }>();
/** Weather at a place at a given time (within the next 16 days). */
export async function pointAt(lat: number, lon: number, tz: string, when: Date): Promise<PointWx | null> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  let h = hourlyCache.get(key);
  if (!h || Date.now() - h.at > 1800000) {
    const j = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}`
      + `&hourly=temperature_2m,weather_code,precipitation_probability&timezone=GMT&forecast_days=16`, 1800000);
    h = { at: Date.now(), v: j.hourly }; hourlyCache.set(key, h);
  }
  const times: string[] = h.v?.time ?? []; if (!times.length) return null;
  const target = when.getTime();
  let best = -1, bestD = Infinity;
  times.forEach((t, i) => { const d = Math.abs(Date.parse(t + ':00Z') - target); if (d < bestD) { bestD = d; best = i; } });
  if (best < 0 || bestD > 2 * 3600000) return null;
  return { code: h.v.weather_code[best], temp: h.v.temperature_2m[best], pop: h.v.precipitation_probability?.[best] ?? 0 };
}

const GEO_KEY = 'family-calendar:geo';
function geoStore(): Record<string, Geo | null> { try { return JSON.parse(localStorage.getItem(GEO_KEY) || '{}'); } catch { return {}; } }
/** Address → coordinates (cached forever on this display). Tries the full text, then just the town part. */
export async function geocode(q: string): Promise<Geo | null> {
  const k = q.trim().toLowerCase(); const store = geoStore();
  if (k in store) return store[k];
  const tries = [q, q.split(',').slice(-2).join(',').trim(), q.split(',').slice(-1)[0].trim()].filter((x, i, a) => x && a.indexOf(x) === i);
  let found: Geo | null = null;
  for (const t of tries) {
    try {
      const j = await getJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&countrycodes=ca&q=${encodeURIComponent(t)}`, 86400000);
      const r = j?.[0];
      if (r) { const a = r.address ?? {}; found = { lat: Number(r.lat), lon: Number(r.lon), town: a.city || a.town || a.village || a.municipality || a.county || '' }; break; }
    } catch { /* try the next form */ }
  }
  store[k] = found; try { localStorage.setItem(GEO_KEY, JSON.stringify(store)); } catch { /* ignore */ }
  return found;
}
