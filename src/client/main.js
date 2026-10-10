/**
 * Source of the shipped client bundle.
 *
 * `scripts/build-client.mjs` wraps this file in the DSH module-loader form and
 * inlines the pure logic, producing `lib/client.js`. Never edit the bundle by
 * hand; edit here and rebuild.
 *
 * Why the build step exists at all: the browser resolves nothing. A relative
 * `require('./logic.js')` cannot work (the loader only resolves platform seeds
 * and registered bundles), and a bare IIFE calling `require(...)` throws
 * `ReferenceError: require is not defined` at import time — which is not a plugin
 * failure but a *web boot* failure, leaving the whole GUI unable to open.
 *
 * What it does, in the order the file is organised:
 *   1. inject one scoped stylesheet and one backdrop element;
 *   2. preload the 24 intensity frames so a drag never shows a blank frame;
 *   3. take the composer's model seat, so the model selector and the effort
 *      control read as one instrument;
 *   4. register one row in Settings → General for the appearance switch.
 *
 * Dragging only previews: a commit happens on release, on keyboard settle and on
 * wheel settle, and it always submits an effort id the adapter advertised.
 */
'use strict'

const PACKAGE_ID = 'dsh-rheostat-effort'
const ASSET_BASE = `/plugins/${PACKAGE_ID}/assets/`
const ROOT_ATTR = 'data-rheostat-effort'
const SETTLE_MS = 140
/** How often the control re-asks for a model directory a new session does not have yet. */
const RETRY_MS = 1000

/**
 * Backdrop framing, all overridable from the profile's patch row.
 *
 * Defaults place the character on the right third, head above the centre line,
 * with no extra zoom: `cover` already grows the 1:1 frame until it fills a wide
 * viewport, which is what carries its studio backdrop edge to edge.
 *
 *   backdropFocusX  0..1   horizontal anchor of the visible window (1 = right)
 *   backdropFocusY  0..1   vertical anchor
 *   backdropZoom    >0     extra magnification on top of `cover`
 *   backdropOpacity 0..1   strength of the character over its own backdrop
 *   backdropColor   css    the base layer; default is the measured studio grey
 */
const BACKDROP_DEFAULTS = {
  backdropFocusX: 1,
  backdropFocusY: 0.42,
  backdropZoom: 1,
  backdropOpacity: 0.92,
  backdropColor: 'rgb(156 157 161)',
}

/* __LOGIC__ */



/* ------------------------------------------------------------------ *
 * stylesheet
 * ------------------------------------------------------------------ */

const CSS = `
[${ROOT_ATTR}] {
--rheostat-hue: 168;
--rheostat-alpha: 0.12;
--rheostat-glow: 0.3;
--rheostat-frame-backdrop: rgb(156 157 161);
--rheostat-focus-x: 100%;
--rheostat-focus-y: 42%;
--rheostat-zoom: 1;
--rheostat-frame-opacity: 0.92;
}

/* The portrait stage.
 *
[${ROOT_ATTR}] .rheostat-backdrop {
position: fixed;
inset: 0;
z-index: 0;
pointer-events: none;
overflow: hidden;
/* The measured studio grey, so the first paint matches the art before a frame
   has decoded. */
background: var(--rheostat-frame-backdrop);
transition: background 220ms ease;
}
[${ROOT_ATTR}] .rheostat-portrait {
position: absolute;
inset: 0;
width: 100%;
height: 100%;
/* cover blows the frame up until it fills the viewport, so the frame's own
   backdrop becomes the bottom layer and the character grows with it. */
object-fit: cover;
/* Anchored right: the character reads as standing on the right of the screen. */
object-position: 100% var(--rheostat-focus-y);
transform: scale(var(--rheostat-zoom));
transform-origin: 100% var(--rheostat-focus-y);
opacity: calc(var(--rheostat-alpha) * var(--rheostat-frame-opacity) / 0.12);
transition: opacity 260ms ease;
-webkit-user-drag: none;
}
[${ROOT_ATTR}] .rheostat-portrait-upper { opacity: 0 }

/* Readability scrim: darkest over the left column, where the conversation and
 * composer live, so the character stays visible on the right. */
[${ROOT_ATTR}] .rheostat-backdrop::after {
content: '';
position: absolute;
inset: 0;
background: linear-gradient(90deg,
  rgb(0 0 0 / 0.5) 0%,
  rgb(0 0 0 / 0.24) 45%,
  rgb(0 0 0 / 0.04) 72%,
  transparent 100%);
pointer-events: none;
}
/* A tint in the theme's hue keeps the skin tied to the current level. */
[${ROOT_ATTR}] .rheostat-backdrop::before {
content: '';
position: absolute;
inset: 0;
background: radial-gradient(90% 70% at 100% 20%,
  hsl(var(--rheostat-hue) 70% 55% / var(--rheostat-glow)) 0%,
  transparent 65%);
pointer-events: none;
}
[${ROOT_ATTR}] .rheostat {
position: relative;
display: inline-flex;
align-items: center;
gap: 8px;
}
[${ROOT_ATTR}] .rheostat-control {
display: inline-flex;
align-items: center;
gap: 8px;
padding: 3px 10px 3px 8px;
border: 1px solid var(--dsw-alias-border-subtle, rgb(128 128 128 / 0.28));
border-radius: 999px;
background: var(--dsw-alias-bg-elevated, rgb(128 128 128 / 0.06));
color: inherit;
font: inherit;
line-height: 1;
cursor: pointer;
user-select: none;
touch-action: none;
}
[${ROOT_ATTR}] .rheostat-control:focus-visible {
outline: 2px solid hsl(var(--rheostat-hue) 70% 50%);
outline-offset: 2px;
}
[${ROOT_ATTR}] .rheostat-control[data-pending='true'] { opacity: 0.72 }
[${ROOT_ATTR}] .rheostat-control[data-disabled='true'] { opacity: 0.5; cursor: default }

/* The knob is machinery now: a machined cap whose pointer swings with the level.
 * The character lives in the backdrop, so this stays legible at 24px. */
[${ROOT_ATTR}] .rheostat-knob {
position: relative;
flex: none;
width: 24px;
height: 24px;
border-radius: 50%;
background:
  radial-gradient(circle at 32% 28%, rgb(255 255 255 / 0.55), transparent 55%),
  linear-gradient(180deg,
    hsl(var(--rheostat-hue) 25% 42%),
    hsl(var(--rheostat-hue) 30% 22%));
box-shadow:
  inset 0 0 0 1px rgb(255 255 255 / 0.25),
  0 1px 2px rgb(0 0 0 / 0.4);
}
[${ROOT_ATTR}] .rheostat-knob::before {
content: '';
position: absolute;
inset: 3px;
border-radius: 50%;
background: repeating-conic-gradient(from 0deg,
  rgb(255 255 255 / 0.28) 0deg 1.5deg,
  transparent 1.5deg 15deg);
}
[${ROOT_ATTR}] .rheostat-knob::after {
  /* the lever that turns with the level, rotated by the inline --rheostat-turn */
content: '';
position: absolute;
left: 50%;
top: 3px;
width: 2px;
height: 9px;
margin-left: -1px;
border-radius: 1px;
background: hsl(var(--rheostat-hue) 80% 70%);
box-shadow: 0 0 4px hsl(var(--rheostat-hue) 80% 60% / 0.9);
transform: rotate(var(--rheostat-turn, -120deg));
transform-origin: 50% 9px;
transition: transform 120ms ease-out;
}
[${ROOT_ATTR}] .rheostat-rail {
position: relative;
width: 124px;
height: 12px;
border-radius: 3px;
background: linear-gradient(180deg, rgb(0 0 0 / 0.22), rgb(255 255 255 / 0.06));
box-shadow: inset 0 1px 2px rgb(0 0 0 / 0.35);
}
[${ROOT_ATTR}] .rheostat-rail::after {
/* the winding of a rheostat: one tick per level */
content: '';
position: absolute;
inset: 2px 0;
background: repeating-linear-gradient(90deg,
  transparent 0 3.3px,
  rgb(0 0 0 / 0.28) 3.3px 4.13px);
pointer-events: none;
}
[${ROOT_ATTR}] .rheostat-fill {
position: absolute;
inset: 0 auto 0 0;
border-radius: 3px;
background: linear-gradient(90deg,
  hsl(8 70% 55% / 0.85),
  hsl(var(--rheostat-hue) 70% 55% / 0.85));
pointer-events: none;
}
[${ROOT_ATTR}] .rheostat-readout {
min-width: 4.6em;
font-size: 11px;
font-variant-numeric: tabular-nums;
opacity: 0.75;
white-space: nowrap;
}
[${ROOT_ATTR}] .rheostat-control[data-dragging='true'] .rheostat-readout { opacity: 1 }
[${ROOT_ATTR}] .rheostat-model {
display: inline-flex;
align-items: center;
gap: 4px;
max-width: 14em;
padding: 3px 8px;
border: 1px solid var(--dsw-alias-border-subtle, rgb(128 128 128 / 0.28));
border-radius: 8px;
background: var(--dsw-alias-bg-elevated, rgb(128 128 128 / 0.06));
color: inherit;
font: inherit;
line-height: 1.2;
cursor: pointer;
}
[${ROOT_ATTR}] .rheostat-model:focus-visible {
outline: 2px solid hsl(var(--rheostat-hue) 70% 50%);
outline-offset: 2px;
}
[${ROOT_ATTR}] .rheostat-model-name {
overflow: hidden;
text-overflow: ellipsis;
white-space: nowrap;
}
[${ROOT_ATTR}] .rheostat-menu {
position: absolute;
bottom: calc(100% + 6px);
left: 0;
z-index: 40;
min-width: 15em;
max-height: 22em;
overflow-y: auto;
padding: 4px;
border: 1px solid var(--dsw-alias-border-subtle, rgb(128 128 128 / 0.28));
border-radius: 10px;
background: var(--dsw-alias-bg-elevated, rgb(40 40 40 / 0.98));
box-shadow: 0 12px 32px rgb(0 0 0 / 0.28);
}
[${ROOT_ATTR}] .rheostat-group {
padding: 6px 8px 2px;
font-size: 10px;
letter-spacing: 0.04em;
text-transform: uppercase;
opacity: 0.55;
}
[${ROOT_ATTR}] .rheostat-option {
display: flex;
align-items: center;
justify-content: space-between;
gap: 10px;
width: 100%;
padding: 6px 8px;
border: 0;
border-radius: 7px;
background: transparent;
color: inherit;
font: inherit;
text-align: left;
cursor: pointer;
}
[${ROOT_ATTR}] .rheostat-option:hover,
[${ROOT_ATTR}] .rheostat-option:focus-visible {
background: rgb(128 128 128 / 0.16);
outline: none;
}
[${ROOT_ATTR}] .rheostat-option[data-current='true'] { font-weight: 600 }
[${ROOT_ATTR}] .rheostat-option-effort { font-size: 11px; opacity: 0.6 }
[${ROOT_ATTR}] .rheostat-empty { padding: 8px; font-size: 12px; opacity: 0.6 }
[${ROOT_ATTR}] .rheostat-setting {
display: flex;
align-items: center;
justify-content: space-between;
gap: 16px;
padding: 10px 2px;
}
[${ROOT_ATTR}] .rheostat-setting-title { font-size: 13px; font-weight: 600 }
[${ROOT_ATTR}] .rheostat-setting-note {
margin-top: 2px;
font-size: 11px;
opacity: 0.6;
max-width: 46ch;
}
[${ROOT_ATTR}] .rheostat-setting-switch {
position: relative;
flex: none;
width: 40px;
height: 22px;
padding: 0;
border: 1px solid var(--dsw-alias-border-subtle, rgb(128 128 128 / 0.35));
border-radius: 999px;
background: rgb(128 128 128 / 0.25);
cursor: pointer;
transition: background 160ms ease;
}
[${ROOT_ATTR}] .rheostat-setting-switch[data-enabled='true'] {
background: hsl(var(--rheostat-hue) 65% 45%);
border-color: hsl(var(--rheostat-hue) 65% 45%);
}
[${ROOT_ATTR}] .rheostat-setting-switch[data-disabled='true'] { opacity: 0.5; cursor: default }
[${ROOT_ATTR}] .rheostat-setting-switch:focus-visible {
outline: 2px solid hsl(var(--rheostat-hue) 70% 50%);
outline-offset: 2px;
}
[${ROOT_ATTR}] .rheostat-setting-knob {
position: absolute;
top: 2px;
left: 2px;
width: 16px;
height: 16px;
border-radius: 50%;
background: #fff;
box-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
transition: transform 160ms ease;
}
[${ROOT_ATTR}] .rheostat-setting-switch[data-enabled='true'] .rheostat-setting-knob {
transform: translateX(18px);
}
@media (prefers-reduced-motion: reduce) {
[${ROOT_ATTR}] .rheostat-backdrop { transition: none }
[${ROOT_ATTR}] .rheostat-setting-switch,
[${ROOT_ATTR}] .rheostat-setting-knob { transition: none }
}
`

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

function setBackdropVars(level, skinOn = true) {
  const root = document.documentElement
  if (!root.hasAttribute(ROOT_ATTR)) root.setAttribute(ROOT_ATTR, '')
  const tone = backdropForLevel(level)
  root.style.setProperty('--rheostat-hue', String(tone.hue))
  // The portrait is the loud part of the skin, so it gets its own intensity:
  // the tone keeps its documented alpha range while the character carries more.
  root.style.setProperty('--rheostat-alpha', String(skinOn ? Math.min(1, tone.alpha * 5.2) : 0))
  root.style.setProperty('--rheostat-glow', String(tone.glow))
}

/** Degrees of lever rotation for a level on the 0-30 axis, -120deg..+120deg. */
function knobTurn(level) {
  return -120 + (Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, level)) / MAX_LEVEL) * 240
}

/**
 * The backdrop: a fixed stage holding two stacked portrait layers.
 *
 * `lower` is always visible for its anchor; `upper` is the neighbouring frame,
 * included with the blend fraction whenever the level sits between anchors. That
 * keeps the character continuous across the whole 0-30 axis even though only 24
 * frames exist.
 */
function createBackdrop() {
  const element = document.createElement('div')
  element.className = 'rheostat-backdrop'
  element.setAttribute('aria-hidden', 'true')

  const lower = document.createElement('img')
  lower.className = 'rheostat-portrait rheostat-portrait-lower'
  lower.alt = ''
  lower.draggable = false

  const upper = document.createElement('img')
  upper.className = 'rheostat-portrait rheostat-portrait-upper'
  upper.alt = ''
  upper.draggable = false

  element.append(lower, upper)
  document.body.append(element)
  return { element, lower, upper }
}

/** Point the two layers at the frames for `level`, cross-fading between them. */
function paintPortrait(backdrop, level) {
  const frame = frameForLevel(level)
  const lowerSrc = `${ASSET_BASE}${frameName(frame.lower)}`
  const upperSrc = `${ASSET_BASE}${frameName(frame.upper)}`

  if (backdrop.lower.getAttribute('src') !== lowerSrc) backdrop.lower.setAttribute('src', lowerSrc)
  if (backdrop.upper.getAttribute('src') !== upperSrc) backdrop.upper.setAttribute('src', upperSrc)
  backdrop.upper.style.opacity = frame.exact ? '0' : String(frame.mix)
}

/**
 * Apply the framing configuration to the root element.
 *
 * Every value is a CSS custom property, so a restyle is one inline style change
 * rather than a re-render, and the profile's patch row can override the defaults
 * without touching this file.
 */
function applyBackdropConfig(config) {
  const root = document.documentElement
  if (!root.hasAttribute(ROOT_ATTR)) root.setAttribute(ROOT_ATTR, '')
  const merged = { ...BACKDROP_DEFAULTS, ...(config ?? {}) }
  const clamp = (value, fallback) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback)
  const zoom = Number.isFinite(merged.backdropZoom) && merged.backdropZoom > 0 ? merged.backdropZoom : 1
  const opacity = clamp(Number(merged.backdropOpacity), BACKDROP_DEFAULTS.backdropOpacity)

  root.style.setProperty('--rheostat-focus-x', `${clamp(Number(merged.backdropFocusX), 1) * 100}%`)
  root.style.setProperty('--rheostat-focus-y', `${clamp(Number(merged.backdropFocusY), 0.42) * 100}%`)
  root.style.setProperty('--rheostat-zoom', String(zoom))
  root.style.setProperty('--rheostat-frame-opacity', String(opacity))
  if (typeof merged.backdropColor === 'string' && merged.backdropColor !== '') {
    root.style.setProperty('--rheostat-frame-backdrop', merged.backdropColor)
  }
}

/**
 * The snapshot of a directory that is not there (yet).
 *
 * `readSnapshot` must never return null: a null snapshot is indistinguishable
 * from "the store published nothing", and `useSyncExternalStore` consumers here
 * would then have to guard every field. One frozen empty state is simpler and
 * keeps the reducer total.
 */
const EMPTY_DIRECTORY = Object.freeze({ current: null, groups: [], status: 'idle', error: null })

/** `directory` is a SnapshotStore; tolerate either subscribe spelling. */
function useSnapshot(React, store) {
  return React.useSyncExternalStore(
    (listener) => {
      if (typeof store?.subscribe === 'function') return store.subscribe(listener)
      if (typeof store?.onChange === 'function') return store.onChange(listener)
      return () => {}
    },
    () => {
      if (typeof store?.getSnapshot !== 'function') return EMPTY_DIRECTORY
      const snapshot = store.getSnapshot()
      return snapshot === null || snapshot === undefined ? EMPTY_DIRECTORY : snapshot
    },
    () => EMPTY_DIRECTORY,
  )
}

function effortsOf(model) {
  const efforts = model?.reasoning?.efforts
  return Array.isArray(efforts) ? efforts : []
}

function modelNameOf(model) {
  const name = model?.name
  if (typeof name === 'string' && name.trim() !== '') return name.trim()
  return typeof model?.id === 'string' ? model.id : ''
}

/** Reduce the published directory into everything the control renders from. */
function resolve(state) {
  const groups = Array.isArray(state?.groups) ? state.groups : []
  const current = state?.current ?? null
  let model = null
  if (current !== null) {
    for (const group of groups) {
      const hit = (group?.models ?? []).find((candidate) => candidate?.id === current.model)
      if (hit !== undefined) {
        model = hit
        break
      }
    }
  }
  if (model === null) {
    for (const group of groups) {
      const first = (group?.models ?? []).find((candidate) => effortsOf(candidate).length > 1)
      if (first !== undefined) {
        model = first
        break
      }
    }
  }
  const efforts = effortsOf(model)
  const selectedIndex =
    current === null ? -1 : efforts.findIndex((effort) => effort?.id === current.reasoningEffort)
  const offered = groups.reduce((total, group) => total + (group?.models?.length ?? 0), 0)
  return { current, groups, model, efforts, selectedIndex, offered }
}

/** A submitted selection must be complete: provider + model + one effort id. */
function selectionFor(current, model, effortId) {
  return { provider: current.provider, model: model.id, reasoningEffort: effortId }
}

function effortForModel(model, preferred, currentEffort) {
  const efforts = effortsOf(model)
  if (efforts.length === 0) return preferred ?? currentEffort
  if (currentEffort !== undefined && efforts.some((effort) => effort?.id === currentEffort)) {
    return currentEffort
  }
  const preferredId = model?.reasoning?.defaultEffort ?? preferred
  if (preferredId !== undefined && efforts.some((effort) => effort?.id === preferredId)) return preferredId
  return efforts[0]?.id
}

/* ------------------------------------------------------------------ *
 * appearance preference
 * ------------------------------------------------------------------ */

/**
 * Where the skin switch persists. The form is created lazily from the Host
 * settings document the first time a row reads it, and only when the host
 * actually serves that namespace; otherwise the default stays in force.
 */
const SETTINGS_FORM = 'rheostat-effort'
const SETTINGS_FIELD = 'skin'

/**
 * `forms` is the *awaited* configForms service, handed in rather than read off
 * `ctx`. Reading `ctx.configForms` for a service no row declared throws
 * `cannot get property "configForms" without inject` — and when that read happens
 * inside a seat's inject face, it takes the whole seat entry down with it.
 */
function createSettings(forms) {
  let form = null
  let failure = false

  const getForm = () => {
    if (form !== null || failure) return form
    if (typeof forms?.get !== 'function') return null
    try {
      form = forms.get(SETTINGS_FORM) ?? null
    } catch {
      failure = true
      form = null
    }
    return form
  }

  return {
    /** Whether the Host actually serves a writable preference namespace. */
    bound() {
      return getForm() !== null
    },
    /** A snapshot store for the shell to turn into a selector hook. */
    store() {
      const current = getForm()
      if (current === null) return undefined
      if (typeof current.store === 'object' && current.store !== null) return current.store
      return { store: current }
    },
    /** The effective preference: an unset field means "skin on". */
    enabled() {
      const current = getForm()
      if (current === null) return false
      if (typeof current.getSnapshot !== 'function') return true
      const snapshot = current.getSnapshot()
      if (snapshot === null || typeof snapshot !== 'object') return true
      if (snapshot.value === null || typeof snapshot.value !== 'object') return true
      return snapshot.value[SETTINGS_FIELD] !== false
    },
    set(enabled) {
      const current = getForm()
      if (current === null || typeof current.set !== 'function') return Promise.resolve(false)
      return Promise.resolve(current.set(SETTINGS_FIELD, enabled)).then(
        () => true,
        () => false,
      )
    },
  }
}

/* ------------------------------------------------------------------ *
 * settings row
 * ------------------------------------------------------------------ */

/**
 * One row in Settings → General. The section column only stacks rows, so this
 * component draws its own label, value and write path. `useRheostatSkin` is
 * the shell's selector hook over the store the inject face exposes; `enabled`
 * is passed alongside it because a store notification alone does not tell this
 * client what an *unset* field resolves to.
 */
function SettingsRow(props) {
  const React = require('react')
  const h = React.createElement
  const { useState } = React
  const snapshot = props.useRheostatSkin !== undefined ? props.useRheostatSkin((value) => value) : undefined
  const formAvailable = props.bound === true && snapshot !== undefined && snapshot !== null
  const writable = formAvailable ? snapshot.writable !== false : false
  const enabled = formAvailable && props.enabled === true
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const toggle = () => {
    if (!writable || busy) return
    setBusy(true)
    setError(null)
    Promise.resolve(props.setRheostatSkin(!enabled)).then(
      (ok) => {
        setBusy(false)
        if (!ok) setError('failed')
      },
      () => {
        setBusy(false)
        setError('failed')
      },
    )
  }

  return h(
    'div',
    { className: 'rheostat-setting' },
    h(
      'div',
      { className: 'rheostat-setting-text' },
      h('div', { className: 'rheostat-setting-title' }, '滑动变阻器'),
      h(
        'div',
        { className: 'rheostat-setting-note' },
        formAvailable
          ? '推理档位显示为 0–30 强度滑块，并带随档位变化的背景层。'
          : '当前 Host 不提供可写的外观设置，皮肤保持开启。',
      ),
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'rheostat-setting-switch',
        role: 'switch',
        'aria-checked': enabled ? 'true' : 'false',
        'aria-label': '滑动变阻器外观',
        'data-enabled': enabled ? 'true' : 'false',
        'data-disabled': writable && !busy ? 'false' : 'true',
        disabled: !writable || busy,
        onClick: toggle,
        title: error === null ? undefined : '写入失败，请重试',
      },
      h('span', { className: 'rheostat-setting-knob' }),
    ),
  )
}

/* ------------------------------------------------------------------ *
 * model chooser
 * ------------------------------------------------------------------ */

function ModelChooser(props) {
  const React = require('react')
  const { useCallback, useEffect, useRef, useState } = React
  const h = React.createElement
  const { view, disabled, onPick } = props
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDocumentPointerDown = (event) => {
      const root = rootRef.current
      if (root !== null && typeof root.contains === 'function' && root.contains(event.target)) return
      setOpen(false)
    }
    const onDocumentKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDocumentPointerDown, true)
    document.addEventListener('keydown', onDocumentKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onDocumentPointerDown, true)
      document.removeEventListener('keydown', onDocumentKeyDown, true)
    }
  }, [open])

  const toggle = useCallback(
    (event) => {
      event.stopPropagation()
      if (disabled) return
      setOpen((value) => !value)
    },
    [disabled],
  )

  // A single-model catalog normally does not deserve a picker, but when this
  // component is the ONLY model control left (the seat suppressed the native one)
  // it must render even then — `force` says so.
  if (view.offered <= 1 && props.force !== true) return null

  const currentModelId = view.current?.model
  const rows = []
  for (const group of view.groups) {
    const models = Array.isArray(group?.models) ? group.models : []
    if (models.length === 0) continue
    rows.push(
      h('div', { className: 'rheostat-group', key: `group-${group.id}` }, group.name ?? group.id ?? ''),
    )
    for (const model of models) {
      const efforts = effortsOf(model)
      rows.push(
        h(
          'button',
          {
            type: 'button',
            key: `model-${group.id}-${model.id}`,
            className: 'rheostat-option',
            'data-current': model.id === currentModelId ? 'true' : 'false',
            onClick: (event) => {
              event.stopPropagation()
              setOpen(false)
              onPick(model)
            },
          },
          h('span', { className: 'rheostat-model-name' }, modelNameOf(model)),
          h(
            'span',
            { className: 'rheostat-option-effort' },
            model.reasoning?.defaultEffort ?? (efforts.length > 0 ? efforts[0]?.id : ''),
          ),
        ),
      )
    }
  }

  /* The label must survive an empty directory: while the catalog is still
   * loading (or when this session exposes none) the current selection is known
   * from the session itself, and a blank button would read as "no model". */
  const label =
    modelNameOf(view.model) !== ''
      ? modelNameOf(view.model)
      : typeof props.currentModel === 'string' && props.currentModel !== ''
        ? props.currentModel
        : '模型'

  return h(
    'span',
    { className: 'rheostat', ref: rootRef },
    h(
      'button',
      {
        type: 'button',
        className: 'rheostat-model',
        'aria-haspopup': 'listbox',
        'aria-expanded': open ? 'true' : 'false',
        disabled,
        onClick: toggle,
        title: label,
      },
      h('span', { className: 'rheostat-model-name' }, label),
      h('span', { 'aria-hidden': 'true' }, open ? '▴' : '▾'),
    ),
    open
      ? h(
          'div',
          { className: 'rheostat-menu', role: 'listbox' },
          rows.length > 0 ? rows : h('div', { className: 'rheostat-empty' }, '模型目录尚未加载'),
        )
      : null,
  )
}

/* ------------------------------------------------------------------ *
 * the rheostat
 * ------------------------------------------------------------------ */

const DEFAULT_SKIN = { skin: true }

function RheostatControl(props) {
  const React = require('react')
  const { useCallback, useEffect, useMemo, useRef, useState } = React
  const h = React.createElement

  /**
   * Late directory adoption.
   *
   * A brand-new session has no binding yet, and the official resolver *throws*
   * for such a session (`resolved no binding`) rather than returning an empty
   * directory — so the answer flips from "impossible" to "ready" the moment the
   * session is established. The face cannot await that, so the control re-asks
   * here until a store appears, then renders.
   */
  const resolveDirectory = props.resolveDirectory
  const [directory, setDirectory] = useState(props.directory ?? null)

  useEffect(() => {
    if (directory !== null || typeof resolveDirectory !== 'function') return undefined
    let cancelled = false
    const attempt = () => {
      if (cancelled) return
      let next = null
      try {
        next = resolveDirectory() ?? null
      } catch {
        next = null
      }
      if (next !== null) {
        setDirectory(next)
        return
      }
      timer = setTimeout(attempt, RETRY_MS)
    }
    let timer = setTimeout(attempt, RETRY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [directory, resolveDirectory])

  const state = useSnapshot(React, directory)
  const view = useMemo(() => resolve(state), [state])
  const { efforts, selectedIndex } = view
  const usable = efforts.length > 1
  const locked = props.locked === true

  // `useRheostatSkin` is the shell's selector hook over the settings store; when
  // the composition provides no form store the inject face carries none and the
  // skin stays on, which is the documented fallback.
  const preference =
    typeof props.useRheostatSkin === 'function'
      ? props.useRheostatSkin((value) => value) ?? DEFAULT_SKIN
      : DEFAULT_SKIN
  const skinOn = preference.skin !== false

  const committedIndex = selectedIndex >= 0 ? selectedIndex : efforts.length > 0 ? 0 : -1
  const committedLevel = levelForIndex(committedIndex, efforts.length)

  const [draftLevel, setDraftLevel] = useState(null)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState(null)
  const draggingRef = useRef(false)
  // The commit target lives in a ref: the pointer-up handler must read the level
  // the last pointer-move produced, not the one captured when it was created.
  const draftRef = useRef(null)
  const settleTimer = useRef(null)
  const railRef = useRef(null)

  const preview = useCallback((next) => {
    draftRef.current = next
    setDraftLevel(next)
  }, [])

  const submit = useCallback(
    (selection) => {
      if (typeof props.select !== 'function') return
      setPending(true)
      setFailure(null)
      Promise.resolve(props.select(selection))
        .then((result) => {
          // RemoteResult<void>; undefined means this Session cannot select.
          if (result === undefined || result?.ok === false) setFailure('rejected')
        })
        .catch(() => setFailure('failed'))
        .finally(() => setPending(false))
    },
    [props],
  )

  const commitLevel = useCallback(
    (level) => {
      if (!usable || locked || view.current === null || view.model === null) return
      const index = nearestEffortIndex(level, efforts.length)
      if (index === committedIndex) return
      const effort = efforts[index]
      if (effort === undefined) return
      submit(selectionFor(view.current, view.model, effort.id))
    },
    [committedIndex, efforts, locked, submit, usable, view],
  )

  const pickModel = useCallback(
    (model) => {
      if (locked || view.current === null) return
      const effortId = effortForModel(model, undefined, view.current.reasoningEffort)
      const selection = { provider: view.current.provider, model: model.id }
      if (effortId !== undefined) selection.reasoningEffort = effortId
      submit(selection)
    },
    [locked, submit, view],
  )

  /* Load once, then retry slowly while the directory is still empty. */
  useEffect(() => {
    if (typeof props.load !== 'function') return undefined
    props.load()
    const timer = setInterval(() => {
      if (view.offered === 0) props.load()
    }, 5000)
    return () => clearInterval(timer)
  }, [props, view.offered])

  useEffect(
    () => () => {
      if (settleTimer.current !== null) clearTimeout(settleTimer.current)
    },
    [],
  )

  /* Preload every frame once, so neither the backdrop nor a drag ever paints an
   * empty portrait mid-gesture. */
  useEffect(() => {
    for (const anchor of ANCHOR_LEVELS) {
      const image = new Image()
      image.decoding = 'async'
      image.src = `${ASSET_BASE}${frameName(anchor)}`
    }
  }, [])

  const level = draftLevel === null ? committedLevel : draftLevel

  /* The backdrop follows the preview, not the committed value, and fades out
   * entirely once the skin is switched off. */
  useEffect(() => {
    setBackdropVars(level, skinOn)
    if (typeof props.setBackdropVisible === 'function') props.setBackdropVisible(skinOn)
    return () => {
      if (typeof props.setBackdropVisible === 'function') props.setBackdropVisible(false)
    }
  }, [level, props, skinOn])

  /* The character in the backdrop tracks the same preview level as the readout. */
  useEffect(() => {
    if (typeof props.setBackdropLevel === 'function') props.setBackdropLevel(level)
  }, [level, props])

  const levelFromClientX = useCallback(
    (clientX, fallbackNode) => {
      // The rail is the scale when its ref is attached; the control itself is a
      // wider element, so it is only a last-resort measure of the same gesture.
      const rail = railRef.current ?? fallbackNode ?? null
      if (rail === null || typeof rail.getBoundingClientRect !== 'function') return level
      const rect = rail.getBoundingClientRect()
      if (!(rect.width > 0)) return level
      const ratio = (clientX - rect.left) / rect.width
      return Math.round(Math.min(1, Math.max(0, ratio)) * MAX_LEVEL)
    },
    [level],
  )

  const interactive = usable && !locked

  const onPointerDown = useCallback(
    (event) => {
      if (!interactive || event.button !== 0) return
      event.currentTarget.setPointerCapture?.(event.pointerId)
      draggingRef.current = true
      preview(levelFromClientX(event.clientX, event.currentTarget))
    },
    [interactive, levelFromClientX, preview],
  )

  const onPointerMove = useCallback(
    (event) => {
      if (!draggingRef.current) return
      preview(levelFromClientX(event.clientX, railRef.current))
    },
    [levelFromClientX, preview],
  )

  const settle = useCallback(() => {
    const target = draftRef.current
    draggingRef.current = false
    draftRef.current = null
    setDraftLevel(null)
    if (target !== null) commitLevel(target)
  }, [commitLevel])

  const onPointerUp = useCallback(
    (event) => {
      if (!draggingRef.current) return
      event.currentTarget.releasePointerCapture?.(event.pointerId)
      settle()
    },
    [settle],
  )

  const scheduleKeyboardCommit = useCallback(
    (next) => {
      preview(next)
      if (settleTimer.current !== null) clearTimeout(settleTimer.current)
      settleTimer.current = setTimeout(() => {
        settleTimer.current = null
        const target = draftRef.current
        draftRef.current = null
        setDraftLevel(null)
        if (target !== null) commitLevel(target)
      }, SETTLE_MS)
    },
    [commitLevel, preview],
  )

  const onKeyDown = useCallback(
    (event) => {
      if (!interactive) return
      const step = event.shiftKey ? 5 : 1
      let next = null
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = Math.min(MAX_LEVEL, level + step)
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = Math.max(MIN_LEVEL, level - step)
      else if (event.key === 'Home') next = MIN_LEVEL
      else if (event.key === 'End') next = MAX_LEVEL
      else if (event.key === 'PageUp') next = Math.min(MAX_LEVEL, level + 5)
      else if (event.key === 'PageDown') next = Math.max(MIN_LEVEL, level - 5)
      else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        commitLevel(level)
        return
      }
      if (next === null) return
      event.preventDefault()
      scheduleKeyboardCommit(next)
    },
    [commitLevel, interactive, level, scheduleKeyboardCommit],
  )

  const onWheel = useCallback(
    (event) => {
      if (!interactive) return
      event.preventDefault()
      scheduleKeyboardCommit(Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, level + (event.deltaY > 0 ? -1 : 1))))
    },
    [interactive, level, scheduleKeyboardCommit],
  )

  /* React attaches wheel handlers passively; the rail must be able to stop the
   * page from scrolling while the level changes. */
  useEffect(() => {
    const rail = railRef.current
    if (rail === null || typeof rail.addEventListener !== 'function') return undefined
    rail.addEventListener('wheel', onWheel, { passive: false })
    return () => rail.removeEventListener('wheel', onWheel)
  }, [onWheel])

  const chooser = h(ModelChooser, { key: 'chooser', view, disabled: locked, onPick: pickModel })

  /* Diagnostic probe for the branch that decides what is drawn: activation can be
   * fully healthy and the composer still show nothing. */
  console.info(
    `[${PACKAGE_ID}] render decision`,
    JSON.stringify({
      hasDirectory: directory !== null,
      directorySource: props.directory !== undefined && props.directory !== null ? 'face' : 'adopted',
      skinOn,
      status: state?.status ?? null,
      offered: view.offered,
      efforts: efforts.length,
      usable,
    }),
  )

  /* What is drawn depends only on the data:
   *
   *   1. no directory yet  -> nothing to draw, and nothing to break: this control
   *      rides beside the native model selector, never in place of it. A new
   *      session legitimately has no directory until its binding exists, and the
   *      adoption effect above renders the instrument once it does.
   *   2. skin off or no reasoning axis -> no instrument, and the chooser steps
   *      aside too, because the native selector is still there to use.
   *   3. otherwise -> the instrument.
   */
  if (directory === null) return null

  if (!skinOn || !usable) return null

  const effort = efforts[draftLevel === null ? committedIndex : nearestEffortIndex(level, efforts.length)]
  const caption = indicatorText(level, effort)

  /* The knob is machinery: a machined cap whose lever turns with the level. The
   * character lives in the backdrop, so no frame is painted here. */
  const knob = h('span', {
    className: 'rheostat-knob',
    style: { '--rheostat-turn': `${knobTurn(level)}deg` },
  })

  const rail = h(
    'span',
    { className: 'rheostat-rail', ref: railRef },
    h('span', { className: 'rheostat-fill', style: { width: `${(level / MAX_LEVEL) * 100}%` } }),
  )

  return h(
    'span',
    { className: 'rheostat', 'data-available': 'true' },
    chooser,
    h(
      'button',
      {
        type: 'button',
        className: 'rheostat-control',
        'data-dragging': draftLevel !== null ? 'true' : 'false',
        'data-pending': pending ? 'true' : 'false',
        'data-disabled': interactive ? 'false' : 'true',
        role: 'slider',
        tabIndex: 0,
        'aria-orientation': 'horizontal',
        'aria-label': '推理档位',
        'aria-valuemin': MIN_LEVEL,
        'aria-valuemax': MAX_LEVEL,
        'aria-valuenow': level,
        'aria-valuetext': caption,
        title: failure === null ? caption : `${caption} (${failure})`,
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onPointerCancel: onPointerUp,
        onKeyDown,
        onContextMenu: (event) => event.preventDefault(),
      },
      knob,
      rail,
      h('span', { className: 'rheostat-readout' }, caption),
    ),
  )
}

/* ------------------------------------------------------------------ *
 * plugin entry
 * ------------------------------------------------------------------ */

/**
 * Service declaration: the bundle row (`package.json` → `dsh.client.inject`), not
 * `exports.inject`.
 *
 * A *client* plugin entry is not the place to name services — the shipped
 * packages ship `exports.inject = []` for the client half and let the boot-graph
 * row gate arrival. Declaring names here as well would make the entry wait a
 * second time for services the row already waits for.
 *
 * What is *not* optional: reading `ctx.<name>` for a service no row declared
 * **throws** —
 *
 *     Error: cannot get property "slots" without inject
 *
 * — so the seat's services are awaited with `ctx.inject(names, cb)` and read off
 * the scope object that callback receives, exactly as `ui-model-selection` does.
 *
 * Side effects (stylesheet, backdrop, the `data-rheostat-effort` marker on
 * `<html>`) are deliberately installed *before* that await, so a composition
 * missing one of those services still leaves visible evidence of activation.
 */
exports.inject = []

/**
 * Plugin configuration.
 *
 * Cordis hands `apply(ctx, config)` the row's `config:` block, so the profile's
 * patch layer can move the character, zoom it, or recolour the base layer
 * without editing this file:
 *
 *     - id: rheostat-effort
 *       name: 'dsh-rheostat-effort'
 *       config:
 *         backdropFocusX: 1
 *         backdropZoom: 1.15
 *         backdropColor: 'rgb(20 20 24)'
 */
exports.apply = function apply(ctx, config) {
  // A thrown error here would otherwise be only a console line among many.
  try {
    return activate(ctx, config)
  } catch (error) {
    console.error(`[${PACKAGE_ID}] activation failed`, error)
    return { id: PACKAGE_ID, failed: true }
  }
}

function activate(ctx, config) {
  const style = document.createElement('style')
  style.dataset.plugin = PACKAGE_ID
  style.textContent = CSS
  document.head.append(style)

  // Framing comes from the plugin's own config block, passed to apply().
  applyBackdropConfig(config)

  const backdrop = createBackdrop()
  setBackdropVars(VIEWPORT_PREVIEW_LEVEL, false)
  paintPortrait(backdrop, VIEWPORT_PREVIEW_LEVEL)
  console.info(`[${PACKAGE_ID}] activated`)

  const setBackdropVisible = (visible) => {
    backdrop.element.style.display = visible ? '' : 'none'
  }

  const setBackdropLevel = (level) => {
    paintPortrait(backdrop, level)
  }

  ctx.effect(() => () => {
    style.remove()
    backdrop.element.remove()
    const root = document.documentElement
    root.removeAttribute(ROOT_ATTR)
    for (const property of [
      '--rheostat-hue',
      '--rheostat-alpha',
      '--rheostat-glow',
      '--rheostat-focus-x',
      '--rheostat-focus-y',
      '--rheostat-zoom',
      '--rheostat-frame-opacity',
      '--rheostat-frame-backdrop',
    ]) {
      root.style.removeProperty(property)
    }
  }, `${PACKAGE_ID}: scoped styles and backdrop`)

  if (typeof ctx.inject !== 'function') {
    console.warn(`[${PACKAGE_ID}] this context has no inject(); the seat stays unregistered`)
    return { id: PACKAGE_ID, seat: false }
  }

  // Services are awaited in two independent groups so that one missing name can
  // never hold the other group hostage. Every name that is *used* must be awaited:
  // reading `ctx.<name>` for an unawaited service throws at the point of use, and
  // inside a seat face that kills the whole entry.
  //
  // Group 1 — the composer control.
  ctx.inject(['slots', 'sessions', 'modelDirectories'], (scope) => {
    console.info(`[${PACKAGE_ID}] composer services ready; registering the control`)
    // The awaited context, not `ctx`: only this callback declared these services.
    const slots = scope.slots
    const sessions = scope.sessions
    const modelDirectories = scope.modelDirectories
    // Built empty here, then rebound by group 2 if the settings service arrives;
    // `createSettings(undefined)` degrades to "no preference document", which the
    // row already reports as read-only.
    let settings = createSettings(undefined)

    /**
     * The rider face.
     *
     * It never returns `null`: a seat face that resolves to null crashes the
     * renderer (`Cannot read properties of null (reading 'hooks')`), so "no
     * directory yet" has to travel as data — and it is a *normal* state, not an
     * error, because a brand-new session has no binding and the official resolver
     * throws for it.
     *
     * `resolveDirectory` lets the control keep asking after mount: the answer
     * flips from "impossible" to "ready" as soon as the session is established.
     */
    const riderFace = (sessionId) => {
      const available = sessions.subagentAddress(sessionId) === undefined
      const resolveDirectory = () => {
        if (!available) return null
        try {
          const directory = modelDirectories.directoryFor(sessionId) ?? null
          if (directory === null || directory.store === null || directory.store === undefined) return null
          void Promise.resolve(directory.load()).catch(() => undefined)
          return directory.store
        } catch {
          // "resolved no binding" is the expected answer while a session is new.
          return null
        }
      }
      const directory = resolveDirectory()
      let skin
      try {
        skin = settings.store()
      } catch {
        skin = undefined
      }
      return {
        available,
        directory,
        resolveDirectory,
        select: (selection) => {
          if (!available) return Promise.resolve(undefined)
          try {
            const directoryObject = modelDirectories.directoryFor(sessionId)
            return directoryObject.select(selection)
          } catch {
            return Promise.resolve(undefined)
          }
        },
        skin,
        setBackdropVisible,
        setBackdropLevel,
      }
    }

    // A rider on the composer's right rail: it competes with no other plugin, so
    // it is the one composer surface that is always safe to occupy. The model seat
    // is deliberately NOT taken — declining it is impossible (a null face crashes
    // the renderer) and taking it while a new session has no directory would
    // suppress the native selector and put nothing in its place.
    slots.inject('conversation.input.right', () =>
      slots.register(
        { name: 'conversation.input.right', id: 'rheostat-effort-rider', order: 20, inject: riderFace },
        RheostatControl,
      ),
    )

    // Group 2 — the appearance switch. Optional: if the settings service never
    // arrives the controls above still work, only the row is absent.
    ctx.inject(['slots', 'configForms'], (settingsScope) => {
      console.info(`[${PACKAGE_ID}] settings service ready; adding the appearance row`)
      settings = createSettings(settingsScope.configForms)
      settingsScope.slots.inject('settings.general.item', () =>
        settingsScope.slots.register(
          {
            name: 'settings.general.item',
            id: 'rheostat-effort-appearance',
            order: 40,
            inject: () => ({
              hooks: { rheostatSkin: settings.store() },
              bound: settings.bound(),
              enabled: settings.enabled(),
              setRheostatSkin: (value) => settings.set(value),
            }),
          },
          SettingsRow,
        ),
      )
    })
  })

  return { id: PACKAGE_ID }
}
