// Bot Dashboard: Hermes Desktop pane (disk plugin, loaded uncompiled).
// Shows the focused chat's bot: profile, scheduled jobs, tasks, notes and projects.
// Only @hermes/plugin-sdk and react may be imported here.
import * as sdk from '@hermes/plugin-sdk'
import { host, useValue } from '@hermes/plugin-sdk'
import React from 'react'

const h = React.createElement
const { useCallback, useEffect, useMemo, useRef, useState } = React

const PLUGIN_ID = 'bot-dashboard'
const STYLE_ID = 'bot-dashboard-style'
// Bump to have the two panes un-dismissed once after an upgrade.
const PANE_RESTORE_KEY = 'panes-restored-v2'
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
.bd-iconbtn{font-variant-emoji:text;font-family:inherit}
.bd-iconbtn .bd-glyph{font-variant-emoji:text;text-rendering:geometricPrecision;color:inherit}
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
.bd-row{display:flex;gap:10px;align-items:flex-start;padding:var(--bd-row-pad,8px 10px);border-radius:9px;border:1px solid var(--ui-stroke-tertiary,var(--ui-stroke-secondary));
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
/* ---- windows, search, chips ---- */
.bd-overlay-box.wide{width:min(1080px,100%)}
.bd-overlay-foot{flex:none;display:flex;align-items:center;gap:8px;padding:10px 14px;border-top:1px solid var(--ui-stroke-secondary)}
.bd-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
.bd-search{display:flex;align-items:center;gap:6px;flex:1 1 200px;min-width:160px;border:1px solid var(--ui-stroke-secondary);border-radius:9px;padding:0 8px;background:var(--ui-bg-card,var(--ui-bg-elevated))}
.bd-search:focus-within{border-color:var(--bd-accent)}
.bd-search-ico{color:var(--ui-text-tertiary);font-size:14px;flex:none}
.bd-search .bd-input{border:none;background:transparent;padding:6px 0}
.bd-chips{display:flex;flex-wrap:wrap;gap:5px}
.bd-chip{border:1px solid var(--ui-stroke-secondary);background:transparent;color:var(--ui-text-secondary);border-radius:999px;padding:2px 10px;font:inherit;font-size:11.5px;cursor:pointer;white-space:nowrap}
.bd-chip:hover{border-color:var(--bd-accent);color:var(--ui-text-primary)}
.bd-chip.on{background:var(--bd-accent);border-color:var(--bd-accent);color:#fff}
.bd-win-meta{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:11.5px;color:var(--ui-text-tertiary);margin-bottom:10px}
.bd-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.bd-tile{display:flex;flex-direction:column;gap:6px;text-align:left;border:1px solid var(--ui-stroke-secondary);border-radius:11px;padding:11px 12px;background:var(--ui-bg-card,var(--ui-bg-elevated));cursor:pointer;color:inherit;font:inherit;min-height:96px}
.bd-tile:hover{border-color:var(--bd-accent);background:var(--ui-row-hover-background)}
.bd-tile:focus-visible{outline:1px solid var(--bd-accent);outline-offset:1px}
.bd-tile-title{font-weight:650;font-size:13px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.bd-tile-snip{font-size:11.5px;color:var(--ui-text-secondary);line-height:1.45;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;flex:1}
.bd-tile-foot{display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-top:auto}
.bd-open-btn{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;margin-top:8px;border:1px dashed var(--ui-stroke-secondary);background:transparent;color:var(--ui-text-secondary);border-radius:9px;padding:7px;font:inherit;font-size:12px;cursor:pointer}
.bd-open-btn:hover{border-color:var(--bd-accent);color:var(--ui-text-primary);background:var(--ui-row-hover-background)}
.bd-seg{display:inline-flex;border:1px solid var(--ui-stroke-secondary);border-radius:8px;overflow:hidden}
.bd-seg button{border:none;background:transparent;color:var(--ui-text-secondary);padding:4px 12px;font:inherit;font-size:12px;cursor:pointer}
.bd-seg button.on{background:var(--bd-accent);color:#fff}
/* ---- markdown ---- */
.bd-md{font-size:13px;line-height:1.6;color:var(--ui-text-primary);word-wrap:break-word}
.bd-md>*:first-child{margin-top:0}
.bd-md>*:last-child{margin-bottom:0}
.bd-md-h{margin:14px 0 6px;line-height:1.3;font-weight:700}
h1.bd-md-h{font-size:19px}h2.bd-md-h{font-size:17px}h3.bd-md-h{font-size:15px}h4.bd-md-h,h5.bd-md-h,h6.bd-md-h{font-size:13.5px}
.bd-md-p{margin:6px 0}
.bd-md-list{margin:6px 0;padding-left:24px;list-style:disc}
.bd-md-list ol,.bd-md-list.bd-ordered{list-style:decimal}
.bd-md-list li{margin:3px 0;padding-left:2px}
.bd-md-list li::marker{color:var(--bd-accent)}
.bd-md-task{list-style:none;display:flex;gap:8px;align-items:flex-start;margin-left:-18px}
.bd-md-check{flex:none;width:16px;height:16px;margin-top:2px;border:1.5px solid var(--ui-text-tertiary);border-radius:4px;display:inline-grid;place-items:center;font-size:11px;color:#fff}
.bd-md-check.done{background:var(--bd-accent);border-color:var(--bd-accent)}
.bd-md-done{color:var(--ui-text-tertiary);text-decoration:line-through}
.bd-md-code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;background:var(--ui-bg-tertiary,var(--ui-bg-secondary));border:1px solid var(--ui-stroke-tertiary,var(--ui-stroke-secondary));border-radius:5px;padding:1px 5px}
.bd-md-pre{background:var(--ui-bg-tertiary,var(--ui-bg-secondary));border:1px solid var(--ui-stroke-secondary);border-radius:9px;padding:10px 12px;overflow:auto;margin:8px 0}
.bd-md-pre code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.5;white-space:pre}
.bd-md-quote{border-left:3px solid var(--bd-accent);margin:8px 0;padding:2px 0 2px 12px;color:var(--ui-text-secondary)}
.bd-md-hr{border:none;border-top:1px solid var(--ui-stroke-secondary);margin:12px 0}
.bd-md-link{color:var(--bd-accent);text-decoration:underline;text-underline-offset:2px}
.bd-md-wiki{color:var(--bd-accent);background:color-mix(in srgb,var(--bd-accent) 12%,transparent);border-radius:4px;padding:0 4px;cursor:default}
.bd-md-tag{color:var(--bd-accent);font-size:12px;font-weight:600}
.bd-md-table{border-collapse:collapse;width:100%;margin:8px 0;font-size:12.5px}
.bd-md-table th,.bd-md-table td{border:1px solid var(--ui-stroke-secondary);padding:5px 9px;text-align:left}
.bd-md-table th{background:var(--ui-bg-secondary);font-weight:650}
.bd-md-img{max-width:100%;border-radius:8px;display:block;margin:8px 0}
.bd-md-mark{background:color-mix(in srgb,var(--ui-yellow) 35%,transparent);color:inherit;border-radius:3px;padding:0 3px}
.bd-md-sup{font-size:10px;vertical-align:super;color:var(--bd-accent)}
/* ---- note editor ---- */
.bd-note-editor{display:flex;flex-direction:column;gap:10px;height:min(72vh,680px)}
.bd-note-titlebar{display:flex;gap:8px;align-items:center;flex:none}
.bd-note-titlebar .bd-input{font-size:16px;font-weight:650}
.bd-md-tools{display:flex;flex-wrap:wrap;gap:4px;flex:none}
.bd-md-tool{border:1px solid var(--ui-stroke-secondary);background:var(--ui-bg-card,var(--ui-bg-elevated));color:var(--ui-text-secondary);
  border-radius:6px;min-width:26px;height:24px;padding:0 6px;font:inherit;font-size:12px;cursor:pointer}
.bd-md-tool:hover{border-color:var(--bd-accent);color:var(--ui-text-primary)}
.bd-md-tool b{font-weight:700}
.bd-note-split{display:grid;grid-template-columns:1fr 1fr;gap:12px;flex:1;min-height:0}
.bd-note-split.single{grid-template-columns:1fr}
.bd-note-pane{display:flex;flex-direction:column;min-height:0;border:1px solid var(--ui-stroke-secondary);border-radius:10px;overflow:hidden}
.bd-note-pane-label{flex:none;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ui-text-tertiary);padding:5px 10px;border-bottom:1px solid var(--ui-stroke-secondary);background:var(--ui-bg-secondary)}
.bd-note-pane textarea{flex:1;min-height:0;border:none;resize:none;background:transparent;color:var(--ui-text-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;line-height:1.6;padding:12px;outline:none}
.bd-note-read{flex:1;min-height:0;overflow:auto;padding:12px 14px}
.bd-save-state{font-size:11px;color:var(--ui-text-tertiary)}
.bd-save-state.dirty{color:var(--ui-yellow)}
.bd-save-state.saved{color:var(--ui-green)}
/* ---- members / activity ---- */
.bd-state-dot{flex:none;width:8px;height:8px;border-radius:50%;margin-top:6px;background:var(--ui-text-quaternary)}
.bd-state-dot.running{background:var(--ui-green);box-shadow:0 0 0 3px color-mix(in srgb,var(--ui-green) 22%,transparent);animation:bd-pulse 1.6s ease-in-out infinite}
.bd-state-dot.queued,.bd-state-dot.deferred{background:var(--ui-yellow)}
.bd-state-dot.idle{background:var(--ui-text-quaternary)}
@keyframes bd-pulse{0%,100%{opacity:1}50%{opacity:.45}}
.bd-doing{font-size:11.5px;color:var(--ui-text-secondary);margin-top:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.bd-event-text{font-size:12px;color:var(--ui-text-secondary);margin-top:3px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}
.bd-act-day{font-size:11px;font-weight:650;letter-spacing:.04em;text-transform:uppercase;color:var(--ui-text-tertiary);margin:14px 0 6px}
.bd-act-day:first-child{margin-top:0}
.bd-load-more{display:block;width:100%;margin-top:10px}
.bd-inline-form{display:flex;flex-direction:column;gap:8px;padding:11px;border:1px solid var(--bd-accent);border-radius:11px;background:color-mix(in srgb,var(--bd-accent) 6%,var(--ui-bg-card,var(--ui-bg-elevated)));margin-bottom:10px}
.bd-inline-form .bd-form-row{display:flex;gap:6px;flex-wrap:wrap}
.bd-inline-form label{font-size:11px;color:var(--ui-text-tertiary);display:flex;flex-direction:column;gap:3px;flex:1;min-width:120px}
.bd-path{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:var(--ui-text-tertiary);word-break:break-all}
.bd-todo-ico{flex:none;width:18px;text-align:center;font-size:12px;margin-top:2px;color:var(--ui-text-tertiary)}
.bd-todo-ico.ok{color:var(--ui-green)}
.bd-todo-ico.warn{color:var(--ui-yellow)}
.bd-note-tile{display:flex;flex-direction:column;gap:5px;width:100%;text-align:left;font:inherit;color:inherit;cursor:pointer}
.bd-note-tile:hover{border-color:var(--bd-accent)}
/* ---- themed dropdown (Select) ---- */
.bd-dd{position:relative;display:inline-flex;min-width:0}
.bd-dd-trigger{display:inline-flex;align-items:center;gap:6px;width:100%;min-width:0;font:inherit;font-size:12px;
  padding:5px 8px;border-radius:8px;border:1px solid var(--ui-stroke-secondary);cursor:pointer;text-align:left;
  background:var(--ui-bg-card,var(--ui-bg-elevated));color:var(--ui-text-primary)}
.bd-dd-trigger:hover{border-color:color-mix(in srgb,var(--bd-accent) 55%,var(--ui-stroke-secondary))}
.bd-dd-trigger:focus-visible,.bd-dd.open .bd-dd-trigger{outline:none;border-color:var(--bd-accent)}
.bd-dd-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bd-dd-caret{flex:none;font-size:10px;color:var(--ui-text-tertiary);transition:transform .15s ease}
.bd-dd.open .bd-dd-caret{transform:rotate(180deg)}
.bd-dd-menu{position:absolute;z-index:1200;left:0;min-width:100%;max-height:260px;overflow:auto;
  display:flex;flex-direction:column;gap:2px;padding:4px;border-radius:10px;
  border:1px solid var(--ui-stroke-secondary);background:var(--ui-bg-elevated,var(--ui-bg-card));
  color:var(--ui-text-primary);box-shadow:0 10px 30px rgba(0,0,0,.35)}
.bd-dd-menu.down{top:calc(100% + 4px)}
.bd-dd-menu.up{bottom:calc(100% + 4px)}
.bd-dd-opt{display:flex;align-items:center;gap:6px;width:100%;border:none;background:transparent;color:inherit;
  font:inherit;font-size:12px;text-align:left;padding:6px 8px;border-radius:7px;cursor:pointer;white-space:nowrap}
.bd-dd-opt:hover,.bd-dd-opt.active{background:var(--ui-row-hover-background,var(--ui-bg-hover))}
.bd-dd-opt.on{color:var(--bd-accent);font-weight:650}
.bd-dd-opt .bd-dd-check{flex:none;width:12px;font-size:11px}
/* native selects that remain (group picker) follow the app color-scheme */
.bd-select{color-scheme:inherit}
.bd-select option{background:var(--ui-bg-elevated,var(--ui-bg-card));color:var(--ui-text-primary)}
/* ---- hero tools: one aligned group, top-right, no magic offsets ---- */
.bd-hero-tools{position:absolute;top:10px;right:10px;display:flex;align-items:center;gap:6px;z-index:2}
.bd-hero-tools .bd-iconbtn{position:static;flex:none}
/* ---- settings ---- */
.bd-settings-group{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--ui-stroke-secondary);border-radius:11px;margin-bottom:10px}
.bd-settings-group h4{margin:0 0 2px;font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:var(--ui-text-tertiary)}
.bd-pref{display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap}
.bd-pref-label{display:flex;flex-direction:column;gap:1px;min-width:0;font-size:12.5px;font-weight:550;flex:1}
.bd-pref-label .bd-hint{font-weight:400}
.bd-pref-control{display:flex;gap:6px;align-items:center;flex:none;min-width:120px}
.bd-swatches{display:flex;gap:6px;flex-wrap:wrap}
.bd-swatch{width:22px;height:22px;border-radius:50%;border:2px solid var(--ui-stroke-secondary);cursor:pointer;padding:0}
.bd-swatch:hover{border-color:var(--ui-text-primary)}
.bd-swatch.on{border-color:var(--ui-text-primary);box-shadow:0 0 0 2px var(--bd-accent)}
.bd-swatch.auto{background:linear-gradient(135deg,var(--ui-bg-elevated) 50%,var(--bd-accent) 50%)}
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

// ---------------------------------------------------------------- shared window + markdown

/** A modal window with a header, a scrollable body and an optional footer.
 *  Inline (no portal): the plugin SDK only exposes React, not react-dom. */
function Win({ title, wide, onClose, footer, children, labelledBy }) {
  useEffect(() => {
    const onKey = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return h(
    'div',
    { className: 'bd-overlay', role: 'dialog', 'aria-modal': true, 'aria-label': title, onMouseDown: e => e.target === e.currentTarget && onClose() },
    h(
      'div',
      { className: `bd-overlay-box${wide ? ' wide' : ''}` },
      h(
        'div',
        { className: 'bd-overlay-head' },
        h('span', { className: 'bd-card-title', id: labelledBy }, title),
        h('button', { type: 'button', className: 'bd-btn', onClick: onClose, title: 'Close (Esc)' }, 'Close')
      ),
      h('div', { className: 'bd-overlay-body' }, children),
      footer ? h('div', { className: 'bd-overlay-foot' }, footer) : null
    )
  )
}

function SearchBox({ value, onChange, placeholder }) {
  return h(
    'label',
    { className: 'bd-search' },
    h('span', { className: 'bd-search-ico', 'aria-hidden': true }, '⌕'),
    h('input', {
      className: 'bd-input',
      type: 'search',
      placeholder: placeholder || 'Search…',
      'aria-label': placeholder || 'Search',
      value,
      onChange: e => onChange(e.target.value)
    })
  )
}

function ChipRow({ options, value, onChange, allLabel }) {
  const opts = [{ id: '', label: allLabel || 'All' }, ...options]
  return h(
    'div',
    { className: 'bd-chips', role: 'group' },
    opts.map(o =>
      h('button', {
        key: o.id || '__all',
        type: 'button',
        className: `bd-chip${value === o.id ? ' on' : ''}`,
        'aria-pressed': value === o.id,
        onClick: () => onChange(o.id)
      }, o.label)
    )
  )
}

const normText = s => String(s || '').toLowerCase()
function matches(hay, needle) {
  const n = normText(needle).trim()
  if (!n) return true
  const text = normText(hay)
  return n.split(/\s+/).every(w => text.includes(w))
}

/** A dropdown that follows the Hermes desktop theme (the native option popup
 *  cannot be themed). options: [{value, label}]. Keyboard: arrows, Enter,
 *  Escape, Home/End; closes on outside click. */
function Select({ value, options, onChange, label, style, className, disabled }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [up, setUp] = useState(false)
  const rootRef = useRef(null)
  const menuRef = useRef(null)
  const idx = options.findIndex(o => o.value === value)
  const current = idx >= 0 ? options[idx] : null

  useEffect(() => {
    if (!open) return undefined
    const onDown = e => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false) }
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  useEffect(() => {
    if (open && menuRef.current) {
      const el = menuRef.current.children[Math.max(0, active)]
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' })
    }
  }, [open, active])

  const openMenu = () => {
    if (disabled) return
    const rect = rootRef.current?.getBoundingClientRect()
    if (rect) setUp(window.innerHeight - rect.bottom < 280 && rect.top > 280)
    setActive(idx >= 0 ? idx : 0)
    setOpen(true)
  }

  const pick = i => {
    const o = options[i]
    if (o) onChange(o.value)
    setOpen(false)
  }

  const onKeyDown = e => {
    if (disabled) return
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); openMenu() }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(options.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0) }
    else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(active) }
    else if (e.key === 'Tab') setOpen(false)
  }

  return h(
    'div',
    { className: `bd-dd${open ? ' open' : ''}${className ? ` ${className}` : ''}`, style, ref: rootRef },
    h('button', {
      type: 'button',
      className: 'bd-dd-trigger desktop-input-chrome',
      'aria-haspopup': 'listbox',
      'aria-expanded': open,
      'aria-label': label,
      disabled,
      onClick: () => (open ? setOpen(false) : openMenu()),
      onKeyDown
    },
      h('span', { className: 'bd-dd-label' }, current ? current.label : '—'),
      h('span', { className: 'bd-dd-caret', 'aria-hidden': true }, '▾')),
    open
      ? h('div', { className: `bd-dd-menu ${up ? 'up' : 'down'}`, role: 'listbox', 'aria-label': label, ref: menuRef },
          options.map((o, i) =>
            h('button', {
              key: o.value,
              type: 'button',
              role: 'option',
              'aria-selected': o.value === value,
              className: `bd-dd-opt${o.value === value ? ' on' : ''}${i === active ? ' active' : ''}`,
              onMouseEnter: () => setActive(i),
              onClick: () => pick(i)
            },
              h('span', { className: 'bd-dd-check', 'aria-hidden': true }, o.value === value ? '✓' : ''),
              o.label)))
      : null
  )
}

// ---- Markdown renderer (Obsidian-flavoured subset, safe: no raw HTML) ----

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Inline spans: bold, italic, code, links, wikilinks, tags, strikethrough. */
function mdInline(text) {
  let s = escapeHtml(text)
  // code first, so markdown inside backticks is left alone
  const codes = []
  s = s.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0000C${codes.length - 1}\u0000` })
  s = s.replace(/!\[([^\]]*)\]\((https?:[^)\s]+)\)/g, '<img class="bd-md-img" src="$2" alt="$1">')
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, a) => `<span class="bd-md-wiki">${a || t}</span>`)
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)(?:\s+"[^"]*")?\)/g, '<a class="bd-md-link" href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a class="bd-md-link" href="$2" target="_blank" rel="noopener noreferrer">$2</a>')
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
  s = s.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>')
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^\w*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  s = s.replace(/(^|[^\w_])_([^_\n]+)_/g, '$1<em>$2</em>')
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  s = s.replace(/==([^=]+)==/g, '<mark class="bd-md-mark">$1</mark>')
  s = s.replace(/\^([^\^\s][^\^]*)\^/g, '<sup class="bd-md-sup">$1</sup>')
  s = s.replace(/(^|\s)(#[\w/-]+)/g, '$1<span class="bd-md-tag">$2</span>')
  s = s.replace(/\u0000C(\d+)\u0000/g, (_, n) => `<code class="bd-md-code">${codes[Number(n)]}</code>`)
  return s
}

/** Render a markdown string to React nodes. Block-level parser. */
function Markdown({ text }) {
  const nodes = useMemo(() => renderMd(String(text || '')), [text])
  return h('div', { className: 'bd-md' }, nodes)
}

function renderMd(src) {
  const lines = String(src || '').replace(/\r\n/g, '\n').split('\n')
  const out = []
  let i = 0
  let key = 0
  const k = () => `md${key++}`
  const blockStart = l => /^(#{1,6}\s|\s*```|\s*>|\s*([-*+]|\d+\.)\s|\s*[-*_]\s*[-*_]\s*[-*_])/.test(l)
  const listRe = /^(\s*)([-*+]|\d+\.)\s+(.*)$/

  // A list may nest and may have lazy continuation lines. Returns the next index.
  const parseList = start => {
    const baseIndent = (lines[start].match(listRe) || [])[1]?.length || 0
    const items = []
    let j = start
    while (j < lines.length) {
      const m = lines[j].match(listRe)
      if (!m || m[1].length < baseIndent) break
      if (m[1].length > baseIndent) {  // nested: absorb into previous item
        if (!items.length) break
        const [text, next] = collectItem(j, m[1].length)
        items[items.length - 1].children = (items[items.length - 1].children || []).concat(renderMd(text))
        j = next
        continue
      }
      const ordered = /\d+\./.test(m[2])
      const raw = m[3]
      const task = raw.match(/^\[([ xX])\]\s+(.*)$/)
      const item = { ordered, task, text: task ? task[2] : raw, children: [] }
      j++
      // continuation lines (lazily wrapped or indented)
      while (j < lines.length && !listRe.test(lines[j]) && !blockStart(lines[j]) && lines[j].trim()) {
        item.text += ' ' + lines[j].trim()
        j++
      }
      items.push(item)
    }
    const ordered = items[0]?.ordered
    const lis = items.map(item => {
      if (item.task) {
        const done = String(item.task[1]).toLowerCase() === 'x'
        return h('li', { className: 'bd-md-task', key: k() },
          h('span', { className: `bd-md-check${done ? ' done' : ''}`, 'aria-hidden': true }, done ? '✓' : ''),
          h('span', { className: done ? 'bd-md-done' : '', dangerouslySetInnerHTML: { __html: mdInline(item.text) } }),
          item.children)
      }
      return h('li', { key: k() }, h('span', { dangerouslySetInnerHTML: { __html: mdInline(item.text) } }), item.children)
    })
    return [h(ordered ? 'ol' : 'ul', { className: `bd-md-list${ordered ? ' bd-ordered' : ''}`, key: k() }, lis), j]
  }

  // Collect an indented nested block until indentation drops.
  const collectItem = (start, indent) => {
    const buf = []
    let j = start
    while (j < lines.length && (lines[j].startsWith(' '.repeat(indent)) || !lines[j].trim())) {
      buf.push(lines[j].replace(new RegExp(`^ {0,${indent}}`), ''))
      j++
    }
    return [buf.join('\n'), j]
  }

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    // fenced code (``` or ~~~)
    const fence = line.match(/^\s*(```|~~~)(.*)$/)
    if (fence) {
      const buf = []
      const mark = fence[1]
      i++
      while (i < lines.length && !lines[i].trim().startsWith(mark)) { buf.push(lines[i]); i++ }
      i++
      out.push(h('pre', { className: 'bd-md-pre', key: k() }, h('code', null, buf.join('\n'))))
      continue
    }
    // heading ( ATX and setext )
    const head = line.match(/^\s*(#{1,6})\s+(.*)$/)
    if (head) {
      const lvl = head[1].length
      out.push(h(`h${lvl}`, { className: 'bd-md-h', key: k(), dangerouslySetInnerHTML: { __html: mdInline(head[2].replace(/\s+#+\s*$/, '')) } }))
      i++
      continue
    }
    // setext heading: text then === or ---
    if (i + 1 < lines.length && /^\s*(=+|-+)\s*$/.test(lines[i + 1]) && !/^\s*([-*+]|\d+\.)\s/.test(line)) {
      const lvl = lines[i + 1].trim().startsWith('=') ? 1 : 2
      out.push(h(`h${lvl}`, { className: 'bd-md-h', key: k(), dangerouslySetInnerHTML: { __html: mdInline(line.trim()) } }))
      i += 2
      continue
    }
    // horizontal rule (---, ***, ___ with spaces allowed)
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push(h('hr', { className: 'bd-md-hr', key: k() }))
      i++
      continue
    }
    // blockquote
    if (/^\s*>/.test(line)) {
      const buf = []
      while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++ }
      out.push(h('blockquote', { className: 'bd-md-quote', key: k() }, renderMd(buf.join('\n'))))
      continue
    }
    // table
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const rows = []
      const parseRow = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
      const header = parseRow(line)
      i += 2
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) { rows.push(parseRow(lines[i])); i++ }
      out.push(h('table', { className: 'bd-md-table', key: k() },
        h('thead', null, h('tr', null, header.map((c, ci) => h('th', { key: ci, dangerouslySetInnerHTML: { __html: mdInline(c) } })))),
        h('tbody', null, rows.map((r, ri) => h('tr', { key: ri }, r.map((c, ci) => h('td', { key: ci, dangerouslySetInnerHTML: { __html: mdInline(c) } })))))))
      continue
    }
    // lists (nested, ordered, task)
    if (listRe.test(line)) {
      const [node, next] = parseList(i)
      out.push(node)
      i = next
      continue
    }
    // paragraph (gather until blank / block start)
    const buf = [line.trim()]
    i++
    while (i < lines.length && lines[i].trim() && !blockStart(lines[i])) {
      buf.push(lines[i].trim()); i++
    }
    out.push(h('p', { className: 'bd-md-p', key: k(), dangerouslySetInnerHTML: { __html: mdInline(buf.join(' ')) } }))
  }
  return out
}

/** First heading or first non-empty line, for a note tile title. */
function noteTitle(note) {
  if (note.title) return note.title
  const body = String(note.text || '')
  const head = body.match(/^#{1,6}\s+(.+)$/m)
  if (head) return head[1].trim()
  const first = body.split('\n').find(l => l.trim())
  return first ? first.trim().slice(0, 80) : 'Untitled note'
}

function noteSnippet(note, len = 140) {
  const body = String(note.text || '')
    .replace(/^#{1,6}\s+.*$/gm, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[*_`>#\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return body.slice(0, len)
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

/** One aligned button group for the hero: settings, customize, refresh.
 *  Order is stable in both dashboards; no absolute `right` offsets. */
function HeroTools({ loading, onRefresh, onCustomize, customizing, onSettings }) {
  const iconBtn = (title, label, onClick, glyph, active, spin) =>
    h('button', {
      type: 'button',
      className: `bd-iconbtn${active ? ' on' : ''}`,
      title, 'aria-label': label,
      'aria-pressed': active === undefined ? undefined : !!active,
      onClick
    }, spin ? h('span', { className: loading ? 'bd-spin' : '', style: { display: 'inline-block' } }, glyph) : h('span', { className: 'bd-glyph' }, glyph))
  return h(
    'div',
    { className: 'bd-hero-tools', role: 'toolbar', 'aria-label': 'Dashboard tools' },
    iconBtn('Settings for this dashboard', 'Settings for this dashboard', onSettings, '⚙︎'),
    iconBtn('Customize this panel', 'Customize this panel', onCustomize, '✎', !!customizing),
    iconBtn('Refresh the dashboard', 'Refresh the dashboard', onRefresh, '↻', undefined, true)
  )
}

function Hero({ bot, loading, onRefresh, onCustomize, customizing, onSettings }) {
  return h(
    'header',
    { className: 'bd-hero' },
    h(HeroTools, { loading, onRefresh, onCustomize, customizing, onSettings }),
    h(
      'div',
      { className: 'bd-hero-top' },
      h(BotAvatar, { bot }),
      h(
        'div',
        { style: { minWidth: 0, paddingRight: 110 } },
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

// ---------------------------------------------------------------- scheduled jobs

/** Shell-quote for the delegated-routine prompt (mirrors hermes-bots/cron.tsx). */
function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

/** Same branching as the desktop's routinePrompt: a job for the active
 *  profile runs the raw instruction; another bot's job gets the delegation
 *  wrapper so the run lands in that bot's own history. */
function routinePrompt(bot, title, instruction, activeProfile) {
  const norm = v => String(v || '').trim().toLowerCase().replace(/^@/, '')
  if (norm(bot) && norm(bot) === norm(activeProfile)) return instruction
  return (
    `[bot-mode:routine:v2] You are running the scheduled routine "${title}" for agent '${bot}'. ` +
    `Execute it AS that agent so the run lands in its own history: run this in the terminal and relay the output:\n\n` +
    `hermes -p ${shellQuote(bot)} chat -c ${shellQuote(`Routine: ${title}`)} -q ${shellQuote(`[Scheduled routine] ${instruction}`)}\n\n` +
    `If the command fails, report the error instead.`
  )
}

const JOB_FREQS = [
  { id: 'daily', label: 'Every day' },
  { id: 'weekly', label: 'Every week' },
  { id: 'interval', label: 'Every N minutes / hours' },
  { id: 'once', label: 'Once at a date & time' },
  { id: 'advanced', label: 'Cron expression' }
]
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

function JobForm({ botId, activeProfile, onCancel, onCreated }) {
  const [title, setTitle] = useState('')
  const [instruction, setInstruction] = useState('')
  const [freq, setFreq] = useState('daily')
  const [hour, setHour] = useState('09')
  const [minute, setMinute] = useState('00')
  const [day, setDay] = useState('monday')
  const [everyN, setEveryN] = useState('30')
  const [everyUnit, setEveryUnit] = useState('m')
  const [onceAt, setOnceAt] = useState('')
  const [expr, setExpr] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const schedule = useMemo(() => {
    const hh = Math.min(23, Math.max(0, parseInt(hour, 10) || 0))
    const mm = Math.min(59, Math.max(0, parseInt(minute, 10) || 0))
    if (freq === 'daily') return `${mm} ${hh} * * *`
    if (freq === 'weekly') return `${mm} ${hh} * * ${WEEKDAYS.indexOf(day) === 6 ? 0 : WEEKDAYS.indexOf(day) + 1}`
    if (freq === 'interval') {
      const n = Math.max(1, parseInt(everyN, 10) || 1)
      return `every ${n}${everyUnit}`
    }
    if (freq === 'once') return onceAt
    return expr.trim()
  }, [freq, hour, minute, day, everyN, everyUnit, onceAt, expr])

  const submit = async e => {
    e.preventDefault()
    const name = title.trim()
    const task = instruction.trim()
    if (!name || !task || !schedule) { setError('A job needs a name, an instruction and a schedule.'); return }
    setBusy(true)
    setError('')
    try {
      await host.request('cron.manage', {
        action: 'add',
        name: `[bot:${botId}] ${name}`,
        schedule,
        prompt: routinePrompt(botId, name, task, activeProfile),
        deliver: 'bot-chat',
        ...(botId === 'hermes' ? {} : { profile: botId })
      })
      host.notify?.({ kind: 'success', message: `Scheduled job created: ${name}` })
      onCreated()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const timeInput = (value, set, label, max) =>
    h('input', {
      className: 'desktop-input-chrome bd-input', type: 'number', min: 0, max, value,
      'aria-label': label, style: { flex: '0 1 70px' },
      onChange: e => set(e.target.value)
    })

  return h(
    'form',
    { className: 'bd-inline-form', onSubmit: submit },
    h('div', { className: 'bd-editor-title' }, 'Add a scheduled job'),
    h('input', { className: 'desktop-input-chrome bd-input', placeholder: 'Job name, e.g. Morning briefing', 'aria-label': 'Job name', value: title, maxLength: 100, onChange: e => setTitle(e.target.value) }),
    h('textarea', {
      className: 'desktop-input-chrome bd-input bd-textarea', rows: 3,
      placeholder: 'What should the bot do each run? e.g. Summarize my unread email and post the top 3 items.',
      'aria-label': 'Job instruction', value: instruction, maxLength: 4000, onChange: e => setInstruction(e.target.value)
    }),
    h('div', { className: 'bd-form-row' },
      h('label', null, 'Frequency',
        h(Select, { value: freq, label: 'Frequency', options: JOB_FREQS.map(f => ({ value: f.id, label: f.label })), onChange: setFreq })),
      freq === 'daily' || freq === 'weekly'
        ? h('label', null, 'Time', h('div', { style: { display: 'flex', gap: 4 } }, timeInput(hour, setHour, 'Hour (0-23)', 23), timeInput(minute, setMinute, 'Minute (0-59)', 59)))
        : null,
      freq === 'weekly'
        ? h('label', null, 'Day',
            h(Select, { value: day, label: 'Weekday', options: WEEKDAYS.map(d => ({ value: d, label: d[0].toUpperCase() + d.slice(1) })), onChange: setDay }))
        : null,
      freq === 'interval'
        ? h('label', null, 'Every', h('div', { style: { display: 'flex', gap: 4 } },
            h('input', { className: 'desktop-input-chrome bd-input', type: 'number', min: 1, value: everyN, 'aria-label': 'Interval amount', style: { flex: '0 1 70px' }, onChange: e => setEveryN(e.target.value) }),
            h(Select, { value: everyUnit, label: 'Interval unit', style: { flex: '0 1 100px' }, options: [{ value: 'm', label: 'minutes' }, { value: 'h', label: 'hours' }, { value: 'd', label: 'days' }], onChange: setEveryUnit })))
        : null,
      freq === 'once'
        ? h('label', null, 'Run at',
            h('input', { className: 'desktop-input-chrome bd-input', type: 'datetime-local', value: onceAt, 'aria-label': 'Run date and time', onChange: e => setOnceAt(e.target.value) }))
        : null,
      freq === 'advanced'
        ? h('label', null, 'Cron expression',
            h('input', { className: 'desktop-input-chrome bd-input', placeholder: '0 9 * * 1-5', value: expr, 'aria-label': 'Cron expression', onChange: e => setExpr(e.target.value) }))
        : null),
    h('div', { className: 'bd-hint' }, `Schedule: ${schedule || '—'} · runs as @${botId} and delivers to its chat.`),
    error ? h('div', { className: 'bd-error' }, error) : null,
    h('div', { style: { display: 'flex', gap: 6, justifyContent: 'flex-end' } },
      h('button', { type: 'button', className: 'bd-btn', onClick: onCancel, disabled: busy }, 'Cancel'),
      h('button', { type: 'submit', className: 'bd-btn primary', disabled: busy || !title.trim() || !instruction.trim() || !schedule }, busy ? 'Creating…' : 'Create job'))
  )
}

function JobsWidget({ botId }) {
  const [state, setState] = useState({ loading: true, jobs: [], error: '' })
  const [busy, setBusy] = useState('')
  const [adding, setAdding] = useState(false)
  const activeProfile = useValue(host.state.profile)

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
    setAdding(false)
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  const manage = async (job, action, label) => {
    const id = job.job_id || job.id
    setBusy(id)
    try {
      await host.request('cron.manage', {
        action,
        name: id,
        ...(botId === 'hermes' ? {} : { profile: botId })
      })
      host.notify?.({ kind: 'success', message: `${job.name || 'Job'} ${label}.` })
    } catch (err) {
      host.notify?.({ kind: 'error', message: `Could not update the job: ${errorText(err)}` })
    } finally {
      setBusy('')
      load()
    }
  }

  const toggle = job => {
    const paused = job.enabled === false || job.state === 'paused'
    return manage(job, paused ? 'resume' : 'pause', paused ? 'resumed' : 'paused')
  }

  const remove = job => {
    if (!window.confirm(`Delete the scheduled job “${job.name || job.job_id || job.id}”? This cannot be undone.`)) return
    return manage(job, 'remove', 'deleted')
  }

  const active = state.jobs.filter(j => !(j.enabled === false || j.state === 'paused')).length

  return h(
    Card,
    {
      id: 'jobs',
      botId,
      title: 'Scheduled jobs',
      count: state.loading ? null : `${active}/${state.jobs.length}`,
      info: 'Cron jobs stored in this bot\'s own profile. Active jobs run on their schedule and deliver to this bot\'s chat. Pause stops a job without deleting it. Use + to add a job here.',
      tools: h('button', {
        type: 'button', className: 'bd-tool', title: 'Add a scheduled job', 'aria-label': 'Add a scheduled job',
        'aria-pressed': adding, onClick: () => setAdding(a => !a)
      }, '+')
    },
    adding ? h(JobForm, {
      botId, activeProfile,
      onCancel: () => setAdding(false),
      onCreated: () => { setAdding(false); load() }
    }) : null,
    state.error ? h('div', { className: 'bd-error' }, `Could not load jobs. ${state.error}`) : null,
    state.loading
      ? h('div', { className: 'bd-skeleton', style: { height: 44 } })
      : state.jobs.length === 0 && !state.error
        ? h(Empty, null, 'No scheduled jobs for this bot. Press + to add one.')
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
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, flex: 'none' } },
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
                ),
                h('button', { type: 'button', className: 'bd-mini danger', disabled: busy === id, title: 'Delete this job', onClick: () => remove(job) }, 'Delete'))
            )
          })
  )
}

// ---------------------------------------------------------------- tasks

const TODO_META = {
  pending: { label: 'Pending', tone: 'muted', icon: '○' },
  in_progress: { label: 'In progress', tone: 'ok', icon: '●' },
  completed: { label: 'Done', tone: 'ok', icon: '✓' },
  cancelled: { label: 'Cancelled', tone: 'muted', icon: '✕' }
}
const TASK_STATUSES = ['open', 'in-progress', 'waiting', 'done', 'cancelled']
const todoIsOpen = s => ['pending', 'open', 'in_progress', 'in-progress', 'waiting'].includes(s)

function cleanTodo(t) {
  const status = String(t?.status || 'pending')
  return { id: String(t?.id || ''), content: String(t?.content || ''), status: TODO_META[status] ? status : 'pending' }
}

/** The focused chat's todo list: a REST snapshot plus live gateway updates. */
function useSessionTodos(botId, enabled) {
  const storedId = useValue(host.state.focusedStoredSessionId)
  const runtimeId = useValue(host.state.focusedSessionId)
  const profile = useValue(host.state.focusedSessionProfile)
  const [data, setData] = useState({ current: null, past: [] })
  const session = String(storedId || runtimeId || '')
  const relevant = !!enabled && !!session && profileFor(botId) === String(profile || 'default')

  const load = useCallback(async () => {
    if (!relevant) return
    try {
      const d = await rest(`/session/todos?bot=${encodeURIComponent(profileFor(botId))}&session=${encodeURIComponent(session)}&past=8`)
      setData({ current: d?.current || null, past: arr(d?.past) })
    } catch {
      /* keep the last snapshot; the next poll retries */
    }
  }, [botId, session, relevant])

  useEffect(() => {
    setData({ current: null, past: [] })
    if (!relevant) return undefined
    load()
    const t = setInterval(load, 6_000)
    return () => clearInterval(t)
  }, [load, relevant])

  useEffect(() => {
    if (!relevant || typeof host.onEvent !== 'function') return undefined
    return host.onEvent('todo.updated', ev => {
      const sid = String(ev?.session_id || '')
      if (sid && sid !== String(storedId || '') && sid !== String(runtimeId || '')) return
      const items = arr(ev?.payload?.todos).map(cleanTodo).filter(t => t.content)
      setData(d => ({ ...d, current: { session, ...(d.current || {}), todos: items } }))
    })
  }, [relevant, storedId, runtimeId, session])

  return relevant ? data : { current: null, past: [] }
}

function TodoRow({ item }) {
  const meta = TODO_META[item.status] || TODO_META.pending
  return h(
    'div',
    { className: `bd-row${item.status === 'completed' ? ' done' : ''}` },
    h('span', { className: `bd-todo-ico ${meta.tone}`, 'aria-hidden': true }, meta.icon),
    h('div', { className: 'bd-row-main' },
      h('div', { className: 'bd-row-title' }, item.content),
      h('div', { className: 'bd-row-sub' }, meta.label))
  )
}

function TasksWidget({ bot, onChanged, prefs, showDoneDefault, liveTodos }) {
  const p = prefs || PREF_DEFAULTS
  const group = isGroup(bot)
  const todos = useSessionTodos(bot.id, !group && liveTodos !== false)
  const current = arr(todos.current?.todos)
  const [win, setWin] = useState(false)
  const [showDone, setShowDone] = useState(!!showDoneDefault)
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState({})
  // In a group the task list spans every member, and a new task goes to one of them.
  const members = group ? bot.members.filter(m => !m.missing && !m.remote) : null
  const [owner, setOwner] = useState('')
  const target = members ? (members.some(m => m.id === owner) ? owner : members[0]?.id || '') : bot.id
  const nameOf = id => members?.find(m => m.id === id)?.name || id
  const open = bot.tasks.filter(t => todoIsOpen(t.status))
  const done = bot.tasks.filter(t => !todoIsOpen(t.status))
  const today = todayIso()
  const total = current.length + bot.tasks.length

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
    const isDone = status === 'done' || status === 'cancelled'
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
                ? h('span', { className: `bd-pill ${task.priority === 'high' || task.priority === 'urgent' ? 'warn' : 'muted'}` }, `${task.priority} priority`)
                : null
            )
          : null
      )
    )
  }

  const todoCap = Math.max(1, Number(p.todoPreview) || PREF_DEFAULTS.todoPreview)
  const taskCap = Math.max(1, Number(p.taskPreview) || PREF_DEFAULTS.taskPreview)
  const inlineTodos = current.slice(0, todoCap)
  const inlineOpen = open.slice(0, taskCap)

  return h(
    Card,
    {
      id: 'tasks',
      botId: bot.id,
      title: 'Tasks',
      count: current.length ? current.filter(t => todoIsOpen(t.status)).length : open.length,
      info: group
        ? `Open task notes in your vault's ${vaultOf(bot).tasks} folder owned by any member of this group. Tick a task to mark it done; the note updates. The task window adds search, filters and every member's history.`
        : `The top list follows this chat's live todo list and updates as the bot works. Below it, task notes from your vault's ${vaultOf(bot).tasks} folder. The task window holds past chats, completed work, search and filters.`,
      tools: h('button', {
        type: 'button', className: 'bd-tool', title: 'Open the task window', 'aria-label': 'Open the task window',
        onClick: () => setWin(true)
      }, '⧉')
    },
    !group && current.length
      ? h('div', { className: 'bd-section', key: 'live' }, h('span', { className: 'bd-kind' }, 'This chat'), 'live todo list')
      : null,
    !group ? inlineTodos.map((t, i) => h(TodoRow, { key: t.id || `t${i}`, item: t })) : null,
    !group && current.length > todoCap
      ? h('div', { className: 'bd-hint', key: 'more' }, `+${current.length - todoCap} more in the task window`)
      : null,
    !group && !current.length
      ? h('div', { className: 'bd-hint', key: 'none' }, 'No todo list in this chat yet. It appears here when the bot starts one.')
      : null,
    inlineOpen.length ? h('div', { className: 'bd-section', key: 'vault' }, h('span', { className: 'bd-kind' }, 'Vault'), `${open.length} open`) : null,
    inlineOpen.map(row),
    open.length > taskCap ? h('div', { className: 'bd-hint', key: 'vmore' }, `+${open.length - taskCap} more open in the task window`) : null,
    !current.length && !open.length ? h(Empty, null, group ? 'No open tasks for any member.' : 'No open tasks for this bot.') : null,
    done.length
      ? h(
          'button',
          { type: 'button', className: 'bd-link', onClick: () => setShowDone(s => !s) },
          showDone ? 'Hide completed' : `Show completed (${done.length})`
        )
      : null,
    showDone ? done.map(row) : null,
    total > 5
      ? h('button', { type: 'button', className: 'bd-open-btn', onClick: () => setWin(true) }, `Open task window · ${total} tasks`)
      : null,
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
        ? h(Select, {
            label: 'Member who owns the task',
            value: target,
            options: members.map(m => ({ value: m.id, label: m.name })),
            onChange: setOwner
          })
        : null,
      h('button', { type: 'submit', className: 'bd-btn primary', disabled: busy || !title.trim() || !target }, busy ? '…' : 'Add')
    ),
    win ? h(TaskWindow, { bot, todos, prefs, onClose: () => setWin(false), onChanged }) : null
  )
}

/** The full task list: this chat's todos, past chats, and every vault task,
 *  with search, status/tag/owner filters and sorting. */
function TaskWindow({ bot, todos, prefs, onClose, onChanged }) {
  const group = isGroup(bot)
  const defaultSort = ['due', 'title', 'status'].includes(prefs?.taskSort) ? prefs.taskSort : 'due'
  const [q, setQ] = useState('')
  const [source, setSource] = useState('')
  const [status, setStatus] = useState('')
  const [tag, setTag] = useState('')
  const [owner, setOwner] = useState('')
  const [sort, setSort] = useState(defaultSort)
  const [pending, setPending] = useState({})
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [newOwner, setNewOwner] = useState('')
  const members = group ? bot.members.filter(m => !m.missing && !m.remote) : null
  const target = members ? (members.some(m => m.id === newOwner) ? newOwner : members[0]?.id || '') : bot.id
  const nameOf = id => members?.find(m => m.id === id)?.name || id
  const today = todayIso()

  const tags = useMemo(() => [...new Set(bot.tasks.flatMap(t => arr(t.tags)))].sort(), [bot.tasks])
  const owners = useMemo(() => [...new Set(bot.tasks.flatMap(t => arr(t.owners)))].sort(), [bot.tasks])

  const setStatusOf = async (task, s) => {
    setPending(p => ({ ...p, [task.file]: s }))
    try {
      await rest('/task/status', { method: 'POST', body: { file: task.file, status: s } })
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

  const remove = async task => {
    if (!window.confirm(`Delete the task “${task.title}”? Its note is moved to the vault trash.`)) return
    try {
      await rest('/task/delete', { method: 'POST', body: { file: task.file } })
      await onChanged()
    } catch (err) {
      host.notify?.({ kind: 'error', message: `Could not delete the task: ${errorText(err)}` })
    }
  }

  const add = async e => {
    e.preventDefault()
    const text = title.trim()
    if (!text || !target) return
    setBusy(true)
    try {
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

  const entries = []
  if (!group) {
    arr(todos.current?.todos).forEach(t => entries.push({ kind: 'todo', section: 'This chat', item: t }))
    arr(todos.past).forEach(p => arr(p.todos).forEach(t => entries.push({ kind: 'todo', section: p.title || 'Past chat', item: t, at: p.at })))
  }
  bot.tasks.forEach(t => entries.push({ kind: 'task', section: 'Vault tasks', task: t }))

  const statusOf = e => (e.kind === 'todo' ? e.item.status : pending[e.task.file] || e.task.status)
  const filtered = entries.filter(e => {
    const s = statusOf(e)
    if (source === 'chat' && !(e.kind === 'todo' && e.section === 'This chat')) return false
    if (source === 'past' && !(e.kind === 'todo' && e.section !== 'This chat')) return false
    if (source === 'vault' && e.kind !== 'task') return false
    if (status === 'open' && !todoIsOpen(s)) return false
    if (status === 'progress' && !['in_progress', 'in-progress'].includes(s)) return false
    if (status === 'done' && !['completed', 'done'].includes(s)) return false
    if (status === 'cancelled' && s !== 'cancelled') return false
    if (tag && (e.kind !== 'task' || !arr(e.task.tags).includes(tag))) return false
    if (owner && (e.kind !== 'task' || !arr(e.task.owners).includes(owner))) return false
    const text = e.kind === 'todo' ? e.item.content : `${e.task.title} ${arr(e.task.tags).join(' ')}`
    return matches(text, q)
  })

  const sections = []
  for (const e of filtered) {
    let sec = sections.find(s => s.name === e.section)
    if (!sec) { sec = { name: e.section, items: [] }; sections.push(sec) }
    sec.items.push(e)
  }
  for (const sec of sections) {
    if (sec.name !== 'Vault tasks') continue
    sec.items.sort((a, b) => {
      if (sort === 'title') return a.task.title.localeCompare(b.task.title)
      if (sort === 'status') return String(statusOf(a)).localeCompare(String(statusOf(b)))
      const ad = a.task.due || '9999'
      const bd = b.task.due || '9999'
      return ad.localeCompare(bd) || a.task.title.localeCompare(b.task.title)
    })
  }

  const taskRow = e => {
    const task = e.task
    const s = statusOf(e)
    const isDone = s === 'done' || s === 'cancelled'
    const overdue = !isDone && task.due && task.due < today
    return h(
      'div',
      { className: `bd-row${isDone ? ' done' : ''}`, key: task.file },
      h('input', {
        type: 'checkbox', className: 'bd-check', checked: isDone,
        'aria-label': isDone ? `Reopen ${task.title}` : `Complete ${task.title}`,
        onChange: () => setStatusOf(task, isDone ? 'open' : 'done')
      }),
      h('div', { className: 'bd-row-main' },
        h('div', { className: 'bd-row-title' }, task.title),
        h('div', { style: { marginTop: 5, display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' } },
          task.due ? h('span', { className: `bd-pill ${overdue ? 'bad' : task.due === today ? 'warn' : 'muted'}` }, overdue ? `Overdue · ${formatDay(task.due)}` : `Due ${formatDay(task.due)}`) : null,
          task.priority && task.priority !== 'normal' ? h('span', { className: `bd-pill ${task.priority === 'high' || task.priority === 'urgent' ? 'warn' : 'muted'}` }, task.priority) : null,
          arr(task.tags).map(t => h('span', { key: t, className: 'bd-pill muted' }, `#${t}`)),
          members ? arr(task.owners).map(o => h('span', { key: o, className: 'bd-owner' }, nameOf(o))) : null),
        h('div', { style: { marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' } },
          h(Select, {
            style: { flex: '0 1 150px' }, value: s, label: `Status of ${task.title}`,
            options: TASK_STATUSES.map(x => ({ value: x, label: x })),
            onChange: v => setStatusOf(task, v)
          }),
          h('button', { type: 'button', className: 'bd-mini danger', onClick: () => remove(task) }, 'Delete')))
    )
  }

  const sourceOpts = group
    ? [{ id: 'vault', label: 'Vault tasks' }]
    : [{ id: 'chat', label: 'This chat' }, { id: 'past', label: 'Past chats' }, { id: 'vault', label: 'Vault tasks' }]

  return h(
    Win,
    {
      title: `Tasks · ${group ? bot.name : `@${bot.id}`}`,
      wide: true,
      onClose,
      footer: h(
        'form',
        { className: 'bd-add', style: { flex: 1, margin: 0 }, onSubmit: add },
        h('input', { className: 'desktop-input-chrome bd-input', placeholder: members ? 'Add a task for a member' : 'Add a task', 'aria-label': 'New task title', value: title, maxLength: 200, onChange: e => setTitle(e.target.value) }),
        h('input', { className: 'desktop-input-chrome bd-input date', type: 'date', 'aria-label': 'Due date (optional)', value: due, onChange: e => setDue(e.target.value) }),
        members && members.length > 1
          ? h(Select, { label: 'Member who owns the task', value: target, options: members.map(m => ({ value: m.id, label: m.name })), onChange: setNewOwner })
          : null,
        h('button', { type: 'submit', className: 'bd-btn primary', disabled: busy || !title.trim() || !target }, busy ? '…' : 'Add task')
      )
    },
    h('div', { className: 'bd-toolbar' },
      h(SearchBox, { value: q, onChange: setQ, placeholder: 'Search tasks…' }),
      h(Select, { style: { flex: '0 1 150px' }, value: sort, label: 'Sort vault tasks', options: [{ value: 'due', label: 'Sort: due date' }, { value: 'title', label: 'Sort: title' }, { value: 'status', label: 'Sort: status' }], onChange: setSort })),
    h('div', { className: 'bd-toolbar' },
      h(ChipRow, { options: sourceOpts, value: source, onChange: setSource, allLabel: 'All sources' }),
      h(ChipRow, {
        options: [{ id: 'open', label: 'Open' }, { id: 'progress', label: 'In progress' }, { id: 'done', label: 'Done' }, { id: 'cancelled', label: 'Cancelled' }],
        value: status, onChange: setStatus, allLabel: 'Any status'
      })),
    tags.length || owners.length
      ? h('div', { className: 'bd-toolbar' },
          tags.length ? h(ChipRow, { options: tags.map(t => ({ id: t, label: `#${t}` })), value: tag, onChange: setTag, allLabel: 'Any tag' }) : null,
          group && owners.length ? h(ChipRow, { options: owners.map(o => ({ id: o, label: nameOf(o) })), value: owner, onChange: setOwner, allLabel: 'Any bot' }) : null)
      : null,
    h('div', { className: 'bd-win-meta' }, `${filtered.length} shown · ${entries.length} total`),
    filtered.length === 0
      ? h(Empty, null, 'Nothing matches these filters.')
      : sections.map(sec =>
          h('div', { key: sec.name },
            h('div', { className: 'bd-act-day' }, `${sec.name} · ${sec.items.length}`),
            sec.items.map(e => (e.kind === 'todo' ? h(TodoRow, { key: `${sec.name}:${e.item.id || e.item.content}`, item: e.item }) : taskRow(e)))))
  )
}

// ---------------------------------------------------------------- projects

const PROJECT_STATUSES = ['idea', 'planning', 'active', 'paused', 'blocked', 'done', 'archived']
const projectTone = s => (s === 'active' ? 'ok' : s === 'paused' || s === 'blocked' ? 'warn' : s === 'done' ? 'ok' : 'muted')

function projectPath(p) {
  return p.path || p.repo || ''
}

function ProjectsWidget({ bot, onChanged, prefs }) {
  const p = prefs || PREF_DEFAULTS
  const [adding, setAdding] = useState(false)
  const [win, setWin] = useState(false)
  const projects = bot.projects
  const inline = projects.slice(0, Math.max(1, Number(p.projectPreview) || PREF_DEFAULTS.projectPreview))
  return h(
    Card,
    {
      id: 'projects',
      botId: bot.id,
      title: 'Projects',
      count: projects.length,
      info: isGroup(bot)
        ? `Project notes in your vault's ${vaultOf(bot).projects} folder owned by any member of this group, each linked to its directory on disk. A project not updated for 14 days or more is flagged as stale. Use + to add one.`
        : `Project notes in your vault's ${vaultOf(bot).projects} folder with ${vaultOf(bot).owner}: ${bot.id}, each linked to its directory on disk. A project not updated for 14 days or more is flagged as stale. Use + to add one.`,
      tools: h(React.Fragment, null,
        h('button', { type: 'button', className: 'bd-tool', title: 'Add a project', 'aria-label': 'Add a project', 'aria-pressed': adding, onClick: () => setAdding(a => !a) }, '+'),
        h('button', { type: 'button', className: 'bd-tool', title: 'Open the projects window', 'aria-label': 'Open the projects window', onClick: () => setWin(true) }, '⧉'))
    },
    adding ? h(ProjectForm, { bot, onCancel: () => setAdding(false), onSaved: () => { setAdding(false); onChanged() } }) : null,
    projects.length === 0
      ? h(Empty, null, isGroup(bot) ? 'No projects are linked to any member. Press + to add one.' : 'No projects are linked to this bot. Press + to add one.')
      : inline.map(p => h(ProjectRow, { key: p.file || p.name, p, bot, compact: true })),
    projects.length > Math.max(1, Number(p.projectPreview) || PREF_DEFAULTS.projectPreview)
      ? h('button', { type: 'button', className: 'bd-open-btn', onClick: () => setWin(true) }, `Open projects window · ${projects.length} projects`)
      : null,
    win ? h(ProjectsWindow, { bot, onClose: () => setWin(false), onChanged }) : null
  )
}

function ProjectRow({ p, bot, compact, onEdit, onDelete }) {
  const group = isGroup(bot)
  const path = projectPath(p)
  return h(
    'div',
    { className: 'bd-row', key: p.file || p.name },
    h(
      'div',
      { className: 'bd-row-main' },
      h(
        'div',
        { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
        h('span', { className: 'bd-row-title' }, p.name),
        h('span', { className: `bd-pill ${projectTone(p.status)}` }, p.status),
        group && p.owner ? h('span', { className: 'bd-owner' }, bot.members.find(m => m.id === p.owner)?.name || p.owner) : null
      ),
      path
        ? h('div', { className: 'bd-path', title: path }, path)
        : h('div', { className: 'bd-hint' }, 'No directory linked'),
      p.next
        ? h('div', { className: 'bd-next' }, h('b', null, 'Next: '), p.next)
        : h('div', { className: 'bd-next' }, h('b', null, 'Next: '), 'Not set'),
      h(
        'div',
        { style: { marginTop: 5, display: 'flex', gap: 5, flexWrap: 'wrap' } },
        p.updated
          ? h('span', { className: `bd-pill ${p.stale ? 'warn' : 'muted'}`, title: `Last updated ${p.updated}` },
              p.stale ? `Stale · ${p.ageDays} days` : p.ageDays === 0 ? 'Updated today' : `Updated ${p.ageDays}d ago`)
          : null,
        p.due ? h('span', { className: 'bd-pill muted' }, `Due ${formatDay(p.due)}`) : null,
        arr(p.tags).slice(0, compact ? 2 : 6).map(t => h('span', { key: t, className: 'bd-pill muted' }, `#${t}`))
      )
    ),
    onEdit || onDelete
      ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, flex: 'none' } },
          onEdit ? h('button', { type: 'button', className: 'bd-btn', onClick: () => onEdit(p) }, 'Edit') : null,
          onDelete ? h('button', { type: 'button', className: 'bd-mini danger', onClick: () => onDelete(p) }, 'Delete') : null)
      : null
  )
}

/** Add or edit a project: name, directory, status, next step, repo, tags. */
function ProjectForm({ bot, project, onCancel, onSaved }) {
  const editing = !!project
  const [name, setName] = useState(project?.name || '')
  const [path, setPath] = useState(project?.path || '')
  const [status, setStatus] = useState(project?.status || 'active')
  const [next, setNext] = useState(project?.next || '')
  const [repo, setRepo] = useState(project?.repo || '')
  const [description, setDescription] = useState(project?.description || '')
  const [tags, setTags] = useState(arr(project?.tags).join(', '))
  const [due, setDue] = useState(project?.due || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async e => {
    e.preventDefault()
    if (!name.trim()) { setError('A project needs a name.'); return }
    setBusy(true)
    setError('')
    const body = {
      bot: bot.id,
      name: name.trim(),
      path: path.trim(),
      status,
      next: next.trim(),
      repo: repo.trim(),
      description: description.trim(),
      tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      due: due || null
    }
    try {
      if (editing) {
        await rest('/project/update', { method: 'POST', body: { ...body, file: project.file } })
      } else {
        await rest('/project', { method: 'POST', body })
      }
      host.notify?.({ kind: 'success', message: editing ? `Project updated: ${name.trim()}` : `Project added: ${name.trim()}` })
      onSaved()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return h(
    'form',
    { className: 'bd-inline-form', onSubmit: submit },
    h('div', { className: 'bd-editor-title' }, editing ? `Edit “${project.name}”` : 'Add a project'),
    h('input', { className: 'desktop-input-chrome bd-input', placeholder: 'Project name', 'aria-label': 'Project name', value: name, maxLength: 80, onChange: e => setName(e.target.value) }),
    h('label', { className: 'bd-hint', style: { display: 'flex', flexDirection: 'column', gap: 3 } }, 'Directory on this computer',
      h('input', { className: 'desktop-input-chrome bd-input', placeholder: 'C:/Users/you/Dev/MyProject', 'aria-label': 'Project directory', value: path, maxLength: 400, onChange: e => setPath(e.target.value) })),
    h('div', { className: 'bd-form-row' },
      h('label', null, 'Status',
        h(Select, { value: status, label: 'Project status', options: PROJECT_STATUSES.map(s => ({ value: s, label: s })), onChange: setStatus })),
      h('label', null, 'Due (optional)',
        h('input', { className: 'desktop-input-chrome bd-input date', type: 'date', value: due, 'aria-label': 'Project due date', onChange: e => setDue(e.target.value) }))),
    h('input', { className: 'desktop-input-chrome bd-input', placeholder: 'Next step, e.g. Wire the login screen', 'aria-label': 'Next step', value: next, maxLength: 400, onChange: e => setNext(e.target.value) }),
    h('input', { className: 'desktop-input-chrome bd-input', placeholder: 'Repository URL (optional)', 'aria-label': 'Repository URL', value: repo, maxLength: 400, onChange: e => setRepo(e.target.value) }),
    h('input', { className: 'desktop-input-chrome bd-input', placeholder: 'Tags, comma separated (optional)', 'aria-label': 'Project tags', value: tags, maxLength: 200, onChange: e => setTags(e.target.value) }),
    h('textarea', { className: 'desktop-input-chrome bd-input bd-textarea', rows: 2, placeholder: 'Short description (optional)', 'aria-label': 'Project description', value: description, maxLength: 300, onChange: e => setDescription(e.target.value) }),
    error ? h('div', { className: 'bd-error' }, error) : null,
    h('div', { style: { display: 'flex', gap: 6, justifyContent: 'flex-end' } },
      h('button', { type: 'button', className: 'bd-btn', onClick: onCancel, disabled: busy }, 'Cancel'),
      h('button', { type: 'submit', className: 'bd-btn primary', disabled: busy || !name.trim() }, busy ? 'Saving…' : editing ? 'Save changes' : 'Add project'))
  )
}

function ProjectsWindow({ bot, onClose, onChanged }) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [tag, setTag] = useState('')
  const [owner, setOwner] = useState('')
  const [editing, setEditing] = useState(null)
  const group = isGroup(bot)
  const tags = useMemo(() => [...new Set(bot.projects.flatMap(p => arr(p.tags)))].sort(), [bot.projects])
  const owners = useMemo(() => [...new Set(bot.projects.map(p => p.owner).filter(Boolean))].sort(), [bot.projects])

  const remove = async p => {
    if (!window.confirm(`Delete the project “${p.name}”? Its note is moved to the vault trash; the directory on disk is untouched.`)) return
    try {
      await rest('/project/delete', { method: 'POST', body: { file: p.file } })
      await onChanged()
    } catch (err) {
      host.notify?.({ kind: 'error', message: `Could not delete the project: ${errorText(err)}` })
    }
  }

  const filtered = bot.projects.filter(p => {
    if (status && p.status !== status) return false
    if (tag && !arr(p.tags).includes(tag)) return false
    if (owner && p.owner !== owner) return false
    return matches(`${p.name} ${projectPath(p)} ${p.next || ''} ${arr(p.tags).join(' ')}`, q)
  })

  if (editing) {
    const isNew = !editing.file
    return h(
      Win,
      { title: isNew ? 'New project' : `Edit project · ${editing.name}`, onClose: () => setEditing(null) },
      h(ProjectForm, { bot, project: isNew ? null : editing, onCancel: () => setEditing(null), onSaved: () => { setEditing(null); onChanged() } })
    )
  }

  return h(
    Win,
    {
      title: `Projects · ${group ? bot.name : `@${bot.id}`}`,
      wide: true,
      onClose,
      footer: h(React.Fragment, null,
        h('span', { className: 'bd-hint', style: { flex: 1 } }, `Vault folder: ${vaultOf(bot).projects}`),
        h('button', { type: 'button', className: 'bd-btn primary', onClick: () => setEditing({}) }, '+ New project'))
    },
    h('div', { className: 'bd-toolbar' }, h(SearchBox, { value: q, onChange: setQ, placeholder: 'Search projects…' })),
    h('div', { className: 'bd-toolbar' },
      h(ChipRow, { options: PROJECT_STATUSES.map(s => ({ id: s, label: s })), value: status, onChange: setStatus, allLabel: 'Any status' })),
    tags.length || owners.length
      ? h('div', { className: 'bd-toolbar' },
          tags.length ? h(ChipRow, { options: tags.map(t => ({ id: t, label: `#${t}` })), value: tag, onChange: setTag, allLabel: 'Any tag' }) : null,
          group && owners.length ? h(ChipRow, { options: owners.map(o => ({ id: o, label: bot.members.find(m => m.id === o)?.name || o })), value: owner, onChange: setOwner, allLabel: 'Any bot' }) : null)
      : null,
    h('div', { className: 'bd-win-meta' }, `${filtered.length} shown · ${bot.projects.length} total`),
    filtered.length === 0
      ? h(Empty, null, 'Nothing matches these filters.')
      : filtered.map(p => h(ProjectRow, { key: p.file || p.name, p, bot, onEdit: setEditing, onDelete: remove }))
  )
}

// ---------------------------------------------------------------- notes

function NotesWidget({ bot, onChanged, prefs, defaultMode }) {
  const p = prefs || PREF_DEFAULTS
  const notes = bot.panel?.notes || []
  const [win, setWin] = useState(false)
  const [focus, setFocus] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

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

  const open = (id, mode) => { setFocus({ id, mode: mode || 'read' }); setWin(true) }

  // Inline: at most three compact previews; everything else lives in the window.
  const inline = notes.slice(0, Math.max(1, Number(p.notePreview) || PREF_DEFAULTS.notePreview))

  return h(
    Card,
    {
      id: 'notes',
      botId: bot.id,
      title: 'Notes',
      count: notes.length,
      info: isGroup(bot)
        ? 'Markdown notes for this group, kept with the room on this computer. Click a note to read or edit it like an Obsidian note. Pinned notes stay on top.'
        : 'Markdown notes shared between you and this bot; the bot reads and writes the same files with its bot_panel tool. Click a note to read or edit it with live Markdown preview. Pinned notes stay on top.',
      tools: h('button', {
        type: 'button', className: 'bd-tool', title: 'Open the notes window', 'aria-label': 'Open the notes window',
        onClick: () => { setFocus(null); setWin(true) }
      }, '⧉')
    },
    h(
      'form',
      { className: 'bd-note-add', onSubmit: add },
      h('textarea', {
        className: 'desktop-input-chrome bd-input bd-textarea',
        placeholder: `Write a Markdown note for ${noun(bot)}`,
        'aria-label': 'New note',
        rows: 2,
        value: text,
        maxLength: 20000,
        onChange: e => setText(e.target.value),
        onKeyDown: e => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) add(e)
        }
      }),
      h('button', { type: 'submit', className: 'bd-btn primary', disabled: busy || !text.trim(), title: 'Save note (Ctrl+Enter)' }, 'Add note')
    ),
    notes.length === 0
      ? h(Empty, null, 'No notes yet. Add one here, or ask the bot to leave one.')
      : inline.map(note =>
          h(
            'button',
            { type: 'button', className: `bd-note bd-note-tile${note.pinned ? ' pinned' : ''}`, key: note.id, onClick: () => open(note.id), title: 'Open this note' },
            h('div', { className: 'bd-note-meta' },
              note.pinned ? h('span', { className: 'bd-pill warn' }, 'Pinned') : null,
              h('span', { className: `bd-pill ${note.author === 'bot' ? 'ok' : 'muted'}` }, note.author === 'bot' ? `@${bot.id}` : 'You'),
              h('span', { className: 'bd-note-time', title: note.updated }, relative(note.updated))),
            h('div', { className: 'bd-row-title' }, noteTitle(note)),
            h('div', { className: 'bd-tile-snip' }, noteSnippet(note, 110))
          )
        ),
    notes.length > Math.max(1, Number(p.notePreview) || PREF_DEFAULTS.notePreview)
      ? h('button', { type: 'button', className: 'bd-open-btn', onClick: () => { setFocus(null); setWin(true) } }, `Open notes window · ${notes.length} notes`)
      : null,
    win ? h(NotesWindow, { bot, notes, focus, prefs, defaultMode, onClose: () => { setWin(false); setFocus(null) }, onChanged }) : null
  )
}

/** Grid of every note with search, author/pin/tag filters; clicking a tile
 *  opens the focused note editor. */
function NotesWindow({ bot, notes, focus, prefs, defaultMode, onClose, onChanged }) {
  const p = prefs || PREF_DEFAULTS
  const [sel, setSel] = useState(focus || null)
  const [full, setFull] = useState(null)
  const [q, setQ] = useState('')
  const [author, setAuthor] = useState('')
  const [tag, setTag] = useState('')
  const [pinnedOnly, setPinnedOnly] = useState(false)
  const [sort, setSort] = useState('updated')
  const [busy, setBusy] = useState(false)

  const tags = useMemo(() => [...new Set(notes.flatMap(n => arr(n.tags)))].sort(), [notes])

  const call = async (path, body, failMsg) => {
    setBusy(true)
    try {
      const res = await rest(path, { method: 'POST', body: { bot: bot.id, ...body } })
      await onChanged()
      return res
    } catch (err) {
      host.notify?.({ kind: 'error', message: `${failMsg}: ${errorText(err)}` })
      return null
    } finally {
      setBusy(false)
    }
  }

  const createNote = async () => {
    const res = await call('/panel/note', { text: '# Untitled note\n\n', title: 'Untitled note' }, 'Could not create the note')
    if (res?.note?.id) setSel({ id: res.note.id, mode: 'write' })
  }

  const selNote = sel?.id ? notes.find(n => n.id === sel.id) : null
  useEffect(() => {
    if (sel?.id && !notes.some(n => n.id === sel.id)) setSel(null)
  }, [sel?.id, notes])

  // The /bot summary truncates long bodies; the editor needs the full file.
  useEffect(() => {
    if (!sel?.id) { setFull(null); return undefined }
    let alive = true
    rest(`/panel/note?bot=${encodeURIComponent(bot.id)}&id=${encodeURIComponent(sel.id)}`)
      .then(d => { if (alive && d?.note) setFull(d.note) })
      .catch(() => { if (alive) setFull(null) })
    return () => { alive = false }
  }, [sel?.id, bot.id])

  if (sel) {
    if (sel.id && !selNote) return null
    const noteForEditor = sel.id && selNote.partial ? (full && full.id === sel.id ? { ...selNote, ...full } : null) : selNote
    if (sel.id && selNote.partial && !noteForEditor) {
      return h(Win, { title: noteTitle(selNote), onClose }, h('div', { className: 'bd-skeleton', style: { height: 200 } }))
    }
    return h(NoteEditor, {
      bot, note: noteForEditor, mode: sel.mode || defaultMode || 'read', prefs: p, busy,
      onBack: () => setSel(null),
      onClose,
      onSave: async (id, fields) => {
        const res = await call(id ? '/panel/note/update' : '/panel/note', { id: id || undefined, ...fields }, 'Could not save the note')
        if (res?.note?.id && !id) setSel({ id: res.note.id, mode: 'write' })
        return !!res
      },
      onPin: async n => { await call('/panel/note/update', { id: n.id, pinned: !n.pinned }, 'Could not pin the note') },
      onDelete: async n => {
        if (!window.confirm(`Delete the note “${noteTitle(n)}”?`)) return
        if (await call('/panel/note/delete', { id: n.id }, 'Could not delete the note')) setSel(null)
      }
    })
  }

  const filtered = notes
    .filter(n => {
      if (author && n.author !== author) return false
      if (pinnedOnly && !n.pinned) return false
      if (tag && !arr(n.tags).includes(tag)) return false
      return matches(`${noteTitle(n)} ${n.text || ''} ${arr(n.tags).join(' ')}`, q)
    })
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      if (sort === 'title') return noteTitle(a).localeCompare(noteTitle(b))
      if (sort === 'created') return String(b.created || '').localeCompare(String(a.created || ''))
      return String(b.updated || '').localeCompare(String(a.updated || ''))
    })

  return h(
    Win,
    {
      title: `Notes · ${isGroup(bot) ? bot.name : `@${bot.id}`}`,
      wide: true,
      onClose,
      footer: h(React.Fragment, null,
        h('span', { className: 'bd-hint', style: { flex: 1 } }, 'Markdown notes · shared with the bot’s bot_panel tool'),
        h('button', { type: 'button', className: 'bd-btn primary', disabled: busy, onClick: createNote }, '+ New note'))
    },
    h('div', { className: 'bd-toolbar' },
      h(SearchBox, { value: q, onChange: setQ, placeholder: 'Search notes…' }),
      h(Select, { style: { flex: '0 1 150px' }, value: sort, label: 'Sort notes', options: [{ value: 'updated', label: 'Sort: updated' }, { value: 'created', label: 'Sort: created' }, { value: 'title', label: 'Sort: title' }], onChange: setSort })),
    h('div', { className: 'bd-toolbar' },
      h(ChipRow, { options: [{ id: 'user', label: 'You' }, { id: 'bot', label: `@${bot.id}` }], value: author, onChange: setAuthor, allLabel: 'Any author' }),
      h('button', { type: 'button', className: `bd-chip${pinnedOnly ? ' on' : ''}`, 'aria-pressed': pinnedOnly, onClick: () => setPinnedOnly(v => !v) }, 'Pinned only')),
    tags.length
      ? h('div', { className: 'bd-toolbar' }, h(ChipRow, { options: tags.map(t => ({ id: t, label: `#${t}` })), value: tag, onChange: setTag, allLabel: 'Any tag' }))
      : null,
    h('div', { className: 'bd-win-meta' }, `${filtered.length} shown · ${notes.length} total`),
    filtered.length === 0
      ? h(Empty, null, notes.length ? 'Nothing matches these filters.' : 'No notes yet. Create one below.')
      : h('div', { className: 'bd-grid' },
          filtered.map(n =>
            h('button', { type: 'button', className: 'bd-tile', key: n.id, onClick: () => setSel({ id: n.id, mode: 'read' }), title: 'Open this note' },
              h('div', { className: 'bd-tile-title' }, noteTitle(n)),
              h('div', { className: 'bd-tile-snip' }, noteSnippet(n)),
              h('div', { className: 'bd-tile-foot' },
                n.pinned ? h('span', { className: 'bd-pill warn' }, 'Pinned') : null,
                h('span', { className: `bd-pill ${n.author === 'bot' ? 'ok' : 'muted'}` }, n.author === 'bot' ? `@${bot.id}` : 'You'),
                arr(n.tags).slice(0, 3).map(t => h('span', { key: t, className: 'bd-pill muted' }, `#${t}`)),
                h('span', { className: 'bd-note-time', title: n.updated }, relative(n.updated))))))
  )
}

/** One note, Obsidian-style: Read / Write / Split modes, live preview,
 *  debounced autosave, title + tags editing. */
function NoteEditor({ bot, note, mode, prefs, busy, onBack, onClose, onSave, onPin, onDelete }) {
  const autosaveMs = Math.max(300, Number(prefs?.autosaveMs) || PREF_DEFAULTS.autosaveMs)
  const [text, setText] = useState(note?.text || '')
  const [title, setTitle] = useState(note?.title || '')
  const [tags, setTags] = useState(arr(note?.tags).join(', '))
  const [view, setView] = useState(mode === 'write' ? 'split' : 'read')
  const [dirty, setDirty] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const saveTimer = useRef(null)
  const latest = useRef({ text, title, tags })
  latest.current = { text, title, tags }
  const idRef = useRef(note?.id || null)

  useEffect(() => {
    setText(note?.text || '')
    setTitle(note?.title || '')
    setTags(arr(note?.tags).join(', '))
    idRef.current = note?.id || null
    setDirty(false)
    setSavedAt(null)
  }, [note?.id])

  const doSave = useCallback(async () => {
    const cur = latest.current
    const fields = {
      text: cur.text,
      title: cur.title.trim() || undefined,
      tags: cur.tags.split(',').map(t => t.trim()).filter(Boolean)
    }
    const ok = await onSave(idRef.current, fields)
    if (ok) { setDirty(false); setSavedAt(new Date()) }
    return ok
  }, [onSave])

  const touch = () => {
    setDirty(true)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { doSave() }, autosaveMs)
  }

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])

  const back = async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    if (dirty) await doSave()
    onBack()
  }

  const onKeyDown = e => {
    const k = e.key.toLowerCase()
    if ((e.ctrlKey || e.metaKey) && k === 's') {
      e.preventDefault()
      if (saveTimer.current) clearTimeout(saveTimer.current)
      doSave()
      return
    }
    // Obsidian-style shortcuts: Ctrl+B/I, Ctrl+Shift+X (strike), Ctrl+K (link).
    const shortcut = { b: '**', i: '*', k: 'link', x: '~~' }[k]
    if ((e.ctrlKey || e.metaKey) && shortcut) {
      e.preventDefault()
      applyFormat(shortcut)
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      applyFormat('indent')
    }
  }

  const textareaRef = useRef(null)
  const applyFormat = kind => {
    const el = textareaRef.current
    if (!el || view === 'read') return
    const start = el.selectionStart
    const end = el.selectionEnd
    const sel = text.slice(start, end)
    let next, from, to
    if (kind === 'indent') {
      next = text.slice(0, start) + '  ' + text.slice(end)
      from = to = start + 2
    } else if (kind === 'link') {
      const label = sel || 'link text'
      const insert = `[${label}](https://)`
      next = text.slice(0, start) + insert + text.slice(end)
      from = start + label.length + 3
      to = from + 8
    } else if (kind === 'task') {
      const lineStart = text.lastIndexOf('\n', start - 1) + 1
      next = text.slice(0, lineStart) + '- [ ] ' + text.slice(lineStart)
      from = to = start + 6
    } else if (kind === 'heading' || kind === 'task' || /^[-#>\[]/.test(kind) || kind === '1. ') {
      const lineStart = text.lastIndexOf('\n', start - 1) + 1
      const prefix = kind === 'heading' ? '## ' : kind === 'task' ? '- [ ] ' : kind
      next = text.slice(0, lineStart) + prefix + text.slice(lineStart)
      from = to = start + prefix.length
    } else {
      const marker = kind
      const inner = sel || 'text'
      const insert = marker + inner + marker
      next = text.slice(0, start) + insert + text.slice(end)
      from = start + marker.length
      to = from + inner.length
    }
    setText(next)
    touch()
    setTimeout(() => {
      el.focus()
      el.setSelectionRange(from, to)
    }, 0)
  }

  const mdTools = [
    ['B', '**', 'Bold (Ctrl+B)'],
    ['I', '*', 'Italic (Ctrl+I)'],
    ['S', '~~', 'Strikethrough (Ctrl+Shift+X)'],
    ['<>', '`', 'Inline code'],
    ['H2', 'heading', 'Heading'],
    ['•', '- ', 'Bullet list'],
    ['☑', 'task', 'Task item'],
    ['1.', '1. ', 'Numbered list'],
    ['"', '> ', 'Quote'],
    ['🔗', 'link', 'Link (Ctrl+K)'],
    ['#', '#tag', 'Tag'],
    ['[[ ]]', '[[', 'Wiki link'],
    ['—', '---', 'Horizontal rule']
  ]

  const stateLabel = busy ? 'Saving…' : dirty ? 'Unsaved changes' : savedAt ? 'Saved' : note ? 'Up to date' : 'New note'
  const words = text.trim() ? text.trim().split(/\s+/).length : 0

  const editorPane = h('div', { className: 'bd-note-pane', key: 'edit' },
    h('div', { className: 'bd-note-pane-label' }, 'Markdown'),
    h('div', { className: 'bd-md-tools', role: 'toolbar', 'aria-label': 'Markdown formatting' },
      ...mdTools.map(([label, kind, title]) =>
        h('button', {
          key: title, type: 'button', className: 'bd-md-tool', title,
          'aria-label': title, onClick: () => applyFormat(kind)
        }, label))),
    h('textarea', {
      ref: textareaRef,
      value: text,
      'aria-label': 'Note markdown',
      placeholder: '# Title\n\nWrite in Markdown: **bold**, *italic*, `code`, - lists, - [ ] tasks, [[wikilinks]], #tags…',
      spellCheck: false,
      onChange: e => { setText(e.target.value); touch() },
      onKeyDown
    }))
  const readPane = h('div', { className: 'bd-note-pane', key: 'read' },
    h('div', { className: 'bd-note-pane-label' }, 'Preview'),
    h('div', { className: 'bd-note-read' }, h(Markdown, { text })))

  return h(
    Win,
    {
      title: note ? noteTitle(note) : 'New note',
      wide: true,
      onClose: async () => {
        if (saveTimer.current) clearTimeout(saveTimer.current)
        if (dirty) await doSave()
        onClose()
      },
      footer: h(React.Fragment, null,
        h('span', { className: `bd-save-state ${dirty ? 'dirty' : 'saved'}` }, stateLabel),
        h('span', { className: 'bd-hint' }, `${words} words · ${text.length} chars · Ctrl+S saves`),
        h('span', { style: { flex: 1 } }),
        note ? h('button', { type: 'button', className: 'bd-btn', disabled: busy, onClick: () => onPin(note) }, note.pinned ? 'Unpin' : 'Pin') : null,
        note ? h('button', { type: 'button', className: 'bd-btn', disabled: busy, onClick: () => onDelete(note) }, 'Delete') : null,
        h('button', { type: 'button', className: 'bd-btn primary', disabled: busy || (!dirty && !!note), onClick: () => { if (saveTimer.current) clearTimeout(saveTimer.current); doSave() } }, 'Save'))
    },
    h('div', { className: 'bd-note-editor' },
      h('div', { className: 'bd-note-titlebar' },
        h('button', { type: 'button', className: 'bd-btn', onClick: back, title: 'Back to all notes' }, '‹ Notes'),
        h('input', {
          className: 'desktop-input-chrome bd-input', placeholder: 'Note title', 'aria-label': 'Note title',
          value: title, maxLength: 120,
          onChange: e => { setTitle(e.target.value); touch() }
        }),
        h('div', { className: 'bd-seg', role: 'group', 'aria-label': 'View mode' },
          [['read', 'Read'], ['write', 'Write'], ['split', 'Split']].map(([v, label]) =>
            h('button', { key: v, type: 'button', className: view === v ? 'on' : '', 'aria-pressed': view === v, onClick: () => setView(v) }, label)))),
      h('div', { className: 'bd-form-row', style: { display: 'flex', gap: 6, alignItems: 'center', flex: 'none' } },
        h('span', { className: 'bd-hint' }, 'Tags'),
        h('input', {
          className: 'desktop-input-chrome bd-input', placeholder: 'comma, separated, tags', 'aria-label': 'Note tags',
          value: tags, style: { flex: 1 },
          onChange: e => { setTags(e.target.value); touch() }
        })),
      h('div', { className: `bd-note-split${view === 'split' ? '' : ' single'}` },
        view === 'read' ? readPane : view === 'write' ? editorPane : [editorPane, readPane]))
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

// Widget HTML is written by a model, so it gets no network at all: the policy
// is the first element of the document, ahead of anything the widget brings,
// and a second policy inside the widget can only narrow it further.
const WIDGET_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'"

function frameDoc(widget, accent, large) {
  const doc = buildDoc(widget, accent, large)
  const csp = `<meta http-equiv="Content-Security-Policy" content="${WIDGET_CSP}">`
  // Prepend the policy before the widget's own markup; the parser hoists the
  // meta into <head>, so it applies before any of the widget's elements load.
  return /^\s*<!doctype[^>]*>/i.test(doc) ? doc.replace(/^\s*<!doctype[^>]*>/i, m => m + csp) : csp + doc
}

function vaultOf(bot) {
  const v = (bot && bot.vault) || {}
  return { set: !!v.set, found: !!v.found, tasks: v.tasks || 'TaskNotes/Tasks', projects: v.projects || 'Projects', owner: v.owner || 'bot' }
}

// Tasks and projects come from an optional markdown vault. Say plainly when
// none is set, instead of showing two empty cards with no reason.
function vaultNotice(bot) {
  const v = vaultOf(bot)
  if (v.found) return null
  const text = v.set
    ? 'The notes vault folder in the Bot Dashboard settings was not found, so tasks and projects are empty.'
    : 'Tasks and projects come from a markdown notes vault. Set vault_path in the Bot Dashboard plugin settings to show them.'
  return h('div', { className: 'bd-hint', key: 'vault' }, text)
}

function WidgetFrame({ widget, accent, large = false }) {
  const doc = useMemo(() => frameDoc(widget, accent, large), [widget.html, widget.id, accent, large])
  // A widget cannot report its own height without running a script we inject,
  // so the frame keeps the height the panel stored and scrolls inside.
  const style = { height: large ? 'min(70vh, 640px)' : widget.height || 180 }
  if (sdk.SandboxedFrame) {
    // The SDK's guest frame: opaque origin, allowlisted sandbox tokens, no referrer.
    return h(sdk.SandboxedFrame, {
      className: 'bd-frame',
      title: widget.title || 'Widget',
      src: 'data:text/html;charset=utf-8,' + encodeURIComponent(doc),
      style
    })
  }
  return h('iframe', { className: 'bd-frame', title: widget.title, sandbox: 'allow-scripts', srcDoc: doc, style })
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

function GroupHero({ bot, loading, onRefresh, onCustomize, customizing, onSettings }) {
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
    h(HeroTools, { loading, onRefresh, onCustomize, customizing, onSettings }),
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

const MEMBER_STATE_LABEL = { running: 'Running', queued: 'Queued', deferred: 'Waiting', stopping: 'Stopping', idle: 'Idle', missing: 'Missing', remote: 'Remote' }

function memberState(m) {
  if (m.missing) return 'missing'
  if (m.remote) return 'remote'
  const s = String(m.state || 'idle')
  return MEMBER_STATE_LABEL[s] ? s : 'idle'
}

function memberStatusLine(m) {
  const state = memberState(m)
  if (state === 'missing') return 'This bot was deleted or renamed.'
  if (state === 'remote') return 'Runs on another machine.'
  if (m.doing) return m.doing
  if (m.lastText) return m.lastText
  if (m.lastStatus) return `Last turn ${m.lastStatus}${m.lastAt ? ` · ${relative(epochIso(m.lastAt))}` : ''}`
  return 'Idle — no turn in flight.'
}

function MembersWidget({ bot }) {
  const openTasks = id => bot.tasks.filter(t => todoIsOpen(t.status) && arr(t.owners).includes(id)).length
  const [win, setWin] = useState(false)
  const running = bot.members.filter(m => ['running', 'queued', 'deferred', 'stopping'].includes(memberState(m))).length
  return h(
    Card,
    {
      id: 'members',
      botId: bot.id,
      title: 'Members',
      count: bot.members.length,
      info: 'The bots in this room, as set in the group settings. A pulsing dot means a turn is running right now; the line under each name says what the member is doing or did last. Click a member to open its chat. The members window lists everyone with full detail.',
      tools: h('button', { type: 'button', className: 'bd-tool', title: 'Open the members window', 'aria-label': 'Open the members window', onClick: () => setWin(true) }, '⧉')
    },
    running ? h('div', { className: 'bd-win-meta' }, h('span', { className: 'bd-pill ok' }, h('span', { className: 'bd-live' }), `${running} working now`)) : null,
    bot.members.length === 0
      ? h(Empty, null, 'This group has no members.')
      : bot.members.map(m => {
          const state = memberState(m)
          const open = !m.missing && !m.remote
          const n = open ? openTasks(m.id) : 0
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
            h('span', { className: `bd-state-dot ${state}`, 'aria-hidden': true }),
            h('span', { className: 'bd-mface' }, h(BotAvatar, { bot: m })),
            h(
              'div',
              { className: 'bd-row-main' },
              h('div', { className: 'bd-row-title' }, m.name),
              h('div', { className: 'bd-row-sub', title: m.model || '' }, `@${m.handle || m.id}`, m.model ? ` · ${m.model}` : ''),
              h('div', { className: 'bd-doing', title: memberStatusLine(m) }, memberStatusLine(m))
            ),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', flex: 'none' } },
              h('span', { className: `bd-pill ${state === 'running' ? 'ok' : state === 'queued' || state === 'deferred' ? 'warn' : state === 'missing' ? 'bad' : 'muted'}` }, MEMBER_STATE_LABEL[state]),
              n ? h('span', { className: 'bd-pill muted', title: `${n} open task${n === 1 ? '' : 's'}` }, `${n} task${n === 1 ? '' : 's'}`) : null)
          )
        }),
    win ? h(MembersWindow, { bot, onClose: () => setWin(false) }) : null
  )
}

function MembersWindow({ bot, onClose }) {
  const [q, setQ] = useState('')
  const [state, setState] = useState('')
  const openTasks = id => bot.tasks.filter(t => todoIsOpen(t.status) && arr(t.owners).includes(id)).length
  const filtered = bot.members.filter(m => {
    if (state && memberState(m) !== state) return false
    return matches(`${m.name} ${m.handle || m.id} ${m.model || ''} ${m.doing || ''} ${m.lastText || ''}`, q)
  })
  const order = { running: 0, queued: 1, deferred: 2, stopping: 3, idle: 4, remote: 5, missing: 6 }
  const sorted = [...filtered].sort((a, b) => (order[memberState(a)] ?? 9) - (order[memberState(b)] ?? 9))
  return h(
    Win,
    { title: `Members · ${bot.name}`, wide: true, onClose },
    h('div', { className: 'bd-toolbar' }, h(SearchBox, { value: q, onChange: setQ, placeholder: 'Search members…' })),
    h('div', { className: 'bd-toolbar' },
      h(ChipRow, {
        options: ['running', 'queued', 'idle', 'remote', 'missing'].map(s => ({ id: s, label: MEMBER_STATE_LABEL[s] })),
        value: state, onChange: setState, allLabel: 'Any state'
      })),
    h('div', { className: 'bd-win-meta' }, `${filtered.length} shown · ${bot.members.length} members · ${bot.running || 0} turn${bot.running === 1 ? '' : 's'} in flight`),
    sorted.length === 0
      ? h(Empty, null, 'Nothing matches these filters.')
      : sorted.map(m => {
          const st = memberState(m)
          const open = !m.missing && !m.remote
          const tasks = bot.tasks.filter(t => todoIsOpen(t.status) && arr(t.owners).includes(m.id))
          return h(
            'div',
            { className: `bd-row bd-member${m.missing ? ' gone' : ''}`, key: m.id },
            h('span', { className: `bd-state-dot ${st}`, 'aria-hidden': true }),
            h('span', { className: 'bd-mface' }, h(BotAvatar, { bot: m })),
            h('div', { className: 'bd-row-main' },
              h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
                h('span', { className: 'bd-row-title' }, m.name),
                h('span', { className: `bd-pill ${st === 'running' ? 'ok' : st === 'queued' || st === 'deferred' ? 'warn' : st === 'missing' ? 'bad' : 'muted'}` }, MEMBER_STATE_LABEL[st])),
              h('div', { className: 'bd-row-sub' }, `@${m.handle || m.id}`, m.model ? ` · ${m.model}` : ''),
              h('div', { className: 'bd-doing' }, memberStatusLine(m)),
              m.since ? h('div', { className: 'bd-hint' }, `Working since ${relative(epochIso(m.since))}`) : null,
              tasks.length
                ? h('div', { style: { marginTop: 5, display: 'flex', gap: 5, flexWrap: 'wrap' } },
                    tasks.slice(0, 4).map(t => h('span', { key: t.file, className: 'bd-pill muted' }, t.title)),
                    tasks.length > 4 ? h('span', { className: 'bd-pill muted' }, `+${tasks.length - 4} more`) : null)
                : null),
            open
              ? h('button', { type: 'button', className: 'bd-btn', style: { flex: 'none' }, onClick: () => openMemberChat(m.id) }, 'Open chat')
              : null
          )
        })
  )
}

function ActivityWidget({ bot }) {
  const events = bot.events
  const [win, setWin] = useState(false)
  const inline = events.slice(0, 5)
  return h(
    Card,
    {
      id: 'activity',
      botId: bot.id,
      title: 'Activity',
      count: bot.eventCount || null,
      info: 'The latest events in this room: messages, member turns and setting changes, newest first. The activity window shows the full list with search, filters and what each member is doing right now.',
      tools: h('button', { type: 'button', className: 'bd-tool', title: 'Open the activity window', 'aria-label': 'Open the activity window', onClick: () => setWin(true) }, '⧉')
    },
    bot.running
      ? h('div', { className: 'bd-win-meta', key: 'live' }, h('span', { className: 'bd-pill ok' }, h('span', { className: 'bd-live' }), `${bot.running} member turn${bot.running === 1 ? '' : 's'} in flight`))
      : null,
    events.length === 0
      ? h(Empty, null, bot.disbanded ? 'No activity was recorded before the group was disbanded.' : 'No room activity yet. Post in the group chat to start.')
      : inline.map(e => h(EventRow, { key: e.seq ?? `${e.kind}-${e.at}`, e, compact: true })),
    events.length > 5 || bot.eventCount > events.length
      ? h('button', { type: 'button', className: 'bd-open-btn', onClick: () => setWin(true) }, `Open activity window · ${bot.eventCount || events.length} events`)
      : null,
    win ? h(ActivityWindow, { bot, onClose: () => setWin(false) }) : null
  )
}

function EventRow({ e, compact }) {
  const when = epochIso(e.at)
  return h(
    'div',
    { className: 'bd-row bd-event' },
    h('span', { className: 'bd-event-dot', 'aria-hidden': true }),
    h('div', { className: 'bd-row-main' },
      h('div', { style: { display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' } },
        h('span', { className: 'bd-row-title' }, humanKind(e.kind)),
        h('span', { className: 'bd-note-time', title: when }, relative(when))),
      h('div', { className: 'bd-row-sub' }, e.actor || 'Room'),
      e.text ? h('div', { className: 'bd-event-text' }, compact && e.text.length > 160 ? `${e.text.slice(0, 160)}…` : e.text) : null)
  )
}

/** The full room history: paged from /group/activity, grouped by day,
 *  searchable and filterable by kind and member. */
function ActivityWindow({ bot, onClose }) {
  const [events, setEvents] = useState(bot.events)
  const [count, setCount] = useState(bot.eventCount || bot.events.length)
  const [more, setMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const [actor, setActor] = useState('')
  const seqRef = useRef(0)

  const load = useCallback(async (before, append) => {
    const mine = ++seqRef.current
    setLoading(true)
    setError('')
    try {
      const qs = new URLSearchParams({ id: bot.roomId || bot.id, limit: '60' })
      if (before) qs.set('before', String(before))
      const d = await rest(`/group/activity?${qs.toString()}`)
      if (mine !== seqRef.current) return
      const page = arr(d?.events)
      setCount(d?.count ?? count)
      setMore(!!d?.more && page.length > 0)
      setEvents(prev => {
        if (!append) return page
        const seen = new Set(prev.map(e => e.seq))
        return [...prev, ...page.filter(e => !seen.has(e.seq))]
      })
    } catch (err) {
      if (mine === seqRef.current) setError(errorText(err))
    } finally {
      if (mine === seqRef.current) setLoading(false)
    }
  }, [bot.roomId, bot.id])

  useEffect(() => {
    load(null, false)
    const t = setInterval(() => load(null, false), 10_000)
    return () => clearInterval(t)
  }, [load])

  const kinds = useMemo(() => [...new Set(events.map(e => e.kind).filter(Boolean))].sort(), [events])
  const actors = useMemo(() => [...new Set(events.map(e => e.actor).filter(Boolean))].sort(), [events])

  const filtered = events.filter(e => {
    if (kind && e.kind !== kind) return false
    if (actor && e.actor !== actor) return false
    return matches(`${humanKind(e.kind)} ${e.actor || ''} ${e.text || ''}`, q)
  })

  const days = []
  for (const e of filtered) {
    const day = e.at ? new Date(e.at * 1000).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : 'Unknown date'
    let d = days.find(x => x.day === day)
    if (!d) { d = { day, items: [] }; days.push(d) }
    d.items.push(e)
  }

  const lastSeq = events.length ? events[events.length - 1].seq : null

  return h(
    Win,
    {
      title: `Activity · ${bot.name}`,
      wide: true,
      onClose,
      footer: h(React.Fragment, null,
        h('span', { className: 'bd-hint', style: { flex: 1 } }, `${count} events recorded · ${events.length} loaded`),
        more ? h('button', { type: 'button', className: 'bd-btn', disabled: loading || !lastSeq, onClick: () => load(lastSeq, true) }, loading ? 'Loading…' : 'Load older events') : null)
    },
    bot.running
      ? h('div', { className: 'bd-win-meta' }, h('span', { className: 'bd-pill ok' }, h('span', { className: 'bd-live' }), `${bot.running} member turn${bot.running === 1 ? '' : 's'} in flight`),
          arr(bot.active).map(a => h('span', { key: `${a.member}-${a.thread}`, className: 'bd-pill muted', title: a.topic || '' }, `${a.member}: ${a.status}`)))
      : null,
    h('div', { className: 'bd-toolbar' }, h(SearchBox, { value: q, onChange: setQ, placeholder: 'Search activity…' })),
    h('div', { className: 'bd-toolbar' },
      h(ChipRow, { options: kinds.map(k => ({ id: k, label: humanKind(k) })), value: kind, onChange: setKind, allLabel: 'Any kind' })),
    actors.length > 1
      ? h('div', { className: 'bd-toolbar' }, h(ChipRow, { options: actors.map(a => ({ id: a, label: a })), value: actor, onChange: setActor, allLabel: 'Anyone' }))
      : null,
    error ? h('div', { className: 'bd-error' }, `Could not load activity. ${error}`) : null,
    h('div', { className: 'bd-win-meta' }, `${filtered.length} shown`),
    filtered.length === 0
      ? h(Empty, null, events.length ? 'Nothing matches these filters.' : 'No room activity yet.')
      : days.map(d =>
          h('div', { key: d.day },
            h('div', { className: 'bd-act-day' }, `${d.day} · ${d.items.length}`),
            d.items.map(e => h(EventRow, { key: e.seq ?? `${e.kind}-${e.at}`, e }))))
  )
}

// ---------------------------------------------------------------- group pane

// Two panes, one plugin: "Bot" follows the focused bot, "Group" shows the group
// chat the user picked or opened. Everything here goes through the plugin SDK —
// the app's own markup is never read or clicked (catalog rule 8).

const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()
const GROUP_PANE = `${PLUGIN_ID}:groups`

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
  const options = [
    ...(selected ? [] : [{ value: '', label: groups.length ? 'Pick a group' : 'No group chats yet' }]),
    ...groups.map(g => ({ value: String(g.id), label: g.name }))
  ]
  return h(
    'div',
    { className: 'bd-pick' },
    h(Select, {
      style: { flex: 1 },
      label: 'Group chat',
      value: selected ? String(selected.id) : '',
      options,
      onChange: v => {
        const hit = groups.find(g => String(g.id) === v)
        if (hit) onPick({ id: hit.id, name: hit.name })
      }
    }),
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

/** A group chat's session is titled `Group: <roomId>`; older ones use the name. */
function groupForTitle(title) {
  const t = String(title || '').trim()
  const id = t.replace(/^group\s*:\s*/i, '').trim()
  return (
    groupCache.list.find(g => String(g.id) === id) ||
    groupCache.list.find(g => norm(g.name) === norm(t)) ||
    null
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
      const hit = groupForTitle(title)
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

// ---------------------------------------------------------------- settings

const PREF_KEY = 'dashboard:prefs'
const PREF_DEFAULTS = {
  compact: false,
  accent: '',
  refreshSeconds: 60,
  stampSeconds: 4,
  liveTodos: true,
  showDone: false,
  todoPreview: 5,
  taskPreview: 3,
  taskSort: 'due',
  notePreview: 3,
  noteMode: 'split',
  noteSnippet: 140,
  autosaveMs: 1200,
  projectPreview: 3
}
const PREF_LABELS = {
  compact: 'Compact rows',
  refreshSeconds: 'Full refresh (seconds)',
  stampSeconds: 'Change check (seconds)',
  liveTodos: 'Live todo updates',
  showDone: 'Show completed tasks',
  todoPreview: 'Session todos inline',
  taskPreview: 'Vault tasks inline',
  taskSort: 'Default task sort',
  notePreview: 'Notes inline',
  noteMode: 'Default note view',
  noteSnippet: 'Note preview length',
  autosaveMs: 'Note autosave (ms)',
  projectPreview: 'Projects inline'
}

function prefsKey(target) {
  return `${PREF_KEY}:${target || 'global'}`
}

function loadPrefs(target) {
  const saved = storageGet(prefsKey(target), {}) || {}
  return { ...PREF_DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) }
}

function usePrefs(target) {
  const [prefs, setPrefs] = useState(() => loadPrefs(target))
  useEffect(() => setPrefs(loadPrefs(target)), [target])
  const save = useCallback(next => {
    const value = typeof next === 'function' ? next(loadPrefs(target)) : next
    storageSet(prefsKey(target), value)
    setPrefs(value)
    return value
  }, [target])
  return [prefs, save]
}

const ACCENTS = ['', '#0053fd', '#7c5cff', '#e0559a', '#d97706', '#16a34a', '#0891b2']

function PrefRow({ label, hint, children }) {
  return h('label', { className: 'bd-pref' },
    h('span', { className: 'bd-pref-label' }, label, hint ? h('span', { className: 'bd-hint' }, hint) : null),
    h('span', { className: 'bd-pref-control' }, children))
}

function SettingsWindow({ bot, group, prefs, onSavePrefs, onClose, onCustomize }) {
  const [tab, setTab] = useState('dashboard')
  const [server, setServer] = useState(null)
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [local, setLocal] = useState({ ...prefs })

  useEffect(() => {
    let alive = true
    rest('/settings')
      .then(d => { if (alive) { setServer(d); setDraft({ ...(d?.settings || {}) }) } })
      .catch(err => { if (alive) setMessage(`Could not read settings: ${errorText(err)}`) })
    return () => { alive = false }
  }, [])

  const setPref = (key, value) => setLocal(p => ({ ...p, [key]: value }))

  const savePrefs = async () => {
    onSavePrefs(local)
    setMessage('Dashboard preferences saved.')
  }

  const saveServer = async e => {
    e.preventDefault()
    if (!draft) return
    setBusy(true)
    setMessage('')
    try {
      await rest('/settings', { method: 'POST', body: { settings: draft } })
      setServer(await rest('/settings'))
      setMessage('Plugin settings saved. Refresh the dashboard to apply vault changes.')
      host.notify?.({ kind: 'success', message: 'Bot Dashboard settings saved.' })
    } catch (err) {
      setMessage(`Could not save: ${errorText(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const numField = (key, min, max) =>
    h('input', {
      className: 'desktop-input-chrome bd-input', type: 'number', min, max, value: local[key],
      'aria-label': PREF_LABELS[key], style: { flex: '0 1 100px' },
      onChange: e => setPref(key, Math.max(min, Math.min(max, parseInt(e.target.value, 10) || min)))
    })

  const toggle = (key, label) =>
    h('button', {
      type: 'button', className: `bd-chip${local[key] ? ' on' : ''}`, 'aria-pressed': !!local[key],
      onClick: () => setPref(key, !local[key])
    }, label)

  const dashboardTab = h('div', null,
    h('div', { className: 'bd-settings-group' },
      h('h4', null, 'Appearance'),
      h(PrefRow, { label: 'Accent colour', hint: 'Overrides this dashboard only.' },
        h('div', { className: 'bd-swatches' }, ACCENTS.map(c =>
          h('button', {
            key: c || 'auto', type: 'button',
            className: `bd-swatch${local.accent === c ? ' on' : ''}${c ? '' : ' auto'}`,
            style: c ? { background: c } : undefined,
            title: c || 'Follow the app theme', 'aria-label': c || 'Follow the app theme',
            'aria-pressed': local.accent === c,
            onClick: () => setPref('accent', c)
          })))),
      h(PrefRow, { label: 'Row density' }, toggle('compact', 'Compact rows')),
      h('div', { className: 'bd-hint' }, 'Card order and visibility are managed in Customize. ',
        h('button', { type: 'button', className: 'bd-link', onClick: () => { onCustomize(); onClose() } }, 'Open Customize'))),
    h('div', { className: 'bd-settings-group' },
      h('h4', null, 'Behaviour'),
      h(PrefRow, { label: PREF_LABELS.liveTodos, hint: 'From gateway todo.updated events.' }, toggle('liveTodos', 'Live updates')),
      h(PrefRow, { label: PREF_LABELS.showDone }, toggle('showDone', 'Show completed')),
      h(PrefRow, { label: PREF_LABELS.stampSeconds }, numField('stampSeconds', 2, 60)),
      h(PrefRow, { label: PREF_LABELS.refreshSeconds }, numField('refreshSeconds', 15, 600))),
    h('div', { className: 'bd-settings-group' },
      h('h4', null, 'Cards'),
      h(PrefRow, { label: PREF_LABELS.todoPreview }, numField('todoPreview', 1, 20)),
      h(PrefRow, { label: PREF_LABELS.taskPreview }, numField('taskPreview', 1, 20)),
      h(PrefRow, { label: PREF_LABELS.taskSort }, h(Select, {
        value: local.taskSort, label: PREF_LABELS.taskSort,
        options: [{ value: 'due', label: 'Due date' }, { value: 'title', label: 'Title' }, { value: 'status', label: 'Status' }],
        onChange: v => setPref('taskSort', v)
      })),
      h(PrefRow, { label: PREF_LABELS.notePreview }, numField('notePreview', 1, 20)),
      h(PrefRow, { label: PREF_LABELS.noteSnippet }, numField('noteSnippet', 40, 600)),
      h(PrefRow, { label: PREF_LABELS.noteMode }, h(Select, {
        value: local.noteMode, label: PREF_LABELS.noteMode,
        options: [{ value: 'read', label: 'Read' }, { value: 'write', label: 'Write' }, { value: 'split', label: 'Split' }],
        onChange: v => setPref('noteMode', v)
      })),
      h(PrefRow, { label: PREF_LABELS.autosaveMs }, numField('autosaveMs', 300, 5000)),
      h(PrefRow, { label: PREF_LABELS.projectPreview }, numField('projectPreview', 1, 20))),
    h('div', { className: 'bd-toolbar', style: { justifyContent: 'flex-end' } },
      h('button', { type: 'button', className: 'bd-btn', onClick: () => setLocal({ ...PREF_DEFAULTS }) }, 'Reset defaults'),
      h('button', { type: 'button', className: 'bd-btn primary', onClick: savePrefs }, 'Save preferences')))

  const vaultTab = h('form', { onSubmit: saveServer },
    h('p', { className: 'bd-hint' },
      'Shared by every bot and group on this computer. Only these five keys are written to config.yaml — tokens and comments are left untouched. Values set through environment variables cannot be changed here.'),
    !server
      ? h('div', { className: 'bd-skeleton', style: { height: 180 } })
      : h('div', { className: 'bd-settings-group' },
          h(PrefRow, { label: 'Vault path', hint: 'A markdown/Obsidian vault folder. Task and project notes live here.' },
            h('input', {
              className: 'desktop-input-chrome bd-input', value: draft?.vault_path || '',
              placeholder: 'C:/Users/you/Desktop/HermesBrain', 'aria-label': 'Vault path',
              onChange: e => setDraft(d => ({ ...d, vault_path: e.target.value }))
            })),
          h(PrefRow, { label: 'Tasks folder', hint: 'Relative to the vault path.' },
            h('input', { className: 'desktop-input-chrome bd-input', value: draft?.tasks_folder || '', 'aria-label': 'Tasks folder', onChange: e => setDraft(d => ({ ...d, tasks_folder: e.target.value })) })),
          h(PrefRow, { label: 'Projects folder', hint: 'Relative to the vault path.' },
            h('input', { className: 'desktop-input-chrome bd-input', value: draft?.projects_folder || '', 'aria-label': 'Projects folder', onChange: e => setDraft(d => ({ ...d, projects_folder: e.target.value })) })),
          h(PrefRow, { label: 'Owner field', hint: 'Frontmatter key that names the bot a note belongs to.' },
            h('input', { className: 'desktop-input-chrome bd-input', value: draft?.owner_field || '', 'aria-label': 'Owner field', onChange: e => setDraft(d => ({ ...d, owner_field: e.target.value })) })),
          h(PrefRow, { label: 'Panel rule', hint: 'Instruction added to every turn. Bots use it to record decisions here.' },
            h('textarea', { className: 'desktop-input-chrome bd-input bd-textarea', rows: 3, value: draft?.panel_rule || '', 'aria-label': 'Panel rule', onChange: e => setDraft(d => ({ ...d, panel_rule: e.target.value })) })),
          h('div', { className: 'bd-win-meta' },
            h('span', { className: `bd-pill ${server.vaultFound ? 'ok' : 'warn'}` }, server.vaultFound ? 'Vault found' : 'Vault not found'),
            h('span', { className: 'bd-hint' }, server.path || '')),
          Object.entries(server.envOverrides || {}).filter(([, v]) => v).map(([k]) =>
            h('div', { className: 'bd-hint', key: k }, `${k} is set through an environment variable and cannot be changed here.`))),
    h('div', { className: 'bd-toolbar', style: { justifyContent: 'flex-end' } },
      h('button', { type: 'submit', className: 'bd-btn primary', disabled: busy || !draft }, busy ? 'Saving…' : 'Save plugin settings')))

  return h(
    Win,
    {
      title: `Settings · ${group ? bot.name : `@${bot.id}`}`,
      wide: true,
      onClose,
      footer: h('span', { className: `bd-save-state ${message.startsWith('Could not') ? '' : 'saved'}` }, message || 'Dashboard preferences are stored with this pane.')
    },
    h('div', { className: 'bd-seg', role: 'tablist', 'aria-label': 'Settings section' },
      [{ id: 'dashboard', label: 'Dashboard' }, { id: 'vault', label: 'Vault & rules' }].map(t =>
        h('button', {
          key: t.id, type: 'button', role: 'tab', className: tab === t.id ? 'on' : '',
          'aria-selected': tab === t.id, onClick: () => setTab(t.id)
        }, t.label))),
    group ? h('div', { className: 'bd-win-meta' }, `Group chat · ${bot.members.length} members · ${bot.eventCount || 0} events`) : null,
    tab === 'dashboard' ? dashboardTab : vaultTab
  )
}

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
  const [prefs, savePrefs] = usePrefs(botId)
  const [settingsOpen, setSettingsOpen] = useState(false)
  useEffect(() => setSettingsOpen(false), [botId, kind])

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
    const fast = setInterval(check, Math.max(2, Number(prefs.stampSeconds) || STAMP_MS / 1000) * 1000)
    const slow = setInterval(load, Math.max(15, Number(prefs.refreshSeconds) || REFRESH_MS / 1000) * 1000)
    return () => {
      stopped = true
      clearInterval(fast)
      clearInterval(slow)
    }
  }, [load, botId, base, prefs.stampSeconds, prefs.refreshSeconds])

  const [customizing, setCustomizing] = useState(false)
  useEffect(() => setCustomizing(false), [botId, kind])

  const baseAccent = group ? bot?.members?.find(m => m.color)?.color : bot?.color
  const accent = prefs.accent || baseAccent
  const style = useMemo(() => ({
    ...(accent ? { '--bd-accent': accent } : {}),
    ...(prefs.compact ? { '--bd-row-pad': '4px 8px' } : {})
  }), [accent, prefs.compact])

  if (bot && bot.missing) {
    const title = group
      ? bot.reason === 'invalid' ? 'This group could not be read' : 'This group is no longer here'
      : bot.reason === 'invalid' ? 'This chat has no bot profile' : `@${botId} is no longer here`
    const body = group
      ? 'The group was deleted, or its room has not reached this computer yet. Open a chat from the Bots list to see its dashboard.'
      : bot.reason === 'invalid'
        ? 'Open a bot from the Bots list to see its dashboard.'
        : 'The bot was deleted or renamed. Open a bot from the Bots list to see its dashboard.'
    return h('div', { className: `bd${group ? ' bd-group' : ''}`, 'data-bot': botId, 'data-version': '1.2.0' },
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
    const heroProps = {
      bot, loading, onRefresh: load,
      onCustomize: () => setCustomizing(c => !c),
      customizing,
      onSettings: () => setSettingsOpen(true)
    }
    if (key === 'profile') return h(group ? GroupHero : Hero, heroProps)
    if (key === 'jobs' && !group) return h(JobsWidget, { botId: bot.id })
    if (key === 'members' && group) return h(MembersWidget, { bot })
    if (key === 'activity' && group) return h(ActivityWidget, { bot })
    if (key === 'tasks') return h(TasksWidget, {
      bot, onChanged: load, prefs,
      showDoneDefault: prefs.showDone, liveTodos: prefs.liveTodos
    })
    if (key === 'notes') return h(NotesWidget, {
      bot, onChanged: load, prefs,
      defaultMode: prefs.noteMode
    })
    if (key === 'projects') return h(ProjectsWidget, { bot, onChanged: load, prefs })
    const w = widgets.find(x => `w:${x.id}` === key)
    return w ? h(CustomWidget, { bot, widget: w }) : null
  }
  const visible = layout.order.filter(k => k === 'profile' || !layout.hidden.includes(k))
  const heroAt = Math.max(0, visible.indexOf('profile'))

  return h(
    'div',
    { className: `bd${group ? ' bd-group' : ''}`, style, 'data-bot': bot.id, 'data-kind': group ? 'group' : 'bot', 'data-version': '1.2.0' },
    ...visible.slice(0, heroAt + 1).map(cardFor),
    customizing ? h(CardBoundary, { key: 'customize', label: 'editor', resetKey: bot.id }, h(CustomizePanel, { bot, onChanged: load, onClose: () => setCustomizing(false) })) : null,
    error ? h('div', { className: 'bd-error', key: 'err' }, `Showing the last loaded data. ${error}`) : null,
    ...visible.slice(heroAt + 1).map(cardFor),
    vaultNotice(bot),
    settingsOpen ? h(SettingsWindow, {
      bot, group, prefs,
      onSavePrefs: savePrefs,
      onCustomize: () => setCustomizing(true),
      onClose: () => setSettingsOpen(false)
    }) : null,
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
    ctx.register({
      id: 'show-bot',
      area: 'palette',
      data: {
        id: 'bot-dashboard.showBot',
        label: 'Bot dashboard: show the Bot pane',
        keywords: ['bot', 'dashboard', 'pane', 'panel', 'restore', 'closed'],
        run: () => {
          host.undismissPane?.(`${PLUGIN_ID}:pane`)
          host.revealPane?.(`${PLUGIN_ID}:pane`)
        }
      }
    })
    ctx.register({
      id: 'show-group',
      area: 'palette',
      data: {
        id: 'bot-dashboard.showGroup',
        label: 'Bot dashboard: show the Group pane',
        keywords: ['group', 'dashboard', 'pane', 'panel', 'restore', 'closed'],
        run: () => {
          host.undismissPane?.(`${PLUGIN_ID}:groups`)
          host.revealPane?.(`${PLUGIN_ID}:groups`)
        }
      }
    })
    // A persisted Close outlives the layout that caused it, so a dismissed pane
    // never adopts again and there is no UI to bring it back. Undismiss once
    // per restore key; a Close the user makes after that still sticks.
    try {
      if (
        ctx.storage?.get('panesRestored', null) !== PANE_RESTORE_KEY &&
        typeof host.undismissPane === 'function'
      ) {
        host.undismissPane(`${PLUGIN_ID}:pane`)
        host.undismissPane(`${PLUGIN_ID}:groups`)
        ctx.storage?.set('panesRestored', PANE_RESTORE_KEY)
      }
    } catch {
      /* older desktops without undismissPane */
    }
    ctx.onDispose?.(() => document.getElementById(STYLE_ID)?.remove())
  }
}
