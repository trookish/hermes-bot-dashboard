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

function Hero({ bot, loading, onRefresh }) {
  const initials = (bot.name || bot.id || '?').trim().slice(0, 1).toUpperCase()
  return h(
    'header',
    { className: 'bd-hero' },
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
        { style: { minWidth: 0, paddingRight: 30 } },
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

  return h(
    'div',
    { className: 'bd', style, 'data-bot': bot.id },
    h(Hero, { bot, loading, onRefresh: load }),
    error ? h('div', { className: 'bd-error' }, `Showing the last loaded data. ${error}`) : null,
    h(JobsWidget, { botId: bot.id }),
    h(TasksWidget, { bot, onChanged: load }),
    h(ProjectsWidget, { bot }),
    bot.brain ? null : h('div', { className: 'bd-error' }, 'HermesBrain was not found, so tasks and projects are empty.'),
    h('div', { className: 'bd-foot' }, `Follows the chat in focus · @${bot.id}`)
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
