// Bot Dashboard: Hermes Desktop pane (disk plugin, loaded uncompiled).
// Shows the focused chat's bot: profile, scheduled jobs, TaskNotes and projects.
// Only @hermes/plugin-sdk and react may be imported here.
import * as sdk from '@hermes/plugin-sdk'
import { host, useValue } from '@hermes/plugin-sdk'
import React from 'react'

const h = React.createElement
const { useCallback, useEffect, useMemo, useRef, useState } = React

const PLUGIN_ID = 'bot-dashboard'
const STYLE_ID = 'bot-dashboard-style'
const REFRESH_MS = 60_000
const STAMP_MS = 4_000

let ctxRef = null

// ---------------------------------------------------------------- styles

const CSS = `
.bd{--bd-accent:var(--ui-accent);height:100%;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;
  scrollbar-gutter:stable;padding:12px 10px 20px 12px;display:flex;flex-direction:column;gap:10px;
  color:var(--ui-text-primary);font-size:13px;line-height:1.45;background:var(--ui-bg-sidebar,transparent)}
.bd>*{flex:0 0 auto}
.bd::-webkit-scrollbar{width:8px}
.bd::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--ui-text-tertiary) 35%,transparent);border-radius:8px;border:2px solid transparent;background-clip:content-box}
.bd::-webkit-scrollbar-thumb:hover{background-color:color-mix(in srgb,var(--ui-text-tertiary) 60%,transparent)}
.bd::-webkit-scrollbar-track{background:transparent}
.bd *{box-sizing:border-box}
.bd-hero{position:relative;border:1px solid var(--ui-stroke-secondary);border-radius:12px;padding:14px;overflow:hidden;
  background:linear-gradient(160deg,color-mix(in srgb,var(--bd-accent) 16%,transparent),transparent 70%),var(--ui-bg-card,var(--ui-bg-elevated))}
.bd-hero-top{display:flex;gap:12px;align-items:center}
.bd-avatar{width:52px;height:52px;border-radius:22%;flex:none;object-fit:cover;display:block}
.bd-avatar-blob{width:52px;height:52px;flex:none;line-height:0}
.bd-avatar-blob svg{width:100%;height:100%;display:block}
.bd-avatar-fallback{display:grid;place-items:center;font-weight:700;font-size:20px;color:#fff;background:var(--bd-accent)}
.bd-name{font-size:16px;font-weight:650;letter-spacing:-.01em;margin:0}
.bd-section{display:inline-flex;align-items:center;gap:6px;margin-top:3px;font-size:11px;font-weight:600;text-transform:uppercase;
  letter-spacing:.06em;color:var(--ui-text-secondary)}
.bd-dot{width:8px;height:8px;border-radius:50%;background:var(--bd-accent);flex:none}
.bd-desc{margin:10px 0 0;color:var(--ui-text-secondary)}
.bd-facts{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;margin-top:12px;font-size:12px}
.bd-facts dt{color:var(--ui-text-tertiary)}
.bd-facts dt{white-space:nowrap}
.bd-facts dd{margin:0;min-width:0;color:var(--ui-text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--font-mono,ui-monospace,monospace);font-size:11.5px}
.bd-facts dd.plain{font-family:inherit;font-size:12px}
.bd-soul{margin-top:10px;border-top:1px solid var(--ui-stroke-tertiary,var(--ui-stroke-secondary));padding-top:8px}
.bd-soul summary{cursor:pointer;font-size:11px;font-weight:650;text-transform:uppercase;letter-spacing:.06em;color:var(--ui-text-secondary);list-style:none;display:flex;align-items:center;gap:6px}
.bd-soul summary::-webkit-details-marker{display:none}
.bd-soul summary::before{content:'›';display:inline-block;transition:transform .15s;color:var(--ui-text-tertiary)}
.bd-soul[open] summary::before{transform:rotate(90deg)}
.bd-soul-body{margin-top:6px;display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--ui-text-secondary)}
.bd-soul-body b{color:var(--ui-text-primary);font-weight:600}
.bd-soul-pre{margin:4px 0 0;max-height:180px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-family:var(--font-mono,ui-monospace,monospace);font-size:11px;
  line-height:1.45;padding:8px;border-radius:8px;border:1px solid var(--ui-stroke-tertiary,var(--ui-stroke-secondary));color:var(--ui-text-secondary)}
.bd-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:2px}
.bd-chip{font-size:11px;padding:0 7px;border-radius:999px;border:1px solid var(--ui-stroke-secondary);color:var(--ui-text-secondary);white-space:nowrap}
.bd-iconbtn{position:absolute;top:10px;right:10px;border:1px solid var(--ui-stroke-secondary);background:var(--ui-bg-sidebar,transparent);
  color:var(--ui-text-secondary);border-radius:8px;width:28px;height:28px;display:grid;place-items:center;cursor:pointer}
.bd-iconbtn:hover{color:var(--ui-text-primary);border-color:var(--bd-accent)}
.bd-iconbtn:focus-visible,.bd button:focus-visible,.bd-card-head:focus-visible,.bd-check:focus-visible{outline:2px solid var(--bd-accent);outline-offset:1px}
.bd-input:not(.desktop-input-chrome):focus{border-color:var(--bd-accent)}
.bd-spin{animation:bd-spin .8s linear infinite}
@keyframes bd-spin{to{transform:rotate(360deg)}}
.bd-card{border:1px solid var(--ui-stroke-secondary);border-radius:12px;background:var(--ui-bg-card,var(--ui-bg-elevated));position:relative}
.bd-card:focus-within,.bd-card:hover{z-index:2}
.bd-card-head{display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;user-select:none;border:0;width:100%;border-radius:11px;
  background:transparent;color:inherit;font:inherit;text-align:left}
.bd-card-head:hover{background:var(--ui-row-hover-background)}
.bd-card-title{font-size:12px;font-weight:650;text-transform:uppercase;letter-spacing:.06em;color:var(--ui-text-secondary)}
.bd-count{font-size:11px;font-weight:600;padding:1px 7px;border-radius:999px;background:color-mix(in srgb,var(--bd-accent) 18%,transparent);color:var(--ui-text-primary)}
.bd-chev{margin-left:auto;color:var(--ui-text-tertiary);transition:transform .15s}
.bd-head-tools{margin-left:auto;display:flex;align-items:center;gap:2px}
.bd-head-tools+.bd-chev{margin-left:4px}
.bd-tool{display:inline-grid;place-items:center;width:24px;height:24px;padding:0;border:1px solid transparent;border-radius:6px;background:transparent;
  color:var(--ui-text-tertiary);cursor:pointer;transition:color .15s,border-color .15s,background .15s}
.bd-tool:hover{color:var(--ui-text-primary);border-color:var(--ui-stroke-secondary);background:var(--ui-row-hover-background)}
.bd-tool svg{width:14px;height:14px;display:block}
.bd-chev.open{transform:rotate(90deg)}
.bd-info{position:relative;display:inline-grid;place-items:center;width:16px;height:16px;border-radius:50%;font-size:10px;font-weight:700;
  color:var(--ui-text-tertiary);border:1px solid var(--ui-stroke-secondary);cursor:help;text-transform:none;letter-spacing:0}
.bd-info:hover{color:var(--ui-text-primary);border-color:var(--bd-accent)}
.bd-tip{display:none;position:absolute;left:50%;transform:translateX(-50%);top:22px;z-index:20;width:min(230px,calc(100vw - 24px));padding:8px 10px;border-radius:8px;font-size:12px;font-weight:400;
  line-height:1.4;color:var(--ui-text-primary);background:var(--ui-bg-elevated);border:1px solid var(--ui-stroke-primary);box-shadow:0 6px 24px rgba(0,0,0,.3)}
.bd-info:hover .bd-tip,.bd-info:focus .bd-tip{display:block}
.bd-body{padding:2px 12px 12px;display:flex;flex-direction:column;gap:6px}
.bd-row{display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border-radius:9px;border:1px solid var(--ui-stroke-tertiary,var(--ui-stroke-secondary));
  background:var(--ui-bg-secondary,transparent)}
.bd-row:hover{border-color:var(--ui-stroke-primary)}
.bd-row-main{flex:1;min-width:0}
.bd-row-title{font-weight:600;color:var(--ui-text-primary);overflow-wrap:anywhere}
.bd-row-sub{font-size:12px;color:var(--ui-text-tertiary);margin-top:2px;overflow-wrap:anywhere}
.bd-row.done .bd-row-title{color:var(--ui-text-tertiary);text-decoration:line-through}
.bd-pill{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;padding:1px 8px;border-radius:999px;white-space:nowrap;
  border:1px solid var(--ui-stroke-secondary);color:var(--ui-text-secondary)}
.bd-pill.ok{color:var(--ui-green);border-color:color-mix(in srgb,var(--ui-green) 45%,transparent)}
.bd-pill.warn{color:var(--ui-yellow);border-color:color-mix(in srgb,var(--ui-yellow) 45%,transparent)}
.bd-pill.bad{color:var(--ui-red);border-color:color-mix(in srgb,var(--ui-red) 45%,transparent)}
.bd-pill.muted{color:var(--ui-text-tertiary)}
.bd-btn{border:1px solid var(--ui-stroke-secondary);background:transparent;color:var(--ui-text-primary);border-radius:7px;
  padding:4px 10px;font:inherit;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;transition:border-color .15s,background .15s}
.bd-btn:hover:not(:disabled){border-color:var(--bd-accent);background:var(--ui-row-hover-background)}
.bd-btn:disabled{opacity:.5;cursor:default}
.bd-btn.primary{background:var(--bd-accent);border-color:var(--bd-accent);color:#fff}
.bd-btn.primary:hover:not(:disabled){filter:brightness(1.08);background:var(--bd-accent)}
.bd-check{appearance:none;flex:none;width:18px;height:18px;margin-top:1px;border-radius:5px;border:1.5px solid var(--ui-text-tertiary);cursor:pointer;
  display:grid;place-items:center;background:transparent}
.bd-check:checked{background:var(--bd-accent);border-color:var(--bd-accent)}
.bd-check:checked::after{content:'';width:5px;height:9px;border:solid #fff;border-width:0 2px 2px 0;transform:translateY(-1px) rotate(45deg)}
.bd-add{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.bd-add>.bd-input:first-child{flex:1 1 100%}
.bd-add>.bd-input.date{flex:1 1 auto;width:auto;min-width:0}
.bd-input{flex:1;min-width:0;border-width:1px;border-style:solid;color:var(--ui-text-primary);
  border-radius:7px;padding:5px 8px;font:inherit;font-size:12.5px;outline:none}
.bd-input::placeholder{color:var(--ui-text-tertiary)}
.bd-input:not(.desktop-input-chrome){background:transparent;border-color:var(--ui-stroke-secondary)}
.bd-input.date{flex:none;width:126px}
.bd-input.date::-webkit-calendar-picker-indicator{filter:var(--bd-picker-filter,none);opacity:.7;cursor:pointer}
.bd select.bd-input option{background:var(--ui-bg-elevated);color:var(--ui-text-primary)}
.bd-empty{padding:12px;text-align:center;color:var(--ui-text-tertiary);font-size:12.5px;border:1px dashed var(--ui-stroke-secondary);border-radius:9px}
.bd-link{background:none;border:0;padding:0;color:var(--ui-text-secondary);font:inherit;font-size:12px;cursor:pointer;text-decoration:underline;align-self:flex-start}
.bd-link:hover{color:var(--ui-text-primary)}
.bd-group .bd-card{border-top:2px solid color-mix(in srgb,var(--bd-accent) 45%,var(--ui-stroke-secondary))}
.bd-hero-group{padding-top:18px}
.bd-group-strip{position:absolute;left:0;right:0;top:0;height:4px}
.bd-stack{display:flex;align-items:center;padding-left:8px}
.bd-stack-face{width:40px;height:40px;margin-left:-8px;border-radius:50%;overflow:hidden;flex:none;display:grid;place-items:center;
  box-shadow:0 0 0 2px var(--ui-bg-card,var(--ui-bg-elevated));background:var(--ui-bg-elevated)}
.bd-stack-face.gone{opacity:.4;filter:grayscale(1)}
.bd-stack-face .bd-avatar,.bd-stack-face .bd-avatar-blob{width:40px;height:40px;border-radius:50%}
.bd-stack-face .bd-avatar-fallback{font-size:15px}
.bd-stack-more{font-size:12px;font-weight:700;color:var(--ui-text-primary)}
.bd-kind{display:inline-flex;align-items:center;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:1px 6px;border-radius:4px;margin-right:6px;
  color:var(--ui-text-primary);background:color-mix(in srgb,var(--bd-accent) 22%,transparent);border:1px solid color-mix(in srgb,var(--bd-accent) 45%,transparent)}
.bd-hero-pills{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}
.bd-live{width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 0 0 currentColor;animation:bd-pulse 1.8s infinite}
@keyframes bd-pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,currentColor 60%,transparent)}70%{box-shadow:0 0 0 6px transparent}100%{box-shadow:0 0 0 0 transparent}}
@media (prefers-reduced-motion:reduce){.bd-live{animation:none}}
.bd-member{align-items:center;border-left:3px solid var(--bd-member,transparent);padding-left:8px}
.bd-member.gone .bd-row-title{text-decoration:line-through;color:var(--ui-text-secondary)}
.bd-member.gone .bd-mface{opacity:.45;filter:grayscale(1)}
.bd-mface{width:28px;height:28px;flex:none;line-height:0}
.bd-mface .bd-avatar,.bd-mface .bd-avatar-blob{width:28px;height:28px}
.bd-mface .bd-avatar-fallback{font-size:12px}
.bd-event{align-items:flex-start}
.bd-event-dot{width:8px;height:8px;border-radius:50%;margin-top:5px;flex:none;background:var(--bd-accent)}
.bd-owners{display:flex;gap:4px;flex-wrap:wrap;margin-top:4px}
.bd-owner{font-size:11px;padding:0 6px;border-radius:4px;color:var(--ui-text-secondary);border:1px solid var(--ui-stroke-secondary)}
.bd-select{flex:1 1 100%;min-width:0}
.bd-missing{padding:14px}.bd-missing-title{font-weight:600;font-size:14px;margin-bottom:4px}.bd-missing p{margin:0 0 10px;color:var(--ui-text-secondary)}
.bd-error{padding:10px 12px;border-radius:9px;border:1px solid color-mix(in srgb,var(--ui-red) 45%,transparent);color:var(--ui-text-primary);
  background:color-mix(in srgb,var(--ui-red) 10%,transparent);font-size:12.5px}
.bd-next{margin-top:5px;font-size:12px;color:var(--ui-text-secondary)}
.bd-next b{color:var(--ui-text-tertiary);font-weight:600}
.bd-foot{font-size:11px;color:var(--ui-text-quaternary,var(--ui-text-tertiary));text-align:center}
.bd-skeleton{height:64px;border-radius:12px;background:linear-gradient(90deg,var(--ui-bg-secondary),var(--ui-bg-tertiary),var(--ui-bg-secondary));
  background-size:200% 100%;animation:bd-sh 1.2s infinite}
@keyframes bd-sh{to{background-position:-200% 0}}
.bd-iconbtn.on{background:var(--bd-accent);border-color:var(--bd-accent);color:#fff}
.bd-textarea{width:100%;resize:vertical;min-height:38px;font-family:inherit;line-height:1.4}
.bd-textarea.mono{font-family:var(--font-mono,ui-monospace,monospace);font-size:11.5px}
.bd-note-add{display:flex;flex-direction:column;gap:6px;align-items:flex-end}
.bd-note{padding:8px 10px;border-radius:9px;border:1px solid var(--ui-stroke-tertiary,var(--ui-stroke-secondary));background:var(--ui-bg-secondary,transparent)}
.bd-note.pinned{border-color:color-mix(in srgb,var(--bd-accent) 55%,transparent)}
.bd-note-meta{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:5px}
.bd-note-time{font-size:11px;color:var(--ui-text-tertiary)}
.bd-note-actions{margin-left:auto;display:flex;gap:3px}
.bd-note-text{white-space:pre-wrap;overflow-wrap:anywhere;color:var(--ui-text-primary)}
.bd-mini{border:1px solid transparent;background:transparent;color:var(--ui-text-secondary);border-radius:6px;padding:1px 6px;font:inherit;font-size:11.5px;cursor:pointer}
.bd-mini:hover:not(:disabled){border-color:var(--ui-stroke-secondary);color:var(--ui-text-primary)}
.bd-mini.danger:hover:not(:disabled){color:var(--ui-red);border-color:color-mix(in srgb,var(--ui-red) 45%,transparent)}
.bd-mini:disabled{opacity:.4;cursor:default}
.bd-frame{display:block;width:100%;border:0;background:transparent;border-radius:8px}
.bd-overlay{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:32px;background:color-mix(in srgb,#000 55%,transparent)}
.bd-overlay-box{width:min(960px,100%);max-height:100%;display:flex;flex-direction:column;border:1px solid var(--ui-stroke-secondary);border-radius:14px;
  background:var(--ui-bg-elevated);color:var(--ui-text-primary);box-shadow:0 20px 60px rgba(0,0,0,.45);overflow:hidden}
.bd-overlay-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;border-bottom:1px solid var(--ui-stroke-secondary)}
.bd-overlay-body{padding:14px;overflow:auto;min-height:0}
.bd-member.bd-link{cursor:pointer}
.bd-member.bd-link:hover{background:var(--ui-bg-hover,var(--ui-bg-elevated))}
.bd-member.bd-link:hover .bd-row-title{text-decoration:underline;text-underline-offset:2px}
.bd-member.bd-link:focus-visible{outline:1px solid var(--bd-accent);outline-offset:-1px;border-radius:8px}
.bd-groups{display:flex;flex-direction:column;height:100%;min-height:0}
.bd-pick{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid var(--ui-stroke-secondary);flex:none}
.bd-select{flex:1;min-width:0;font:inherit;font-size:12px;padding:4px 6px;border-radius:8px;border:1px solid var(--ui-stroke-secondary);
  background:var(--ui-bg-card,var(--ui-bg-elevated));color:var(--ui-text-primary)}
.bd-select:focus-visible{outline:1px solid var(--bd-accent);outline-offset:1px}
.bd-refresh{flex:none;min-width:28px;padding:4px 8px}
.bd-groups>.bd{flex:1;min-height:0}
.bd-group-empty{padding-top:16px}
.bd-win-body>.bd{flex:1}
.bd-editor{display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:12px;border:1.5px solid var(--bd-accent);
  background:color-mix(in srgb,var(--bd-accent) 6%,var(--ui-bg-card,var(--ui-bg-elevated)))}
.bd-editor-title{display:flex;align-items:center;gap:8px;font-weight:650}
.bd-layout-row{display:flex;align-items:center;gap:2px;padding:5px 8px;border-radius:8px;border:1px solid var(--ui-stroke-secondary);background:transparent}
.bd-layout-row.off .bd-layout-name{color:var(--ui-text-tertiary);text-decoration:line-through}
.bd-layout-name{flex:1;min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bd-hint{font-size:11.5px;color:var(--ui-text-tertiary)}
`

function ensureStyle() {
  let el = document.getElementById(STYLE_ID)
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  if (el.textContent !== CSS) el.textContent = CSS
}

// ---------------------------------------------------------------- helpers

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function clock(hh, mm) {
  const hour = Number(hh)
  const suffix = hour >= 12 ? 'PM' : 'AM'
  return `${hour % 12 || 12}:${String(mm).padStart(2, '0')} ${suffix}`
}

function dayList(field) {
  if (field === '*') return null
  const out = []
  for (const part of field.split(',')) {
    const [a, b] = part.split('-').map(Number)
    if (Number.isNaN(a)) return field
    if (b === undefined) out.push(DAYS[a % 7])
    else out.push(`${DAYS[a % 7]}–${DAYS[b % 7]}`)
  }
  return out.join(', ')
}

/** Plain-English label for common cron expressions; falls back to the raw text. */
function humanSchedule(job) {
  const raw = String(job.schedule_display || job.schedule?.display || job.schedule?.expr || job.schedule || '')
  const m = raw.trim().match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+([\d,*-]+)$/)
  if (m) {
    const days = dayList(m[3])
    return days ? `${days} at ${clock(m[2], m[1])}` : `Daily at ${clock(m[2], m[1])}`
  }
  const every = raw.match(/^every\s+(\d+)\s*([mhd])/i)
  if (every) return `Every ${every[1]} ${{ m: 'minutes', h: 'hours', d: 'days' }[every[2].toLowerCase()]}`
  return raw || 'No schedule'
}

function relative(iso) {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const diff = t - Date.now()
  const abs = Math.abs(diff)
  const unit = abs < 3600e3 ? [60e3, 'minute'] : abs < 86400e3 ? [3600e3, 'hour'] : [86400e3, 'day']
  const n = Math.max(1, Math.round(abs / unit[0]))
  const label = `${n} ${unit[1]}${n === 1 ? '' : 's'}`
  return diff >= 0 ? `in ${label}` : `${label} ago`
}

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDay(iso) {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function storageGet(key, fallback) {
  try {
    return ctxRef?.storage ? ctxRef.storage.get(key, fallback) : fallback
  } catch {
    return fallback
  }
}

function storageSet(key, value) {
  try {
    ctxRef?.storage?.set(key, value)
  } catch {
    /* storage is best-effort */
  }
}

function rest(path, opts) {
  if (!ctxRef) return Promise.reject(new Error('Plugin is not ready.'))
  return ctxRef.rest(path, opts)
}

const DEFAULT_ORDER = ['profile', 'jobs', 'tasks', 'notes', 'projects']
// A group has no jobs of its own; it shows the room and its members instead.
const GROUP_ORDER = ['profile', 'members', 'activity', 'tasks', 'notes', 'projects']
const isGroup = d => d?.kind === 'group'
const noun = d => (isGroup(d) ? 'this group' : 'this bot')
const arr = v => (Array.isArray(v) ? v : [])

/** The REST payload, made safe to render: every list is a list and the panel
 *  always has a layout, even when the server sent a partial or older shape. */
function normalizeBot(data) {
  const d = data && typeof data === 'object' ? data : {}
  const panel = d.panel && typeof d.panel === 'object' ? d.panel : {}
  const layout = panel.layout && typeof panel.layout === 'object' ? panel.layout : {}
  const widgets = arr(panel.widgets).filter(w => w && w.id)
  // Deduplicate, drop ids of widgets that no longer exist, and put back any
  // built-in card or widget the stored order is missing (older or hand-edited files).
  const known = new Set([...(isGroup(d) ? GROUP_ORDER : DEFAULT_ORDER), ...widgets.map(w => `w:${w.id}`)])
  const order = [...new Set(arr(layout.order).filter(k => typeof k === 'string' && known.has(k)))]
  for (const k of known) if (!order.includes(k)) order.push(k)
  return {
    ...d,
    id: String(d.id || ''),
    name: String(d.name || d.id || ''),
    tasks: arr(d.tasks),
    projects: arr(d.projects),
    toolsets: arr(d.toolsets),
    mcp: arr(d.mcp),
    plugins: arr(d.plugins),
    fallback: arr(d.fallback),
    groups: arr(d.groups),
    members: arr(d.members).filter(m => m && typeof m === 'object').map(m => ({ ...m, id: String(m.id || '?'), name: String(m.name || m.id || 'Member') })),
    events: arr(d.events).filter(e => e && typeof e === 'object'),
    panel: {
      layout: { order, hidden: arr(layout.hidden).filter(k => typeof k === 'string' && k !== 'profile') },
      widgets,
      notes: arr(panel.notes).filter(n => n && n.id)
    }
  }
}

/** Keeps one broken card from blanking the whole pane. */
class CardBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { failed: null }
  }
  static getDerivedStateFromError(err) {
    return { failed: err }
  }
  componentDidUpdate(prev) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: null })
  }
  render() {
    if (!this.state.failed) return this.props.children
    return h('div', { className: 'bd-error' }, `The ${this.props.label || 'card'} could not be shown. ${errorText(this.state.failed)}`)
  }
}

function errorText(err) {
  const msg = err && (err.message || err.detail || String(err))
  return msg && msg !== '[object Object]' ? msg : 'The request failed.'
}

// ---------------------------------------------------------------- small parts

function Info({ text }) {
  return h(
    'span',
    { className: 'bd-info', tabIndex: 0, role: 'note', 'aria-label': text, onClick: e => e.stopPropagation() },
    'i',
    h('span', { className: 'bd-tip', role: 'tooltip' }, text)
  )
}

function Card({ id, botId, title, count, info, actions, tools, children }) {
  const key = `collapsed.${botId}.${id}`
  const [collapsed, setCollapsed] = useState(() => storageGet(key, false))
  useEffect(() => setCollapsed(storageGet(key, false)), [key])
  const toggle = () => {
    setCollapsed(c => {
      storageSet(key, !c)
      return !c
    })
  }
  return h(
    'section',
    { className: 'bd-card', 'aria-label': title },
    h(
      'div',
      {
        className: 'bd-card-head',
        role: 'button',
        tabIndex: 0,
        'aria-expanded': !collapsed,
        onClick: toggle,
        onKeyDown: e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            toggle()
          }
        }
      },
      h('span', { className: 'bd-card-title' }, title),
      count != null ? h('span', { className: 'bd-count' }, count) : null,
      info ? h(Info, { text: info }) : null,
      tools ? h('span', { className: 'bd-head-tools', onClick: e => e.stopPropagation(), onKeyDown: e => e.stopPropagation() }, tools) : null,
      h('span', { className: `bd-chev${collapsed ? '' : ' open'}`, 'aria-hidden': true }, '›')
    ),
    collapsed ? null : h('div', { className: 'bd-body' }, actions || null, children)
  )
}

function Empty({ children }) {
  return h('div', { className: 'bd-empty' }, children)
}

// ---------------------------------------------------------------- avatar

// Mirrors hermes-bots/avatar.tsx so the face here matches the roster row.
const blobatarSvg = typeof sdk.blobatarSvg === 'function' ? sdk.blobatarSvg : null
const BLOB_KIND_TRAIT = { round: 0.11, organic: 0.35, boxy: 0.54, capsule: 0.65, nub: 0.745, cloud: 0.825, droplet: 0.8875, hexagon: 0.9325, sun: 0.965, triangle: 0.99 }
const AVATAR_SIZE = 52

function blobFace(shape, name) {
  if (!blobatarSvg) return null
  const parts = String(shape || '').split(':')
  const seed = parts[1] || name || 'agent'
  const kind = BLOB_KIND_TRAIT[parts[2]] !== undefined ? parts[2] : ''
  try {
    return blobatarSvg(seed, kind ? { size: AVATAR_SIZE, traits: { shape: BLOB_KIND_TRAIT[kind] } } : { size: AVATAR_SIZE })
  } catch {
    return null
  }
}

function BotAvatar({ bot }) {
  const photo = bot.avatar && !bot.avatarBackfill && bot.imageKind !== 'shape' ? bot.avatar : null
  const faceName = bot.id === 'hermes' ? 'default' : bot.id
  // Blob faces reproduce the roster exactly (same seed, same trait). Other face
  // kinds are drawn by the app itself, which plugins may not read — they get a
  // stable stand-in blob seeded from the bot id instead.
  const markup = useMemo(() => (photo ? null : blobFace(bot.shape, bot.id) || blobFace('', faceName)), [photo, bot.shape, bot.id, faceName])

  if (photo) return h('img', { className: 'bd-avatar', src: photo, alt: '' })
  if (markup) return h('span', { className: 'bd-avatar-blob', 'aria-hidden': true, dangerouslySetInnerHTML: { __html: markup } })
  if (bot.avatar) return h('img', { className: 'bd-avatar', src: bot.avatar, alt: '' })
  return h('div', { className: 'bd-avatar bd-avatar-fallback' }, (bot.name || bot.id || '?').trim().slice(0, 1).toUpperCase())
}

// ---------------------------------------------------------------- widgets

function Hero({ bot, loading, onRefresh, onCustomize, customizing }) {
  return h(
    'header',
    { className: 'bd-hero' },
    h(
      'button',
      {
        className: `bd-iconbtn${customizing ? ' on' : ''}`,
        type: 'button',
        style: { right: 44 },
        title: 'Customize this panel',
        'aria-label': 'Customize this panel',
        'aria-pressed': !!customizing,
        onClick: onCustomize
      },
      '✎'
    ),
    h(
      'button',
      {
        className: 'bd-iconbtn',
        type: 'button',
        title: 'Refresh the dashboard',
        'aria-label': 'Refresh the dashboard',
        onClick: onRefresh
      },
      h('span', { className: loading ? 'bd-spin' : '', style: { display: 'inline-block' } }, '↻')
    ),
    h(
      'div',
      { className: 'bd-hero-top' },
      h(BotAvatar, { bot }),
      h(
        'div',
        { style: { minWidth: 0, paddingRight: 70 } },
        h('h2', { className: 'bd-name' }, bot.name || bot.id),
        bot.section
          ? h('div', { className: 'bd-section' }, h('span', { className: 'bd-dot' }), bot.section)
          : h('div', { className: 'bd-section' }, `@${bot.id}`)
      )
    ),
    bot.description ? h('p', { className: 'bd-desc' }, bot.description) : null,
    h(
      'dl',
      { className: 'bd-facts', title: 'Read from this bot\'s config.yaml' },
      h('dt', null, 'Model'),
      h('dd', { title: `${bot.provider}/${bot.model}` }, bot.model || 'Default'),
      bot.fallback?.length ? h('dt', null, 'Fallback') : null,
      bot.fallback?.length ? h('dd', { title: bot.fallback.join(', ') }, bot.fallback.join(', ')) : null,
      bot.reasoning ? h('dt', null, 'Reasoning') : null,
      bot.reasoning ? h('dd', { className: 'plain' }, bot.reasoning) : null,
      h('dt', null, 'Skills'),
      h('dd', { className: 'plain', title: `${bot.skillCount} installed in this profile` },
        bot.skillsEnabled === undefined || bot.skillsEnabled === bot.skillCount ? `${bot.skillCount} installed` : `${bot.skillsEnabled} on · ${bot.skillCount} installed`),
      bot.workspace ? h('dt', null, 'Workspace') : null,
      bot.workspace ? h('dd', { title: bot.workspace }, bot.workspace) : null
    ),
    h(AdvancedFacts, { bot })
  )
}

function AdvancedFacts({ bot }) {
  const toolsets = bot.toolsets || []
  const mcp = bot.mcp || []
  const plugins = bot.plugins || []
  const soul = (bot.soul || '').trim()
  if (!toolsets.length && !mcp.length && !plugins.length && !soul && !bot.maxTurns) return null
  const chips = list => h('div', { className: 'bd-chips' }, list.map(x => h('span', { className: 'bd-chip', key: x.name || x, title: x.enabled === false ? 'Disabled' : undefined, style: x.enabled === false ? { opacity: 0.5, textDecoration: 'line-through' } : undefined }, x.name || x)))
  return h(
    'details',
    { className: 'bd-soul' },
    h('summary', { title: 'The same settings as Edit bot → Advanced: model, skills, toolsets, SOUL.md' }, 'Advanced'),
    h(
      'div',
      { className: 'bd-soul-body' },
      bot.provider ? h('div', null, h('b', null, 'Provider: '), bot.provider) : null,
      bot.maxTurns ? h('div', null, h('b', null, 'Max turns: '), String(bot.maxTurns)) : null,
      toolsets.length ? h('div', null, h('b', null, `Toolsets (${toolsets.length})`), chips(toolsets)) : null,
      mcp.length ? h('div', null, h('b', null, `MCP servers (${mcp.length})`), chips(mcp)) : null,
      plugins.length ? h('div', null, h('b', null, `Plugins (${plugins.length})`), chips(plugins)) : null,
      soul ? h('div', null, h('b', null, 'SOUL.md'), h('pre', { className: 'bd-soul-pre' }, soul)) : null
    )
  )
}

function JobsWidget({ botId }) {
  const [state, setState] = useState({ loading: true, jobs: [], error: '' })
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await host.request('cron.manage', {
        action: 'list',
        include_disabled: true,
        ...(botId === 'hermes' ? {} : { profile: botId })
      })
      const jobs = Array.isArray(data?.jobs) ? data.jobs : []
      setState({ loading: false, jobs, error: '' })
    } catch (err) {
      setState(s => ({ ...s, loading: false, error: errorText(err) }))
    }
  }, [botId])

  useEffect(() => {
    setState({ loading: true, jobs: [], error: '' })
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  const toggle = async job => {
    const id = job.job_id || job.id
    const paused = job.enabled === false || job.state === 'paused'
    setBusy(id)
    try {
      await host.request('cron.manage', {
        action: paused ? 'resume' : 'pause',
        name: id,
        ...(botId === 'hermes' ? {} : { profile: botId })
      })
      host.notify?.({ kind: 'success', message: `${job.name || 'Job'} ${paused ? 'resumed' : 'paused'}.` })
    } catch (err) {
      host.notify?.({ kind: 'error', message: `Could not update the job: ${errorText(err)}` })
    } finally {
      setBusy('')
      load()
    }
  }

  const active = state.jobs.filter(j => !(j.enabled === false || j.state === 'paused')).length

  return h(
    Card,
    {
      id: 'jobs',
      botId,
      title: 'Scheduled jobs',
      count: state.loading ? null : `${active}/${state.jobs.length}`,
      info: 'Cron jobs stored in this bot\'s own profile. Active jobs run on their schedule and deliver to this bot\'s chat. Pause stops a job without deleting it.'
    },
    state.error ? h('div', { className: 'bd-error' }, `Could not load jobs. ${state.error}`) : null,
    state.loading
      ? h('div', { className: 'bd-skeleton', style: { height: 44 } })
      : state.jobs.length === 0 && !state.error
        ? h(Empty, null, 'No scheduled jobs for this bot.')
        : state.jobs.map(job => {
            const id = job.job_id || job.id
            const paused = job.enabled === false || job.state === 'paused'
            const failed = job.last_status === 'error' || job.last_status === 'failed'
            return h(
              'div',
              { className: 'bd-row', key: id },
              h(
                'div',
                { className: 'bd-row-main' },
                h('div', { className: 'bd-row-title' }, job.name || id),
                h(
                  'div',
                  { className: 'bd-row-sub' },
                  humanSchedule(job),
                  !paused && job.next_run_at ? ` · next ${relative(job.next_run_at)}` : ''
                ),
                h(
                  'div',
                  { style: { marginTop: 5, display: 'flex', gap: 5, flexWrap: 'wrap' } },
                  h('span', { className: `bd-pill ${paused ? 'muted' : 'ok'}` }, paused ? 'Paused' : 'Active'),
                  failed
                    ? h('span', { className: 'bd-pill bad', title: String(job.last_error || '') }, 'Last run failed')
                    : job.last_run_at
                      ? h('span', { className: 'bd-pill muted' }, `Ran ${relative(job.last_run_at)}`)
                      : null
                )
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'bd-btn',
                  disabled: busy === id,
                  title: paused ? 'Resume this job' : 'Pause this job',
                  onClick: () => toggle(job)
                },
                busy === id ? '…' : paused ? 'Resume' : 'Pause'
              )
            )
          })
  )
}

function TasksWidget({ bot, onChanged }) {
  const [showDone, setShowDone] = useState(false)
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState({})
  // In a group the task list spans every member, and a new task goes to one of them.
  const members = isGroup(bot) ? bot.members.filter(m => !m.missing && !m.remote) : null
  const [owner, setOwner] = useState('')
  const target = members ? (members.some(m => m.id === owner) ? owner : members[0]?.id || '') : bot.id
  const nameOf = id => members?.find(m => m.id === id)?.name || id
  const open = bot.tasks.filter(t => t.status !== 'done')
  const done = bot.tasks.filter(t => t.status === 'done')
  const today = todayIso()

  const setStatus = async (task, status) => {
    setPending(p => ({ ...p, [task.file]: status }))
    try {
      await rest('/task/status', { method: 'POST', body: { file: task.file, status } })
      await onChanged()
    } catch (err) {
      host.notify?.({ kind: 'error', message: `Could not update the task: ${errorText(err)}` })
    } finally {
      setPending(p => {
        const next = { ...p }
        delete next[task.file]
        return next
      })
    }
  }

  const add = async e => {
    e.preventDefault()
    const text = title.trim()
    if (!text) return
    setBusy(true)
    try {
      if (!target) throw new Error('This group has no member who can own a task.')
      await rest('/task', { method: 'POST', body: { bot: target, title: text, due: due || null } })
      setTitle('')
      setDue('')
      await onChanged()
    } catch (err) {
      host.notify?.({ kind: 'error', message: `Could not add the task: ${errorText(err)}` })
    } finally {
      setBusy(false)
    }
  }

  const row = task => {
    const status = pending[task.file] || task.status
    const isDone = status === 'done'
    const overdue = !isDone && task.due && task.due < today
    const dueToday = !isDone && task.due === today
    return h(
      'div',
      { className: `bd-row${isDone ? ' done' : ''}`, key: task.file },
      h('input', {
        type: 'checkbox',
        className: 'bd-check',
        checked: isDone,
        'aria-label': isDone ? `Reopen ${task.title}` : `Complete ${task.title}`,
        title: isDone ? 'Mark as open' : 'Mark as done',
        onChange: () => setStatus(task, isDone ? 'open' : 'done')
      }),
      h(
        'div',
        { className: 'bd-row-main' },
        h('div', { className: 'bd-row-title' }, task.title),
        members && arr(task.owners).length
          ? h('div', { className: 'bd-owners' }, arr(task.owners).map(o => h('span', { key: o, className: 'bd-owner' }, nameOf(o))))
          : null,
        task.due || task.priority !== 'normal'
          ? h(
              'div',
              { style: { marginTop: 5, display: 'flex', gap: 5, flexWrap: 'wrap' } },
              task.due
                ? h(
                    'span',
                    { className: `bd-pill ${overdue ? 'bad' : dueToday ? 'warn' : 'muted'}` },
                    overdue ? `Overdue · ${formatDay(task.due)}` : dueToday ? 'Due today' : `Due ${formatDay(task.due)}`
                  )
                : null,
              task.priority !== 'normal'
                ? h('span', { className: `bd-pill ${task.priority === 'high' ? 'warn' : 'muted'}` }, `${task.priority} priority`)
                : null
            )
          : null
      )
    )
  }

  return h(
    Card,
    {
      id: 'tasks',
      botId: bot.id,
      title: 'Tasks',
      count: open.length,
      info: members
        ? 'Open TaskNotes owned by any member of this group. Tick a task to mark it done; the note in the vault updates. A new task is saved as a TaskNote for the member you pick.'
        : 'TaskNotes in HermesBrain that carry bot: ' + bot.id + '. Tick a task to mark it done; the note in the vault updates. New tasks are saved as TaskNotes for this bot.'
    },
    open.length === 0 ? h(Empty, null, members ? 'No open tasks for any member.' : 'No open tasks for this bot.') : open.map(row),
    done.length
      ? h(
          'button',
          { type: 'button', className: 'bd-link', onClick: () => setShowDone(s => !s) },
          showDone ? 'Hide completed' : `Show completed (${done.length})`
        )
      : null,
    showDone ? done.map(row) : null,
    h(
      'form',
      { className: 'bd-add', onSubmit: add },
      h('input', {
        className: 'desktop-input-chrome bd-input',
        placeholder: members ? 'Add a task for a member' : 'Add a task for this bot',
        'aria-label': 'New task title',
        value: title,
        maxLength: 200,
        onChange: e => setTitle(e.target.value)
      }),
      h('input', {
        className: 'desktop-input-chrome bd-input date',
        type: 'date',
        'aria-label': 'Due date (optional)',
        title: 'Due date (optional)',
        value: due,
        onChange: e => setDue(e.target.value)
      }),
      members && members.length > 1
        ? h('select', {
            className: 'desktop-input-chrome bd-input bd-select',
            'aria-label': 'Member who owns the task',
            title: 'Member who owns the task',
            value: target,
            onChange: e => setOwner(e.target.value)
          }, members.map(m => h('option', { key: m.id, value: m.id }, m.name)))
        : null,
      h('button', { type: 'submit', className: 'bd-btn primary', disabled: busy || !title.trim() || !target }, busy ? '…' : 'Add')
    )
  )
}

function ProjectsWidget({ bot }) {
  const tone = s => (s === 'active' ? 'ok' : s === 'paused' || s === 'spike' ? 'warn' : s === 'archived' ? 'muted' : 'muted')
  return h(
    Card,
    {
      id: 'projects',
      botId: bot.id,
      title: 'Projects',
      count: bot.projects.length,
      info: isGroup(bot)
        ? `Project notes in HermesBrain/02 Projects owned by any member of this group. A project not updated for ${14} days or more is flagged as stale.`
        : `Project notes in HermesBrain/02 Projects that carry bot: ${bot.id}. A project not updated for ${14} days or more is flagged as stale.`
    },
    bot.projects.length === 0
      ? h(Empty, null, isGroup(bot) ? 'No projects are linked to any member.' : 'No projects are linked to this bot.')
      : bot.projects.map(p =>
          h(
            'div',
            { className: 'bd-row', key: p.name },
            h(
              'div',
              { className: 'bd-row-main' },
              h(
                'div',
                { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
                h('span', { className: 'bd-row-title' }, p.name),
                h('span', { className: `bd-pill ${tone(p.status)}` }, p.status),
                isGroup(bot) && p.owner ? h('span', { className: 'bd-owner' }, bot.members.find(m => m.id === p.owner)?.name || p.owner) : null
              ),
              p.next
                ? h('div', { className: 'bd-next' }, h('b', null, 'Next: '), p.next)
                : h('div', { className: 'bd-next' }, h('b', null, 'Next: '), 'Not set'),
              p.updated
                ? h(
                    'div',
                    { style: { marginTop: 5 } },
                    h(
                      'span',
                      { className: `bd-pill ${p.stale ? 'warn' : 'muted'}`, title: `Last updated ${p.updated}` },
                      p.stale ? `Stale · updated ${p.ageDays} days ago` : p.ageDays === 0 ? 'Updated today' : `Updated ${p.ageDays} days ago`
                    )
                  )
                : null
            )
          )
        )
  )
}

// ---------------------------------------------------------------- notes

function NotesWidget({ bot, onChanged }) {
  const notes = bot.panel?.notes || []
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState('')

  const call = async (path, body, failMsg) => {
    setBusy(true)
    try {
      await rest(path, { method: 'POST', body: { bot: bot.id, ...body } })
      await onChanged()
      return true
    } catch (err) {
      host.notify?.({ kind: 'error', message: `${failMsg}: ${errorText(err)}` })
      return false
    } finally {
      setBusy(false)
    }
  }

  const add = async e => {
    e.preventDefault()
    if (!text.trim()) return
    if (await call('/panel/note', { text }, 'Could not save the note')) setText('')
  }

  const save = async id => {
    if (await call('/panel/note/update', { id, text: draft }, 'Could not update the note')) setEditing(null)
  }

  const remove = note => {
    if (window.confirm('Delete this note?')) call('/panel/note/delete', { id: note.id }, 'Could not delete the note')
  }

  return h(
    Card,
    {
      id: 'notes',
      botId: bot.id,
      title: 'Notes',
      count: notes.length,
      info: isGroup(bot)
        ? 'Notes for this group, kept with the room on this computer. Use them for decisions, links and hand-offs between members. Pinned notes stay on top.'
        : 'Notes shared between you and this bot. You can write here; the bot reads and writes the same notes with its bot_panel tool. Pinned notes stay on top.'
    },
    h(
      'form',
      { className: 'bd-note-add', onSubmit: add },
      h('textarea', {
        className: 'desktop-input-chrome bd-input bd-textarea',
        placeholder: `Write a note for ${noun(bot)}`,
        'aria-label': 'New note',
        rows: 2,
        value: text,
        maxLength: 4000,
        onChange: e => setText(e.target.value),
        onKeyDown: e => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) add(e)
        }
      }),
      h('button', { type: 'submit', className: 'bd-btn primary', disabled: busy || !text.trim(), title: 'Save note (Ctrl+Enter)' }, 'Add note')
    ),
    notes.length === 0
      ? h(Empty, null, 'No notes yet. Add one here, or ask the bot to leave one.')
      : notes.map(note =>
          h(
            'div',
            { className: `bd-note${note.pinned ? ' pinned' : ''}`, key: note.id },
            h(
              'div',
              { className: 'bd-note-meta' },
              h('span', { className: `bd-pill ${note.author === 'bot' ? 'ok' : 'muted'}` }, note.author === 'bot' ? `@${bot.id}` : 'You'),
              note.pinned ? h('span', { className: 'bd-pill warn' }, 'Pinned') : null,
              h('span', { className: 'bd-note-time', title: note.updated }, relative(note.updated)),
              h(
                'span',
                { className: 'bd-note-actions' },
                h('button', { type: 'button', className: 'bd-mini', title: note.pinned ? 'Unpin' : 'Pin to top', disabled: busy,
                  onClick: () => call('/panel/note/update', { id: note.id, pinned: !note.pinned }, 'Could not pin the note') }, note.pinned ? 'Unpin' : 'Pin'),
                h('button', { type: 'button', className: 'bd-mini', title: 'Edit note', disabled: busy,
                  onClick: () => { setEditing(note.id); setDraft(note.text) } }, 'Edit'),
                h('button', { type: 'button', className: 'bd-mini danger', title: 'Delete note', disabled: busy, onClick: () => remove(note) }, 'Delete')
              )
            ),
            editing === note.id
              ? h(
                  'div',
                  null,
                  h('textarea', { className: 'desktop-input-chrome bd-input bd-textarea', rows: 4, value: draft, maxLength: 4000, 'aria-label': 'Edit note',
                    onChange: e => setDraft(e.target.value) }),
                  h('div', { style: { display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end' } },
                    h('button', { type: 'button', className: 'bd-btn', onClick: () => setEditing(null) }, 'Cancel'),
                    h('button', { type: 'button', className: 'bd-btn primary', disabled: busy || !draft.trim(), onClick: () => save(note.id) }, 'Save'))
                )
              : h('div', { className: 'bd-note-text' }, note.text)
          )
        )
  )
}

// ---------------------------------------------------------------- custom widgets

const THEME_VARS = [
  ['--foreground', '--ui-text-primary'],
  ['--muted-foreground', '--ui-text-secondary'],
  ['--border', '--ui-stroke-secondary'],
  ['--accent', '--ui-accent'],
  ['--card', '--ui-bg-elevated'],
  ['--green', '--ui-green'],
  ['--yellow', '--ui-yellow'],
  ['--red', '--ui-red']
]

function themeCss(accent) {
  const cs = getComputedStyle(document.documentElement)
  const body = getComputedStyle(document.body)
  const vars = THEME_VARS.map(([k, src]) => {
    const v = k === '--accent' && accent ? accent : cs.getPropertyValue(src).trim()
    return v ? `${k}:${v};` : ''
  }).join('')
  return `:root{${vars}color-scheme:light dark}html,body{margin:0;padding:0;background:transparent;color:var(--foreground);font-family:${body.fontFamily};font-size:13px}html.bd-fit{overflow:hidden}`
}

function buildDoc(widget, accent, large = false) {
  const html = widget.html || ''
  const head = `<meta charset="utf-8"><style>${themeCss(accent)}</style>${
    large ? '<style>body{padding:4px}</style>' : '<style>html,body{overflow:auto}</style>'
  }`
  if (/<html[\s>]/i.test(html)) {
    return /<head[^>]*>/i.test(html)
      ? html.replace(/<head[^>]*>/i, m => m + head)
      : html.replace(/<html[^>]*>/i, m => m + '<head>' + head + '</head>')
  }
  return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`
}

function WidgetFrame({ widget, accent, large = false }) {
  const doc = useMemo(() => buildDoc(widget, accent, large), [widget.html, widget.id, accent, large])
  // A widget cannot report its own height without running a script we inject,
  // so the frame keeps the height the panel stored and scrolls inside.
  return h('iframe', {
    className: 'bd-frame',
    title: widget.title,
    sandbox: 'allow-scripts',
    scrolling: 'auto',
    srcDoc: doc,
    style: { height: large ? 'min(70vh, 640px)' : widget.height || 180 }
  })
}

// Full-width view for widgets designed wider than the side pane.
function WidgetOverlay({ widget, accent, onClose }) {
  useEffect(() => {
    const onKey = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return h(
    'div',
    { className: 'bd-overlay', role: 'dialog', 'aria-modal': true, 'aria-label': widget.title, onMouseDown: e => e.target === e.currentTarget && onClose() },
    h(
      'div',
      { className: 'bd-overlay-box' },
      h(
        'div',
        { className: 'bd-overlay-head' },
        h('span', { className: 'bd-card-title' }, widget.title),
        h('button', { type: 'button', className: 'bd-btn', onClick: onClose, title: 'Close (Esc)' }, 'Close')
      ),
      h('div', { className: 'bd-overlay-body' }, h(WidgetFrame, { widget, accent, large: true }))
    )
  )
}

function CustomWidget({ bot, widget }) {
  const [open, setOpen] = useState(false)
  return h(
    Card,
    {
      id: `w:${widget.id}`,
      botId: bot.id,
      title: widget.title,
      info: `A custom widget ${widget.author === 'bot' ? `built by @${bot.id}` : 'you added'}. Ask the bot in chat to change it, or use Customize to edit its HTML. Last updated ${widget.updated || 'unknown'}.`,
      tools: h(
        'button',
        { type: 'button', className: 'bd-tool', onClick: () => setOpen(true), title: 'Expand to full size', 'aria-label': `Expand ${widget.title}` },
        h(
          'svg',
          { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
          h('path', { d: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7' })
        )
      )
    },
    h(WidgetFrame, { widget, accent: bot.color }),
    open ? h(WidgetOverlay, { widget, accent: bot.color, onClose: () => setOpen(false) }) : null
  )
}

function WidgetEditor({ bot, widget, onDone, onChanged }) {
  const [title, setTitle] = useState(widget?.title || '')
  const [html, setHtml] = useState(widget?.html || '')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      await rest('/panel/widget', { method: 'POST', body: { bot: bot.id, id: widget?.id || null, title, html } })
      await onChanged()
      onDone()
    } catch (err) {
      host.notify?.({ kind: 'error', message: `Could not save the widget: ${errorText(err)}` })
    } finally {
      setBusy(false)
    }
  }
  return h(
    'div',
    { className: 'bd-editor' },
    h('div', { className: 'bd-editor-title' }, widget ? `Edit “${widget.title}”` : 'New widget'),
    h('input', { className: 'desktop-input-chrome bd-input', placeholder: 'Widget title', 'aria-label': 'Widget title', value: title, maxLength: 80, onChange: e => setTitle(e.target.value) }),
    h('textarea', { className: 'desktop-input-chrome bd-input bd-textarea mono', rows: 9, placeholder: '<div>Widget HTML…</div>', 'aria-label': 'Widget HTML', value: html, spellCheck: false, onChange: e => setHtml(e.target.value) }),
    h('div', { className: 'bd-hint' }, 'Tip: you can also ask the bot in chat, for example “add a weekly sleep chart to your panel”.'),
    h('div', { style: { display: 'flex', gap: 6, justifyContent: 'flex-end' } },
      h('button', { type: 'button', className: 'bd-btn', onClick: onDone }, 'Cancel'),
      h('button', { type: 'button', className: 'bd-btn primary', disabled: busy || !title.trim() || !html.trim(), onClick: save }, busy ? 'Saving…' : 'Save widget'))
  )
}

const CARD_LABELS = { profile: 'Profile', jobs: 'Scheduled jobs', tasks: 'Tasks', notes: 'Notes', projects: 'Projects', members: 'Members', activity: 'Activity' }

function CustomizePanel({ bot, onChanged, onClose }) {
  const panel = bot.panel || { layout: { order: [], hidden: [] }, widgets: [] }
  const [order, setOrder] = useState(panel.layout.order)
  const [hidden, setHidden] = useState(panel.layout.hidden)
  const [editing, setEditing] = useState(undefined)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setOrder(panel.layout.order); setHidden(panel.layout.hidden) }, [bot.id, panel.layout.order.join(), panel.layout.hidden.join()])

  const widgetFor = key => panel.widgets.find(w => `w:${w.id}` === key)
  const label = key => CARD_LABELS[key] || widgetFor(key)?.title || key

  const persist = async (nextOrder, nextHidden) => {
    setOrder(nextOrder)
    setHidden(nextHidden)
    setBusy(true)
    try {
      await rest('/panel/layout', { method: 'POST', body: { bot: bot.id, order: nextOrder, hidden: nextHidden } })
      await onChanged()
    } catch (err) {
      host.notify?.({ kind: 'error', message: `Could not save the layout: ${errorText(err)}` })
    } finally {
      setBusy(false)
    }
  }

  const move = (i, d) => {
    const j = i + d
    if (j < 0 || j >= order.length) return
    const next = order.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    persist(next, hidden)
  }

  const toggle = key => persist(order, hidden.includes(key) ? hidden.filter(k => k !== key) : [...hidden, key])

  const removeWidget = async w => {
    if (!window.confirm(`Remove the widget “${w.title}” from ${noun(bot)}'s panel?`)) return
    try {
      await rest('/panel/widget/remove', { method: 'POST', body: { bot: bot.id, id: w.id } })
      await onChanged()
    } catch (err) {
      host.notify?.({ kind: 'error', message: `Could not remove the widget: ${errorText(err)}` })
    }
  }

  if (editing !== undefined) {
    return h(WidgetEditor, { bot, widget: editing, onChanged, onDone: () => setEditing(undefined) })
  }

  return h(
    'div',
    { className: 'bd-editor', role: 'region', 'aria-label': 'Customize this panel' },
    h('div', { className: 'bd-editor-title' }, isGroup(bot) ? `Customize ${bot.name}` : `Customize @${bot.id}'s panel`, h(Info, { text: isGroup(bot)
      ? 'Reorder cards with the arrows, hide the ones you do not need, and add or edit custom widgets. The layout is saved for this group only.'
      : 'Reorder cards with the arrows, hide the ones you do not need, and add or edit custom widgets. Changes save to this bot\'s profile, so the bot sees the same layout.' })),
    order.map((key, i) => {
      const w = widgetFor(key)
      const isHidden = hidden.includes(key)
      return h(
        'div',
        { className: `bd-layout-row${isHidden ? ' off' : ''}`, key },
        h('span', { className: 'bd-layout-name' }, label(key), w ? h('span', { className: 'bd-pill muted', style: { marginLeft: 6 } }, 'Widget') : null),
        h('button', { type: 'button', className: 'bd-mini', disabled: busy || i === 0, onClick: () => move(i, -1), title: 'Move up', 'aria-label': `Move ${label(key)} up` }, '↑'),
        h('button', { type: 'button', className: 'bd-mini', disabled: busy || i === order.length - 1, onClick: () => move(i, 1), title: 'Move down', 'aria-label': `Move ${label(key)} down` }, '↓'),
        key === 'profile' ? null : h('button', { type: 'button', className: 'bd-mini', disabled: busy, onClick: () => toggle(key) }, isHidden ? 'Show' : 'Hide'),
        w ? h('button', { type: 'button', className: 'bd-mini', onClick: () => setEditing(w) }, 'Edit') : null,
        w ? h('button', { type: 'button', className: 'bd-mini danger', onClick: () => removeWidget(w) }, 'Remove') : null
      )
    }),
    h('div', { style: { display: 'flex', gap: 6, justifyContent: 'space-between', marginTop: 4 } },
      h('button', { type: 'button', className: 'bd-btn', onClick: () => setEditing(null) }, '+ Add widget'),
      h('button', { type: 'button', className: 'bd-btn primary', onClick: onClose }, 'Done'))
  )
}


// ---------------------------------------------------------------- groups

const epochIso = s => (typeof s === 'number' && s > 0 ? new Date(s * 1000).toISOString() : '')
const humanKind = k => {
  const t = String(k || 'event').replace(/[._-]+/g, ' ').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** Member colours as a gradient, so a group reads as "many bots" at a glance. */
function groupGradient(members) {
  const colors = [...new Set(members.map(m => m.color).filter(c => /^#[0-9a-f]{3,8}$/i.test(c || '')))]
  if (colors.length === 0) return 'var(--ui-accent)'
  if (colors.length === 1) return colors[0]
  return `linear-gradient(90deg, ${colors.map((c, i) => `${c} ${Math.round((i / (colors.length - 1)) * 100)}%`).join(', ')})`
}

function AvatarStack({ members, max = 5 }) {
  const shown = members.slice(0, max)
  const extra = members.length - shown.length
  return h(
    'div',
    { className: 'bd-stack', 'aria-label': `${members.length} members` },
    shown.map(m => h('span', { key: m.id, className: `bd-stack-face${m.missing ? ' gone' : ''}`, title: m.name }, h(BotAvatar, { bot: m }))),
    extra > 0 ? h('span', { className: 'bd-stack-face bd-stack-more', title: members.slice(max).map(m => m.name).join(', ') }, `+${extra}`) : null
  )
}

function GroupHero({ bot, loading, onRefresh, onCustomize, customizing }) {
  const members = bot.members
  const gone = members.filter(m => m.missing).length
  const status = bot.disbanded
    ? h('span', { className: 'bd-pill bad', title: 'The room was disbanded. History stays readable.' }, 'Disbanded')
    : bot.live
      ? h('span', { className: 'bd-pill ok', title: 'A gateway is driving this room now.' }, h('span', { className: 'bd-live' }), 'Live')
      : h('span', { className: 'bd-pill muted', title: 'No gateway is driving this room right now. It wakes when someone posts.' }, 'Idle')
  return h(
    'header',
    { className: 'bd-hero bd-hero-group' },
    h('div', { className: 'bd-group-strip', style: { background: groupGradient(members) }, 'aria-hidden': true }),
    h('button', { className: `bd-iconbtn${customizing ? ' on' : ''}`, type: 'button', style: { right: 44 }, title: 'Customize this panel', 'aria-label': 'Customize this panel', 'aria-pressed': !!customizing, onClick: onCustomize }, '✎'),
    h('button', { className: 'bd-iconbtn', type: 'button', title: 'Refresh the dashboard', 'aria-label': 'Refresh the dashboard', onClick: onRefresh },
      h('span', { className: loading ? 'bd-spin' : '', style: { display: 'inline-block' } }, '↻')),
    h(AvatarStack, { members }),
    h(
      'div',
      { style: { minWidth: 0, paddingRight: 4, marginTop: 10 } },
      h('h2', { className: 'bd-name', title: bot.name }, bot.name),
      h('div', { className: 'bd-section' }, h('span', { className: 'bd-kind' }, 'Group'), `${members.length} member${members.length === 1 ? '' : 's'}`)
    ),
    h('div', { className: 'bd-hero-pills' },
      status,
      bot.running ? h('span', { className: 'bd-pill warn', title: 'Member turns queued or running in this room.' }, `${bot.running} running`) : null,
      gone ? h('span', { className: 'bd-pill bad', title: 'Members whose bot profile was deleted or renamed.' }, `${gone} missing`) : null),
    h(
      'dl',
      { className: 'bd-facts', title: 'Read from the room record in Hermes' },
      h('dt', null, 'Members'),
      h('dd', { className: 'plain', title: members.map(m => m.name).join(', ') }, members.map(m => m.name).join(', ') || 'None'),
      h('dt', null, 'Activity'),
      h('dd', { className: 'plain' }, bot.eventCount ? `${bot.eventCount} event${bot.eventCount === 1 ? '' : 's'}` : 'None yet'),
      bot.updatedAt ? h('dt', null, 'Updated') : null,
      bot.updatedAt ? h('dd', { className: 'plain', title: epochIso(bot.updatedAt) }, relative(epochIso(bot.updatedAt))) : null,
      bot.createdAt ? h('dt', null, 'Created') : null,
      bot.createdAt ? h('dd', { className: 'plain', title: epochIso(bot.createdAt) }, new Date(bot.createdAt * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })) : null
    ),
    bot.disbanded ? h('p', { className: 'bd-desc' }, 'This group was disbanded. Its notes and history stay here; members no longer reply in it.') : null
  )
}

function MembersWidget({ bot }) {
  const openTasks = id => bot.tasks.filter(t => t.status !== 'done' && arr(t.owners).includes(id)).length
  return h(
    Card,
    {
      id: 'members',
      botId: bot.id,
      title: 'Members',
      count: bot.members.length,
      info: 'The bots in this room, as set in the group settings. Each row shows the member’s model and open tasks. A member marked Missing had its bot deleted or renamed; edit the group to remove or replace it.'
    },
    bot.members.length === 0
      ? h(Empty, null, 'This group has no members.')
      : bot.members.map(m => {
          const n = m.missing || m.remote ? 0 : openTasks(m.id)
          const open = !m.missing && !m.remote
          return h(
            'div',
            {
              className: `bd-row bd-member${m.missing ? ' gone' : ''}${open ? ' bd-link' : ''}`,
              key: m.id,
              style: m.color ? { '--bd-member': m.color } : undefined,
              role: open ? 'link' : undefined,
              tabIndex: open ? 0 : undefined,
              title: open ? `Open the @${m.handle || m.id} chat` : undefined,
              onClick: open ? () => openMemberChat(m.id) : undefined,
              onKeyDown: open
                ? e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      openMemberChat(m.id)
                    }
                  }
                : undefined
            },
            h('span', { className: 'bd-mface' }, h(BotAvatar, { bot: m })),
            h(
              'div',
              { className: 'bd-row-main' },
              h('div', { className: 'bd-row-title' }, m.name),
              h('div', { className: 'bd-row-sub', title: m.model || '' }, `@${m.handle || m.id}`, m.model ? ` · ${m.model}` : '')
            ),
            m.missing
              ? h('span', { className: 'bd-pill bad', title: 'This bot was deleted or renamed.' }, 'Missing')
              : m.remote
                ? h('span', { className: 'bd-pill muted', title: 'This member runs on another machine.' }, 'Remote')
                : n
                  ? h('span', { className: 'bd-pill muted', title: `${n} open task${n === 1 ? '' : 's'}` }, `${n} task${n === 1 ? '' : 's'}`)
                  : null
          )
        })
  )
}

function ActivityWidget({ bot }) {
  const events = bot.events
  return h(
    Card,
    {
      id: 'activity',
      botId: bot.id,
      title: 'Activity',
      count: bot.eventCount || null,
      info: 'The latest events in this room: messages, member turns and setting changes, newest first. The full conversation stays in the group chat.'
    },
    events.length === 0
      ? h(Empty, null, bot.disbanded ? 'No activity was recorded before the group was disbanded.' : 'No room activity yet. Post in the group chat to start.')
      : events.map(e =>
          h(
            'div',
            { className: 'bd-row bd-event', key: e.seq ?? `${e.kind}-${e.at}` },
            h('span', { className: 'bd-event-dot', 'aria-hidden': true }),
            h('div', { className: 'bd-row-main' },
              h('div', { className: 'bd-row-title' }, humanKind(e.kind)),
              h('div', { className: 'bd-row-sub' }, [e.actor, relative(epochIso(e.at))].filter(Boolean).join(' · ')))
          )
        )
  )
}

// ---------------------------------------------------------------- group pane

// Two panes, one plugin: "Bot" follows the focused bot, "Group" shows the group
// chat the user picked or opened. Everything here goes through the plugin SDK —
// the app's own markup is never read or clicked (catalog rule 8).

const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()
const GROUP_PANE = `${PLUGIN_ID}:group`

const groupStore = (() => {
  let value = null
  const subs = new Set()
  return {
    get: () => value,
    set(next) {
      value = next
      for (const fn of subs) fn(next)
    },
    sub(fn) {
      subs.add(fn)
      return () => subs.delete(fn)
    }
  }
})()

function rememberGroup(next) {
  groupStore.set(next)
  try {
    ctxRef?.storage?.set('group', next)
  } catch {
    /* a lost preference is not worth an error */
  }
}

function useSelectedGroup() {
  const [value, setValue] = useState(groupStore.get())
  useEffect(() => groupStore.sub(setValue), [])
  return value
}

let groupCache = { at: 0, list: [], error: '' }

/** Group chats this computer can read. Cached briefly; the pane polls it. */
async function fetchGroups(force) {
  if (!force && Date.now() - groupCache.at < 15_000) {
    if (groupCache.error) throw new Error(groupCache.error)
    return groupCache.list
  }
  try {
    const d = await rest('/groups')
    const all = Array.isArray(d) ? d : d && Array.isArray(d.groups) ? d.groups : []
    const list = all.filter(g => g && g.id && g.name && !g.disbanded)
    groupCache = { at: Date.now(), list, error: '' }
    return list
  } catch (err) {
    const text = errorText(err)
    groupCache = { at: Date.now(), list: groupCache.list, error: text }
    throw new Error(text)
  }
}

/** Bot id → the profile its backend runs as. */
function profileFor(id) {
  const v = String(id || '').trim()
  return !v || v === 'hermes' ? 'default' : v
}

/** Open a bot's one forever chat through the public SDK: the registry lookup the
 *  roster does, then `openSession`. */
async function openMemberChat(id) {
  if (!id) return
  const profile = profileFor(id)
  try {
    const res = await host.requestProfile(
      profile,
      'session.list',
      { profile, title: 'Bot Chat', limit: 50, include_hidden: true },
      45_000,
      { spawnPriority: 'foreground' }
    )
    const row = ((res && res.sessions) || []).find(s => s && s.id)
    if (!row) {
      host.notify({ kind: 'info', message: `@${id} has no chat yet. Open it once from the Bots list.` })
      return
    }
    await host.openSession(String(row.resolved_id || row.id), { profile })
  } catch (err) {
    host.notify({ kind: 'error', message: `Could not open @${id}: ${errorText(err)}` })
  }
}

/** Follow the chat in focus: when its title is a group's name, show that group. */
function useFollowFocusedChat(onTitle) {
  const storedId = useValue(host.state.focusedStoredSessionId)
  const profile = useValue(host.state.focusedSessionProfile)
  const act = useRef(onTitle)
  act.current = onTitle
  useEffect(() => {
    if (!storedId) return undefined
    let alive = true
    const name = profile || 'default'
    host
      .requestProfile(name, 'session.list', { profile: name, limit: 200, include_hidden: true }, 20_000)
      .then(res => {
        const row = ((res && res.sessions) || []).find(
          s => s && (String(s.id) === String(storedId) || String(s.resolved_id) === String(storedId))
        )
        if (alive && row && row.title) act.current(String(row.title))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [storedId, profile])
}

function GroupPicker({ groups, selected, onPick, onRefresh, busy }) {
  return h(
    'div',
    { className: 'bd-pick' },
    h(
      'select',
      {
        className: 'bd-select desktop-input-chrome',
        value: selected ? String(selected.id) : '',
        onChange: e => {
          const hit = groups.find(g => String(g.id) === e.target.value)
          if (hit) onPick({ id: hit.id, name: hit.name })
        },
        'aria-label': 'Group chat'
      },
      selected ? null : h('option', { value: '' }, groups.length ? 'Pick a group' : 'No group chats yet'),
      ...groups.map(g => h('option', { key: g.id, value: String(g.id) }, g.name))
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'bd-btn bd-refresh',
        onClick: onRefresh,
        disabled: busy,
        title: 'Read the group list again',
        'aria-label': 'Refresh groups'
      },
      busy ? '…' : '⟳'
    )
  )
}

function GroupPane() {
  const selected = useSelectedGroup()
  const [groups, setGroups] = useState(groupCache.list)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async force => {
    setBusy(true)
    try {
      const list = await fetchGroups(force)
      setGroups(list)
      setError('')
      if (!groupStore.get() && list.length) rememberGroup({ id: list[0].id, name: list[0].name })
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(() => load(), 15_000)
    return () => clearInterval(timer)
  }, [load])

  // A group chat opened anywhere in the app raises this pane and shows it here.
  useFollowFocusedChat(
    useCallback(title => {
      const hit = groupCache.list.find(g => norm(g.name) === norm(title))
      if (!hit || groupStore.get()?.id === hit.id) return
      rememberGroup({ id: hit.id, name: hit.name })
      if (typeof host.revealPane === 'function') host.revealPane(GROUP_PANE)
    }, [])
  )

  const head = h(GroupPicker, { groups, selected, onPick: rememberGroup, onRefresh: () => load(true), busy })

  if (!selected) {
    return h(
      'div',
      { className: 'bd-groups' },
      head,
      h(
        'div',
        { className: 'bd bd-group-empty' },
        h(
          'p',
          null,
          groups.length
            ? 'Pick a group chat to see its dashboard.'
            : error
              ? `The group list could not be read. ${error}`
              : 'No group chats yet. Make one from the Bots list.'
        )
      )
    )
  }

  return h(
    'div',
    { className: 'bd-groups', 'data-group': selected.id },
    head,
    h(Dashboard, { target: { kind: 'group', key: `group:id:${selected.id}` } })
  )
}

// ---------------------------------------------------------------- pane

function useBotId() {
  const focused = useValue(host.state.focusedSessionProfile)
  const live = useValue(host.state.profile)
  const id = String(focused || live || 'default').trim()
  return id === 'default' || !id ? 'hermes' : id
}

function Dashboard({ target }) {
  const { kind, key: botId } = target
  const group = kind === 'group'
  const base = group ? '/group' : ''
  const [state, setState] = useState({ key: null, data: null })
  const bot = state.key === `${kind}:${botId}` ? state.data : null
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const mine = ++seq.current
    setLoading(true)
    try {
      const data = await rest(`${group ? '/group' : '/bot'}?id=${encodeURIComponent(botId)}`)
      if (mine !== seq.current) return
      setState({ key: `${kind}:${botId}`, data: normalizeBot(data) })
      setError('')
    } catch (err) {
      if (mine !== seq.current) return
      setError(errorText(err))
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [botId, kind, group])

  useEffect(() => {
    setError('')
    load()
    // Cheap change check every few seconds (edits, deletes, renames, new tasks,
    // room changes), plus a slow full refresh for anything the marker misses.
    let last = null
    let stopped = false
    const check = async () => {
      if (document.hidden) return
      try {
        const { stamp } = await rest(`${base}/stamp?id=${encodeURIComponent(botId)}`)
        if (stopped) return
        if (last !== null && stamp !== last) load()
        last = stamp
      } catch {
        /* the full refresh still runs */
      }
    }
    check()
    const fast = setInterval(check, STAMP_MS)
    const slow = setInterval(load, REFRESH_MS)
    return () => {
      stopped = true
      clearInterval(fast)
      clearInterval(slow)
    }
  }, [load, botId, base])

  const [customizing, setCustomizing] = useState(false)
  useEffect(() => setCustomizing(false), [botId, kind])

  const accent = group ? bot?.members?.find(m => m.color)?.color : bot?.color
  const style = useMemo(() => (accent ? { '--bd-accent': accent } : undefined), [accent])

  if (bot && bot.missing) {
    const title = group
      ? bot.reason === 'invalid' ? 'This group could not be read' : 'This group is no longer here'
      : bot.reason === 'invalid' ? 'This chat has no bot profile' : `@${botId} is no longer here`
    const body = group
      ? 'The group was deleted, or its room has not reached this computer yet. Open a chat from the Bots list to see its dashboard.'
      : bot.reason === 'invalid'
        ? 'Open a bot from the Bots list to see its dashboard.'
        : 'The bot was deleted or renamed. Open a bot from the Bots list to see its dashboard.'
    return h('div', { className: `bd${group ? ' bd-group' : ''}`, 'data-bot': botId, 'data-version': '0.6.1' },
      h('div', { className: 'bd-card bd-missing' },
        h('div', { className: 'bd-missing-title' }, title),
        h('p', null, body),
        h('button', { type: 'button', className: 'bd-btn', onClick: load, disabled: loading }, loading ? 'Checking…' : 'Check again')))
  }

  if (!bot) {
    return h(
      'div',
      { className: `bd${group ? ' bd-group' : ''}` },
      error
        ? h(
            'div',
            { className: 'bd-error' },
            `The dashboard for ${group ? 'this group' : `@${botId}`} could not load. ${error} `,
            h('button', { type: 'button', className: 'bd-btn', onClick: load, style: { marginTop: 8 } }, 'Try again')
          )
        : [h('div', { className: 'bd-skeleton', key: 1, style: { height: 150 } }), h('div', { className: 'bd-skeleton', key: 2 }), h('div', { className: 'bd-skeleton', key: 3 })]
    )
  }

  const layout = bot.panel.layout
  const widgets = bot.panel.widgets
  const cardFor = key => h(CardBoundary, { key, label: key.startsWith('w:') ? 'widget' : `${CARD_LABELS[key] || key} card`, resetKey: `${bot.id}:${key}` }, cardBody(key))
  const cardBody = key => {
    const heroProps = { bot, loading, onRefresh: load, onCustomize: () => setCustomizing(c => !c), customizing }
    if (key === 'profile') return h(group ? GroupHero : Hero, heroProps)
    if (key === 'jobs' && !group) return h(JobsWidget, { botId: bot.id })
    if (key === 'members' && group) return h(MembersWidget, { bot })
    if (key === 'activity' && group) return h(ActivityWidget, { bot })
    if (key === 'tasks') return h(TasksWidget, { bot, onChanged: load })
    if (key === 'notes') return h(NotesWidget, { bot, onChanged: load })
    if (key === 'projects') return h(ProjectsWidget, { bot })
    const w = widgets.find(x => `w:${x.id}` === key)
    return w ? h(CustomWidget, { bot, widget: w }) : null
  }
  const visible = layout.order.filter(k => k === 'profile' || !layout.hidden.includes(k))
  const heroAt = Math.max(0, visible.indexOf('profile'))

  return h(
    'div',
    { className: `bd${group ? ' bd-group' : ''}`, style, 'data-bot': bot.id, 'data-kind': group ? 'group' : 'bot', 'data-version': '0.6.1' },
    ...visible.slice(0, heroAt + 1).map(cardFor),
    customizing ? h(CardBoundary, { key: 'customize', label: 'editor', resetKey: bot.id }, h(CustomizePanel, { bot, onChanged: load, onClose: () => setCustomizing(false) })) : null,
    error ? h('div', { className: 'bd-error', key: 'err' }, `Showing the last loaded data. ${error}`) : null,
    ...visible.slice(heroAt + 1).map(cardFor),
    bot.brain ? null : h('div', { className: 'bd-error', key: 'brain' }, 'HermesBrain was not found, so tasks and projects are empty.'),
    h('div', { className: 'bd-foot', key: 'foot' }, group ? `Group chat · ${bot.name}` : `Following @${bot.id}`)
  )
}

function BotDashboard() {
  return h(Dashboard, { target: { kind: 'bot', key: useBotId() } })
}

function Pane() {
  useEffect(ensureStyle, [])
  return h(BotDashboard)
}

function GroupTab() {
  useEffect(ensureStyle, [])
  return h(GroupPane)
}

export default {
  id: PLUGIN_ID,
  name: 'Bot & Group Dashboards',
  defaultEnabled: true,
  register(ctx) {
    ctxRef = ctx
    ensureStyle()
    try {
      const saved = ctx.storage?.get('group', null)
      if (saved && saved.id) groupStore.set(saved)
    } catch {
      /* first run */
    }
    ctx.register({
      id: 'pane',
      area: 'panes',
      title: 'Bot',
      data: {
        tabTitleText: () => 'Bot',
        placement: 'main',
        dock: { pane: 'hermes-bots:routines', pos: 'center' },
        width: '320px'
      },
      render: () => h(Pane)
    })
    ctx.register({
      id: 'groups',
      area: 'panes',
      title: 'Group',
      data: {
        tabTitleText: () => 'Group',
        placement: 'main',
        dock: { pane: 'hermes-bots:routines', pos: 'center' },
        width: '320px'
      },
      render: () => h(GroupTab)
    })
    ctx.onDispose?.(() => document.getElementById(STYLE_ID)?.remove())
  }
}
