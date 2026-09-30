// Family Calendar — day columns or a month grid where titles WRAP instead of being cut off.
// Nora's "Day 3 · Phys. Ed, …" events become a small "Day 3" badge in the day header.
import React from 'react';
import type { PluginComponentProps } from './hs-plugin';
import { frame, ink, useNow, dayKey, fmtTime, useBox } from './ui';
import { Ev, schoolDay, iconFor, tidyTitle, isOff, dayKeysOf, addDaysKey, dowOf } from './logic';

type Person = { name: string; color?: string; sourceIds?: string[] };
type Meta = { people: Person[] };
let metaCache: { at: number; v: Meta } | null = null;
const evCache = new Map<string, { at: number; v: Ev[] }>();

async function loadMeta(): Promise<Meta> {
  if (metaCache && Date.now() - metaCache.at < 600000) return metaCache.v;
  const c = await fetch('/api/config').then((r) => r.json());
  const v = { people: (c.settings?.calendar?.people ?? []) as Person[] };
  metaCache = { at: Date.now(), v }; return v;
}
async function loadEvents(from: string, to: string, fresh = false): Promise<Ev[]> {
  const url = `/api/calendar?timeMin=${encodeURIComponent(from + 'T00:00:00')}&timeMax=${encodeURIComponent(to + 'T23:59:59')}`;
  const hit = evCache.get(url);
  if (!fresh && hit && Date.now() - hit.at < 240000) return hit.v;
  const j = await fetch(url).then((r) => r.json());
  const v: Ev[] = Array.isArray(j) ? j : j.events ?? [];
  evCache.set(url, { at: Date.now(), v }); return v;
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function FamilyCalendar({ config, style, timezone: tz, ...rest }: PluginComponentProps & { timeFormat?: string }) {
  const tf = (rest as any).timeFormat;
  const now = useNow(60000);
  const today = dayKey(now, tz);
  const view = String(config.view ?? 'columns');
  const nDays = Math.max(1, Math.min(14, Number(config.days ?? 5)));
  const nWeeks = Math.max(1, Math.min(6, Number(config.weeks ?? 5)));
  const weekStart = Number(config.weekStart ?? 0);
  const accent = String(config.accentColor || '#f5c37e');
  const want = String(config.calendars ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const hideDayEvents = config.schoolDayBadge !== false;

  // Visible range
  const start = view === 'month' ? addDaysKey(today, -((dowOf(today) - weekStart + 7) % 7)) : today;
  const count = view === 'month' ? nWeeks * 7 : nDays;
  const days = Array.from({ length: count }, (_, i) => addDaysKey(start, i));
  const end = days[days.length - 1];

  const [meta, setMeta] = React.useState<Meta | null>(metaCache?.v ?? null);
  const [events, setEvents] = React.useState<Ev[] | null>(null);
  const [err, setErr] = React.useState(false);
  const tick = Math.floor(now.getTime() / 300000);
  React.useEffect(() => { let dead = false; (async () => {
    try {
      const [m, ev] = await Promise.all([loadMeta(), loadEvents(addDaysKey(start, -1), addDaysKey(end, 1))]);
      if (!dead) { setMeta(m); setEvents(ev); setErr(false); }
    } catch { if (!dead) setErr(true); }
  })(); return () => { dead = true; }; }, [start, end, tick]);

  // Person/colour per source
  const people = meta?.people ?? [];
  const personOf = (sid?: string) => people.find((p) => (p.sourceIds ?? []).includes(sid ?? ''));
  const colorOf = (e: Ev) => personOf(e.sourceId)?.color || e.calendarColor || accent;
  const matches = (e: Ev, w: string) => {
    const p = personOf(e.sourceId)?.name?.toLowerCase();
    const sid = String(e.sourceId ?? '').toLowerCase();
    return w === sid || w === p || (w === 'family' && sid.startsWith('family')) || (w === 'holidays' && sid === 'holidays');
  };
  // Tap a name in the legend to see only that calendar; resets by itself after a few minutes.
  const [only, setOnly] = React.useState<string | null>(null);
  React.useEffect(() => { if (!only) return; const t = setTimeout(() => setOnly(null), 180000); return () => clearTimeout(t); }, [only]);
  const allowed = (e: Ev) => (!want.length || want.some((w) => matches(e, w))) && (!only || matches(e, only));

  // Bucket by day
  const byDay = new Map<string, Ev[]>(); const badge = new Map<string, number>(); const off = new Set<string>();
  for (const e of (events ?? []).filter(allowed)) {
    const sd = schoolDay(e.title);
    for (const k of dayKeysOf(e, (d) => dayKey(d, tz))) {
      if (k < start || k > end) continue;
      if (sd != null && hideDayEvents) { badge.set(k, sd); continue; }
      if (isOff(e.title)) off.add(k);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k)!.push(e);
    }
  }
  for (const [, l] of byDay) l.sort((a, b) => (a.allDay === b.allDay ? +new Date(a.start) - +new Date(b.start) : a.allDay ? -1 : 1));

  const chips = [
    ...people.filter((p) => !want.length || want.includes(p.name.toLowerCase())).map((p) => ({ key: p.name.toLowerCase(), label: p.name, color: p.color || accent })),
    ...(!want.length || want.includes('family') ? [{ key: 'family', label: 'Family', color: (events ?? []).find((e) => String(e.sourceId).startsWith('family'))?.calendarColor || '#9ca3af' }] : []),
  ];
  const chip = (key: string | null, label: string, color?: string) => {
    const on = key === null ? only === null : only === key;
    return (
      <button key={label} onClick={() => setOnly(key === null || on ? null : key)} style={{ appearance: 'none', font: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4em',
        padding: '0.3em 0.8em', borderRadius: '999px', border: `0.1em solid ${on ? (color || accent) : 'transparent'}`, color: 'inherit',
        background: on ? `color-mix(in srgb, ${color || accent} 22%, transparent)` : ink(style, 0.06), opacity: only && !on ? 0.6 : 1, fontWeight: on ? 700 : 500 }}>
        {color && <span style={{ width: '0.65em', height: '0.65em', borderRadius: '50%', background: color }} />}{label}
      </button>
    );
  };
  const legend = config.showLegend !== false && chips.length > 1 && (
    <div style={{ display: 'flex', gap: '0.4em', flexWrap: 'wrap', fontSize: '0.66em', marginBottom: '0.5em' }}>
      {chip(null, 'All')}{chips.map((c) => chip(c.key, c.label, c.color))}
    </div>
  );

  const pill = (e: Ev, lines: number, size: string) => {
    const col = colorOf(e); const icon = iconFor(e.title, e.sourceId);
    const time = e.allDay ? '' : fmtTime(new Date(e.start), tz, tf).replace(':00', '').replace(/\s?([AP])M/i, (_, x) => x.toLowerCase());
    return (
      <div key={e.id + e.start} style={{ display: 'flex', gap: '0.3em', alignItems: 'flex-start', padding: '0.28em 0.4em', borderRadius: '0.4em', fontSize: size, lineHeight: 1.2,
        background: e.allDay ? `color-mix(in srgb, ${col} 20%, transparent)` : 'transparent', borderLeft: `0.22em solid ${col}` }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', wordBreak: 'normal', overflowWrap: 'anywhere' } as React.CSSProperties}>
          {icon && <span style={{ marginRight: '0.25em' }}>{icon}</span>}{time && <b style={{ fontWeight: 700, opacity: 0.8 }}>{time} </b>}{tidyTitle(e.title)}
        </span>
      </div>
    );
  };

  const header = (k: string, big: boolean) => {
    const isToday = k === today; const d = new Date(k + 'T12:00:00Z'); const b = badge.get(k);
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', rowGap: '0.2em', alignItems: 'baseline', gap: '0.35em', padding: big ? '0.35em 0.45em' : '0.2em 0.3em', borderRadius: '0.45em',
        background: isToday ? `color-mix(in srgb, ${accent} 26%, transparent)` : off.has(k) ? ink(style, 0.1) : 'transparent', marginBottom: '0.25em' }}>
        {big && <span style={{ fontSize: '0.72em', fontWeight: 600, opacity: isToday ? 1 : 0.6, textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: '0.15em' }}>{isToday ? 'Today' : WD[d.getUTCDay()]}</span>}
        <span style={{ fontSize: big ? '0.9em' : '0.72em', fontWeight: 700, color: isToday ? accent : undefined }}>{d.getUTCDate() === 1 && !big ? new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' }).format(d) + ' ' : ''}{d.getUTCDate()}</span>
        {b != null && <span style={{ marginLeft: 'auto', fontSize: big ? '0.6em' : '0.55em', fontWeight: 700, padding: '0.1em 0.45em', borderRadius: '999px', background: ink(style, 0.12), whiteSpace: 'nowrap' }}>Day {b}</span>}
      </div>
    );
  };

  return (
    <div style={frame(style, { gap: 0 })}>
      {legend}
      {err && !events ? <div style={{ margin: 'auto', opacity: 0.5, fontSize: '0.8em' }}>Calendar unavailable right now</div>
        : view === 'month' ? (
          <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gridTemplateRows: `auto repeat(${nWeeks}, minmax(0, 1fr))`, gap: '0.3em' }}>
            {Array.from({ length: 7 }, (_, i) => <div key={i} style={{ textAlign: 'center', fontSize: '0.6em', fontWeight: 600, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{WD[(weekStart + i) % 7]}</div>)}
            {days.map((k) => (
              <Cell key={k} past={k < today} style={style}>
                {header(k, false)}
                {(byDay.get(k) ?? []).map((e) => pill(e, 2, '0.62em'))}
              </Cell>
            ))}
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: `repeat(${nDays}, minmax(0, 1fr))`, gap: '0.45em' }}>
            {days.map((k) => (
              <Cell key={k} past={false} style={style} column>
                {header(k, true)}
                {(byDay.get(k) ?? []).map((e) => pill(e, 3, nDays > 5 ? '0.66em' : '0.74em'))}
                {!(byDay.get(k) ?? []).length && <div style={{ fontSize: '0.62em', opacity: 0.3, padding: '0.3em' }}>{off.has(k) ? '' : 'Nothing planned'}</div>}
              </Cell>
            ))}
          </div>
        )}
    </div>
  );
}

/** A day box that shows as many events as fit and a "+N more" line for the rest. */
function Cell({ children, past, style, column }: { children: React.ReactNode; past: boolean; style: any; column?: boolean }) {
  const [box, size] = useBox<HTMLDivElement>();
  const [hidden, setHidden] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const kids = Array.from(el.children).filter((c) => !(c as HTMLElement).dataset.more) as HTMLElement[];
    kids.forEach((c) => { c.style.display = ''; });
    const limit = el.clientHeight - 16; let n = 0;
    for (let i = kids.length - 1; i > 0; i--) {   // never hide the header (index 0)
      const c = kids[i];
      if (c.offsetTop + c.offsetHeight > limit) { c.style.display = 'none'; n++; } else break;
    }
    setHidden(n);
  });
  return (
    <div ref={box} style={{ position: 'relative', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '0.22em', padding: column ? '0.35em' : '0.25em',
      borderRadius: '0.6em', background: ink(style, column ? 0.035 : 0.03), opacity: past ? 0.45 : 1 }} data-size={size.h}>
      {children}
      {hidden > 0 && <div data-more="1" style={{ position: 'absolute', bottom: '0.15em', right: '0.4em', fontSize: '0.55em', fontWeight: 600, opacity: 0.6 }}>+{hidden} more</div>}
    </div>
  );
}
