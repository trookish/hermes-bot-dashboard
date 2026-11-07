// Bot Dashboard: Hermes Desktop pane (disk plugin, loaded uncompiled).
// Shows the focused chat's bot: profile, scheduled jobs, TaskNotes and projects.
// Only @hermes/plugin-sdk and react may be imported here.
import { host, useValue } from '@hermes/plugin-sdk'
import React from 'react'

const h = React.createElement
const { useCallback, useEffect, useMemo, useRef, useState } = React

const PLUGIN_ID = 'bot-dashboard'
const STYLE_ID = 'bot-dashboard-style'
const REFRESH_MS = 30_000

let ctxRef = null

// ---------------------------------------------------------------- styles

const CSS = `
.bd{--bd-accent:var(--ui-accent);height:100%;overflow:auto;padding:12px 12px 20px;display:flex;flex-direction:column;gap:12px;
  color:var(--ui-text-primary);font-size:13px;line-height:1.45;background:var(--ui-bg-sidebar,transparent)}
.bd *{box-sizing:border-box}
.bd-hero{position:relative;border:1px solid var(--ui-stroke-secondary);border-radius:12px;padding:14px;overflow:hidden;
  background:linear-gradient(160deg,color-mix(in srgb,var(--bd-accent) 16%,transparent),transparent 70%),var(--ui-bg-card,var(--ui-bg-elevated))}
.bd-hero-top{display:flex;gap:12px;align-items:center}
.bd-avatar{width:52px;height:52px;border-radius:14px;flex:none;object-fit:cover;box-shadow:0 2px 10px rgba(0,0,0,.25)}
.bd-avatar-fallback{display:grid;place-items:center;font-weight:700;font-size:20px;color:#fff;background:var(--bd-accent)}
.bd-name{font-size:16px;font-weight:650;letter-spacing:-.01em;margin:0}
.bd-section{display:inline-flex;align-items:center;gap:6px;margin-top:3px;font-size:11px;font-weight:600;text-transform:uppercase;
  letter-spacing:.06em;color:var(--ui-text-secondary)}
.bd-dot{width:8px;height:8px;border-radius:50%;background:var(--bd-accent);flex:none}
.bd-desc{margin:10px 0 0;color:var(--ui-text-secondary)}
.bd-facts{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;margin-top:12px;font-size:12px}
.bd-facts dt{color:var(--ui-text-tertiary)}
.bd-facts dd{margin:0;color:var(--ui-text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--font-mono,ui-monospace,monospace);font-size:11.5px}
.bd-iconbtn{position:absolute;top:10px;right:10px;border:1px solid var(--ui-stroke-secondary);background:var(--ui-bg-elevated);
  color:var(--ui-text-secondary);border-radius:8px;width:28px;height:28px;display:grid;place-items:center;cursor:pointer}
.bd-iconbtn:hover{color:var(--ui-text-primary);border-color:var(--bd-accent)}
.bd-iconbtn:focus-visible,.bd button:focus-visible,.bd input:focus-visible{outline:2px solid var(--bd-accent);outline-offset:1px}
.bd-spin{animation:bd-spin .8s linear infinite}
@keyframes bd-spin{to{transform:rotate(360deg)}}
.bd-card{border:1px solid var(--ui-stroke-secondary);border-radius:12px;background:var(--ui-bg-card,var(--ui-bg-elevated));overflow:hidden}
.bd-card-head{display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;user-select:none;border:0;width:100%;
  background:transparent;color:inherit;font:inherit;text-align:left}
.bd-card-head:hover{background:var(--ui-row-hover-background)}
.bd-card-title{font-size:12px;font-weight:650;text-transform:uppercase;letter-spacing:.06em;color:var(--ui-text-secondary)}
.bd-count{font-size:11px;font-weight:600;padding:1px 7px;border-radius:999px;background:color-mix(in srgb,var(--bd-accent) 18%,transparent);color:var(--ui-text-primary)}
.bd-chev{margin-left:auto;color:var(--ui-text-tertiary);transition:transform .15s}
.bd-chev.open{transform:rotate(90deg)}
.bd-info{position:relative;display:inline-grid;place-items:center;width:16px;height:16px;border-radius:50%;font-size:10px;font-weight:700;
  color:var(--ui-text-tertiary);border:1px solid var(--ui-stroke-secondary);cursor:help;text-transform:none;letter-spacing:0}
.bd-info:hover{color:var(--ui-text-primary);border-color:var(--bd-accent)}
.bd-tip{display:none;position:absolute;left:-8px;top:22px;z-index:20;width:230px;padding:8px 10px;border-radius:8px;font-size:12px;font-weight:400;
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
.bd-btn{border:1px solid var(--ui-stroke-secondary);background:var(--ui-bg-elevated);color:var(--ui-text-primary);border-radius:7px;
  padding:3px 9px;font:inherit;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}
.bd-btn:hover{border-color:var(--bd-accent)}
.bd-btn:disabled{opacity:.5;cursor:default}
.bd-btn.primary{background:var(--bd-accent);border-color:var(--bd-accent);color:#fff}
.bd-check{appearance:none;flex:none;width:18px;height:18px;margin-top:1px;border-radius:5px;border:1.5px solid var(--ui-text-tertiary);cursor:pointer;
  display:grid;place-items:center;background:transparent}
.bd-check:checked{background:var(--bd-accent);border-color:var(--bd-accent)}
.bd-check:checked::after{content:'';width:5px;height:9px;border:solid #fff;border-width:0 2px 2px 0;transform:translateY(-1px) rotate(45deg)}
.bd-add{display:flex;gap:6px;margin-top:4px}
.bd-input{flex:1;min-width:0;border:1px solid var(--ui-stroke-secondary);background:var(--ui-bg-input,var(--ui-bg-secondary));color:var(--ui-text-primary);
  border-radius:7px;padding:5px 8px;font:inherit;font-size:12.5px}
.bd-input.date{flex:none;width:122px;color-scheme:light dark}
.bd-empty{padding:12px;text-align:center;color:var(--ui-text-tertiary);font-size:12.5px;border:1px dashed var(--ui-stroke-secondary);border-radius:9px}
.bd-link{background:none;border:0;padding:0;color:var(--ui-text-secondary);font:inherit;font-size:12px;cursor:pointer;text-decoration:underline;align-self:flex-start}
.bd-link:hover{color:var(--ui-text-primary)}
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
.bd-editor{display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:12px;border:1.5px solid var(--bd-accent);
  background:color-mix(in srgb,var(--bd-accent) 6%,var(--ui-bg-card,var(--ui-bg-elevated)))}
.bd-editor-title{display:flex;align-items:center;gap:8px;font-weight:650}
.bd-layout-row{display:flex;align-items:center;gap:2px;padding:5px 8px;border-radius:8px;border:1px solid var(--ui-stroke-secondary);background:var(--ui-bg-elevated)}
.bd-layout-row.off .bd-layout-name{color:var(--ui-text-tertiary);text-decoration:line-through}
.bd-layout-name{flex:1;min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bd-hint{font-size:11.5px;color:var(--ui-text-tertiary)}
`

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  document.head.appendChild(el)
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

function Card({ id, botId, title, count, info, actions, children }) {
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
      h('span', { className: `bd-chev${collapsed ? '' : ' open'}`, 'aria-hidden': true }, '›')
    ),
    collapsed ? null : h('div', { className: 'bd-body' }, actions || null, children)
  )
}

function Empty({ children }) {
  return h('div', { className: 'bd-empty' }, children)
}

// ---------------------------------------------------------------- widgets

function Hero({ bot, loading, onRefresh, onCustomize, customizing }) {
  const initials = (bot.name || bot.id || '?').trim().slice(0, 1).toUpperCase()
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
      bot.avatar
        ? h('img', { className: 'bd-avatar', src: bot.avatar, alt: '' })
        : h('div', { className: 'bd-avatar bd-avatar-fallback' }, initials),
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
      h('dt', null, 'Skills'),
      h('dd', null, `${bot.skillCount} installed`),
      bot.workspace ? h('dt', null, 'Workspace') : null,
      bot.workspace ? h('dd', { title: bot.workspace }, bot.workspace) : null
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
      await rest('/task', { method: 'POST', body: { bot: bot.id, title: text, due: due || null } })
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
      info: 'TaskNotes in HermesBrain that carry bot: ' + bot.id + '. Tick a task to mark it done; the note in the vault updates. New tasks are saved as TaskNotes for this bot.'
    },
    open.length === 0 ? h(Empty, null, 'No open tasks for this bot.') : open.map(row),
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
        className: 'bd-input',
        placeholder: 'Add a task for this bot',
        'aria-label': 'New task title',
        value: title,
        maxLength: 200,
        onChange: e => setTitle(e.target.value)
      }),
      h('input', {
        className: 'bd-input date',
        type: 'date',
        'aria-label': 'Due date (optional)',
        title: 'Due date (optional)',
        value: due,
        onChange: e => setDue(e.target.value)
      }),
      h('button', { type: 'submit', className: 'bd-btn primary', disabled: busy || !title.trim() }, busy ? '…' : 'Add')
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
      info: `Project notes in HermesBrain/02 Projects that carry bot: ${bot.id}. A project not updated for ${14} days or more is flagged as stale.`
    },
    bot.projects.length === 0
      ? h(Empty, null, 'No projects are linked to this bot.')
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
                h('span', { className: `bd-pill ${tone(p.status)}` }, p.status)
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
      info: 'Notes shared between you and this bot. You can write here; the bot reads and writes the same notes with its bot_panel tool. Pinned notes stay on top.'
    },
    h(
      'form',
      { className: 'bd-note-add', onSubmit: add },
      h('textarea', {
        className: 'bd-input bd-textarea',
        placeholder: 'Write a note for this bot',
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
                  h('textarea', { className: 'bd-input bd-textarea', rows: 4, value: draft, maxLength: 4000, 'aria-label': 'Edit note',
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
  return `:root{${vars}color-scheme:light dark}html,body{margin:0;padding:0;background:transparent;color:var(--foreground);font-family:${body.fontFamily};font-size:13px}`
}

// Reports height to the parent and scales content wider than the frame down to fit.
const FIT_SCRIPT = `<script>(function(){var id=%ID%;function fit(){var b=document.body;if(!b)return;b.style.zoom='';var w=document.documentElement.clientWidth,s=Math.max(b.scrollWidth,document.documentElement.scrollWidth);var z=s>w+2?w/s:1;if(z<1)b.style.zoom=z;var hgt=Math.ceil(document.documentElement.scrollHeight);parent.postMessage({bdWidget:id,height:hgt},'*')}window.addEventListener('load',fit);window.addEventListener('resize',fit);new MutationObserver(function(){requestAnimationFrame(fit)}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});setTimeout(fit,50);setTimeout(fit,600)})();<\/script>`

function buildDoc(widget, accent) {
  const html = widget.html || ''
  const head = `<meta charset="utf-8"><style>${themeCss(accent)}</style>`
  const script = FIT_SCRIPT.replace('%ID%', JSON.stringify(widget.id))
  if (/<html[\s>]/i.test(html)) {
    let doc = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + head) : html.replace(/<html[^>]*>/i, m => m + '<head>' + head + '</head>')
    doc = /<\/body>/i.test(doc) ? doc.replace(/<\/body>/i, script + '</body>') : doc + script
    return doc
  }
  return `<!doctype html><html><head>${head}</head><body>${html}${script}</body></html>`
}

function WidgetFrame({ widget, accent }) {
  const [height, setHeight] = useState(widget.height || 120)
  const doc = useMemo(() => buildDoc(widget, accent), [widget.html, widget.id, accent])
  useEffect(() => {
    if (widget.height) return undefined
    const onMsg = e => {
      if (e.data && e.data.bdWidget === widget.id && typeof e.data.height === 'number') {
        setHeight(Math.max(40, Math.min(e.data.height, 2400)))
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [widget.id, widget.height])
  return h('iframe', {
    className: 'bd-frame',
    title: widget.title,
    sandbox: 'allow-scripts',
    srcDoc: doc,
    style: { height: widget.height || height }
  })
}

function CustomWidget({ bot, widget }) {
  return h(
    Card,
    {
      id: `w:${widget.id}`,
      botId: bot.id,
      title: widget.title,
      info: `A custom widget ${widget.author === 'bot' ? `built by @${bot.id}` : 'you added'}. Ask the bot in chat to change it, or use Customize to edit its HTML. Last updated ${widget.updated || 'unknown'}.`
    },
    h(WidgetFrame, { widget, accent: bot.color })
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
    h('input', { className: 'bd-input', placeholder: 'Widget title', 'aria-label': 'Widget title', value: title, maxLength: 80, onChange: e => setTitle(e.target.value) }),
    h('textarea', { className: 'bd-input bd-textarea mono', rows: 9, placeholder: '<div>Widget HTML…</div>', 'aria-label': 'Widget HTML', value: html, spellCheck: false, onChange: e => setHtml(e.target.value) }),
    h('div', { className: 'bd-hint' }, 'Tip: you can also ask the bot in chat, for example “add a weekly sleep chart to your panel”.'),
    h('div', { style: { display: 'flex', gap: 6, justifyContent: 'flex-end' } },
      h('button', { type: 'button', className: 'bd-btn', onClick: onDone }, 'Cancel'),
      h('button', { type: 'button', className: 'bd-btn primary', disabled: busy || !title.trim() || !html.trim(), onClick: save }, busy ? 'Saving…' : 'Save widget'))
  )
}

const CARD_LABELS = { profile: 'Profile', jobs: 'Scheduled jobs', tasks: 'Tasks', notes: 'Notes', projects: 'Projects' }

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
    if (!window.confirm(`Remove the widget “${w.title}” from this panel?`)) return
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
    h('div', { className: 'bd-editor-title' }, `Customize @${bot.id}'s panel`, h(Info, { text: 'Reorder cards with the arrows, hide the ones you do not need, and add or edit custom widgets. Changes save to this bot\'s profile, so the bot sees the same layout.' })),
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

// ---------------------------------------------------------------- pane

function useBotId() {
  const focused = useValue(host.state.focusedSessionProfile)
  const live = useValue(host.state.profile)
  const id = String(focused || live || 'default').trim()
  return id === 'default' || !id ? 'hermes' : id
}

function BotDashboard() {
  const botId = useBotId()
  const [bot, setBot] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const mine = ++seq.current
    setLoading(true)
    try {
      const data = await rest(`/bot?id=${encodeURIComponent(botId)}`)
      if (mine !== seq.current) return
      setBot(data)
      setError('')
    } catch (err) {
      if (mine !== seq.current) return
      setError(errorText(err))
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [botId])

  useEffect(() => {
    setBot(b => (b && b.id === botId ? b : null))
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [load, botId])

  const [customizing, setCustomizing] = useState(false)
  useEffect(() => setCustomizing(false), [botId])

  const style = useMemo(() => (bot?.color ? { '--bd-accent': bot.color } : undefined), [bot?.color])

  if (!bot) {
    return h(
      'div',
      { className: 'bd' },
      error
        ? h(
            'div',
            { className: 'bd-error' },
            `The dashboard for @${botId} could not load. ${error} `,
            h('button', { type: 'button', className: 'bd-btn', onClick: load, style: { marginTop: 8 } }, 'Try again')
          )
        : [h('div', { className: 'bd-skeleton', key: 1, style: { height: 150 } }), h('div', { className: 'bd-skeleton', key: 2 }), h('div', { className: 'bd-skeleton', key: 3 })]
    )
  }

  const layout = bot.panel?.layout || { order: ['profile', 'jobs', 'tasks', 'notes', 'projects'], hidden: [] }
  const widgets = bot.panel?.widgets || []
  const cardFor = key => {
    if (key === 'profile') return h(Hero, { key, bot, loading, onRefresh: load, onCustomize: () => setCustomizing(c => !c), customizing })
    if (key === 'jobs') return h(JobsWidget, { key, botId: bot.id })
    if (key === 'tasks') return h(TasksWidget, { key, bot, onChanged: load })
    if (key === 'notes') return h(NotesWidget, { key, bot, onChanged: load })
    if (key === 'projects') return h(ProjectsWidget, { key, bot })
    const w = widgets.find(x => `w:${x.id}` === key)
    return w ? h(CustomWidget, { key, bot, widget: w }) : null
  }
  const visible = layout.order.filter(k => k === 'profile' || !layout.hidden.includes(k))
  const heroAt = visible.indexOf('profile')

  return h(
    'div',
    { className: 'bd', style, 'data-bot': bot.id },
    ...visible.slice(0, heroAt + 1).map(cardFor),
    customizing ? h(CustomizePanel, { key: 'customize', bot, onChanged: load, onClose: () => setCustomizing(false) }) : null,
    error ? h('div', { className: 'bd-error', key: 'err' }, `Showing the last loaded data. ${error}`) : null,
    ...visible.slice(heroAt + 1).map(cardFor),
    bot.brain ? null : h('div', { className: 'bd-error', key: 'brain' }, 'HermesBrain was not found, so tasks and projects are empty.'),
    h('div', { className: 'bd-foot', key: 'foot' }, `Follows the chat in focus · @${bot.id}`)
  )
}

function Pane() {
  useEffect(ensureStyle, [])
  return h(BotDashboard)
}

export default {
  id: PLUGIN_ID,
  name: 'Bot Dashboard',
  defaultEnabled: true,
  register(ctx) {
    ctxRef = ctx
    ensureStyle()
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
    ctx.onDispose?.(() => document.getElementById(STYLE_ID)?.remove())
  }
}
