
import React from 'react'
import { createRoot } from 'react-dom/client'
import plugin from 'C:/Users/trookish/Dev/Apps/hermes-bot-dashboard/desktop/plugin.js'
import DATA from './data.json'
const RID = 'group:id:d1b28c93-89f4-4e27-8b9b-8666591b2220'
const RID2 = 'group:id:old'
let pane
const store = {}
plugin.register({
  register: x => { pane = x },
  storage: { get: (k, f) => (k in store ? store[k] : f), set: (k, v) => { store[k] = v } },
  rest: async path => { const id = new URLSearchParams(path.split('?')[1] || '').get('id'); if (path.includes('/stamp')) return { stamp: 's' + Math.random() }; if (path.startsWith('/group')) return DATA[id] || { id, kind: 'group', missing: true, reason: 'deleted' }; return DATA[id] || { id, missing: true, reason: 'deleted' } },
  onDispose() {}
})
createRoot(document.getElementById('root')).render(pane.render())

const ws = document.getElementById('ws')
const pd = document.getElementById('pane')
const log = []
const sleep = ms => new Promise(r => setTimeout(r, ms))
const state = () => {
  const b = document.querySelector('.bd')
  const foot = document.querySelector('.bd-foot')?.textContent || ''
  return { kind: b?.getAttribute('data-kind') || 'none', bot: b?.getAttribute('data-bot') || '', foot }
}
// A group chat view exactly as the app marks it.
function groupView(key) {
  const el = document.createElement('div')
  el.className = 'gv'
  el.setAttribute('data-preview-annotate-destination', 'group')
  el.setAttribute('data-preview-annotate-owner-key', key)
  el.style.cssText = 'position:relative;width:340px;height:400px;background:#181818'
  return el
}
function botChat() {
  const el = document.createElement('div')
  el.className = 'chat'
  el.style.cssText = 'position:relative;width:340px;height:200px;background:#111'
  return el
}
async function step(name, fn, expect) {
  await fn()
  await sleep(950)
  let s = state()
  if ((expect === 'group2' && s.bot !== 'group:old') || (expect === 'group' && s.kind !== 'group')) { await sleep(1600); const s2 = state(); s = s2 }
  s.views = [...document.querySelectorAll('[data-preview-annotate-destination="group"]')].map(e => {
    const r = e.getBoundingClientRect()
    return { k: e.getAttribute('data-preview-annotate-owner-key'), w: Math.round(r.width), h: Math.round(r.height), inert: !!e.closest('[inert]'), inv: !!e.closest('.invisible'), vis: getComputedStyle(e).visibility, disp: getComputedStyle(e).display }
  })
  log.push({ step: name, expect, got: s.kind + (s.kind === 'group' ? ' ' + s.bot : ''), ok: expect === 'group' ? s.kind === 'group' && s.bot === 'group:d1b28c93-89f4-4e27-8b9b-8666591b2220' : expect === 'group2' ? s.kind === 'group' && s.bot === 'group:old' : s.kind === 'bot', foot: s.foot, views: s.views })
}
const fire = el => el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }))

;(async () => {
  await sleep(1200)
  const g1 = groupView(RID)
  ws.appendChild(g1)
  await step('group chat opens on screen', async () => {}, 'group')
  await step('click inside dashboard pane', async () => fire(document.querySelector('.bd-card-head') || document.querySelector('.bd')), 'group')
  const hidden = document.createElement('div')
  hidden.setAttribute('data-pane-host', 'group-tab')
  hidden.className = 'invisible'
  hidden.setAttribute('inert', '')
  hidden.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:hidden;visibility:hidden'
  const g2 = groupView(RID)
  hidden.appendChild(g2); document.body.appendChild(hidden)
  await step('a second copy of the room parked in a hidden tab', async () => {}, 'group')
  await step('bot chat opened (group tab hidden)', async () => { g1.style.display = 'none'; ws.appendChild(botChat()); fire(document.querySelector('.chat')) }, 'bot')
  await step('back to the group chat', async () => { g1.style.display = 'block'; fire(g1) }, 'group')
  await step('a second room opens in another pane', async () => { const g3 = groupView(RID2); g3.style.cssText += ';position:absolute;left:0;top:420px;width:340px;height:200px'; ws.appendChild(g3) }, 'group2')
  await step('split view: bot chat clicked while both are visible', async () => { const c = botChat(); c.style.cssText += ';position:absolute;left:400px;top:0'; ws.appendChild(c); fire(c) }, 'bot')
  await step('group clicked again in the split', async () => fire(g1), 'group')
  document.title = 'RESULT ' + JSON.stringify(log)
})()
