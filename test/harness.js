'use strict'

/**
 * Shared test harness.
 *
 * React and the DOM are stood in for just enough to load the client bundle and
 * drive its registered component outside a browser. Two React behaviours the
 * component depends on are reproduced faithfully, because getting them wrong
 * makes the tests lie:
 *
 *   - hook storage is keyed by the component's position in the tree, so a
 *     re-render of the same position sees the previous useState/useRef;
 *   - each component owns its hook list, so a nested component can never consume
 *     its parent's slots.
 *
 * NOTE: this file is deliberately ASCII-only. A PowerShell round-trip once
 * re-encoded it and silently corrupted multibyte characters; keeping the harness
 * plain ASCII means a future edit cannot break it that way.
 */

const assert = require('node:assert/strict')
const Module = require('node:module')
const { join } = require('node:path')

/* ---------------------------- React stand-in ---------------------------- */

const stores = new Map()
let scope = 's0'
let scopeCounter = 0
let activePath = ''
let cursor = 0
const effectCleanups = []

/** A new scope per mounted component instance. */
function beginScope() {
  scopeCounter += 1
  scope = `s${scopeCounter}`
  return scope
}

function takeCell() {
  const key = `${scope}${activePath}`
  let store = stores.get(key)
  if (store === undefined) {
    store = {}
    stores.set(key, store)
  }
  const index = cursor++
  if (store[index] === undefined) store[index] = {}
  return store[index]
}

/** Introspection: which render positions own hook stores, and how many. */
function storeSummary() {
  return [...stores.entries()].map(([key, store]) => `${key}:${Object.keys(store).length}`).join(' ')
}

const React = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat() }
  },
  useSyncExternalStore(subscribe, getSnapshot) {
    subscribe(() => {})
    return getSnapshot()
  },
  useState(initial) {
    const slot = takeCell()
    if (!('value' in slot)) slot.value = typeof initial === 'function' ? initial() : initial
    return [
      slot.value,
      (next) => {
        slot.value = typeof next === 'function' ? next(slot.value) : next
      },
    ]
  },
  useRef(initial) {
    const slot = takeCell()
    if (!('value' in slot)) slot.value = { current: initial }
    return slot.value
  },
  useMemo(factory) {
    takeCell()
    return factory()
  },
  useCallback(fn) {
    takeCell()
    return fn
  },
  useEffect(fn) {
    takeCell()
    const cleanup = fn()
    if (typeof cleanup === 'function') effectCleanups.push(cleanup)
    return cleanup
  },
}

/* ----------------------------- DOM stand-in ----------------------------- */

const RAIL_WIDTH = 124

function makeElement(tag) {
  return {
    tagName: tag,
    className: '',
    dataset: {},
    // Attribute writes land on `style` for CSS custom properties too, so both
    // spellings of "set a variable" work against this stand-in.
    style: {
      setProperty(name, value) { this[name] = String(value) },
      removeProperty(name) { delete this[name] },
    },
    attributes: {},
    children: [],
    textContent: '',
    setAttribute(name, value) { this.attributes[name] = String(value) },
    getAttribute(name) { return name in this.attributes ? this.attributes[name] : null },
    removeAttribute(name) { delete this.attributes[name] },
    hasAttribute(name) { return name in this.attributes },
    append(...nodes) { this.children.push(...nodes) },
    appendChild(node) { this.children.push(node); return node },
    remove() {},
    contains() { return false },
    setPointerCapture() {},
    releasePointerCapture() {},
    getBoundingClientRect() { return { left: 0, width: RAIL_WIDTH } },
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll() { return [] },
  }
}

const documentListeners = []

globalThis.document = {
  documentElement: makeElement('html'),
  body: makeElement('body'),
  head: makeElement('head'),
  createElement: makeElement,
  addEventListener(type, listener) { documentListeners.push({ type, listener }) },
  removeEventListener(type, listener) {
    const index = documentListeners.findIndex((entry) => entry.type === type && entry.listener === listener)
    if (index >= 0) documentListeners.splice(index, 1)
  },
  querySelectorAll() { return [] },
}
globalThis.window = { addEventListener() {}, removeEventListener() {} }
globalThis.Image = class {
  constructor() { this.decoding = ''; this.src = '' }
}

/** Fire every listener the component attached for `type` at document level. */
function emitDocument(type, event = {}) {
  for (const entry of [...documentListeners]) {
    if (entry.type === type) entry.listener(event)
  }
}

/* ------------------------------- timers --------------------------------- */

/**
 * Timers are queued, not fired, so a test decides when time passes. Both of the
 * component's timers exist for real reasons -- polling while a session has no
 * model directory, and the commit settle delay -- and either would otherwise
 * keep the event loop alive and hang the test process.
 */
const timerQueue = []
const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
const realSetInterval = globalThis.setInterval
const realClearInterval = globalThis.clearInterval

globalThis.setTimeout = (fn) => {
  timerQueue.push(fn)
  return timerQueue.length
}
globalThis.clearTimeout = () => {}
globalThis.setInterval = () => 0
globalThis.clearInterval = () => {}

/** Fire everything currently queued, as the event loop eventually would. */
function runTimers() {
  const queued = timerQueue.splice(0, timerQueue.length)
  for (const fn of queued) fn()
  return queued.length
}

/** The real timer, for tests that genuinely need to wait on the host. */
function realDelay(ms) {
  return new Promise((resolve) => realSetTimeout(resolve, ms))
}

process.on('exit', () => {
  globalThis.setTimeout = realSetTimeout
  globalThis.clearTimeout = realClearTimeout
  globalThis.setInterval = realSetInterval
  globalThis.clearInterval = realClearInterval
})

/* ------------------------- module table plumbing ------------------------ */

const originalLoad = Module._load
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'react') return React
  return originalLoad.call(this, request, parent, isMain)
}
// The patch stays installed: the component calls require('react') as it renders.
process.on('exit', () => { Module._load = originalLoad })

/**
 * The browser's module loader, stood in for. A bundle registers itself with
 * `window.__ModuleLoader__.load({ id, factory })`; materializing it means calling
 * the factory with the loader's own `require`, exactly as the real loader does.
 * A bundle that never registers is a real failure: in the browser it surfaces as
 * `require is not defined` and takes the whole web boot down, not just the plugin.
 */
const registered = new Map()
globalThis.window.__ModuleLoader__ = {
  load(definition) {
    if (registered.has(definition.id)) {
      throw new Error(`duplicate factory registration for "${definition.id}"`)
    }
    registered.set(definition.id, definition)
  },
}

const CLIENT_BUNDLE = join(__dirname, '..', 'lib', 'client.js')
const PACKAGE_ID = 'dsh-rheostat-effort'

function materializeClient() {
  delete require.cache[require.resolve(CLIENT_BUNDLE)]
  registered.clear()
  require(CLIENT_BUNDLE)

  const definition = registered.get(PACKAGE_ID)
  if (definition === undefined) {
    throw new Error(
      `the bundle did not register "${PACKAGE_ID}" with window.__ModuleLoader__.load -- ` +
        'in the browser a bare module throws "require is not defined" and fails the web boot',
    )
  }
  const exportsObject = definition.factory((spec) => {
    if (spec === 'react') return React
    throw new Error(`require("${spec}") missed the module table`)
  })
  if (exportsObject === null || typeof exportsObject?.apply !== 'function') {
    throw new Error('the factory must return module.exports, carrying apply()')
  }
  return { definition, client: exportsObject }
}

const client = materializeClient().client

/** Re-load the shipped bundle from disk, for tests about the artifact itself. */
function reloadClient() {
  return materializeClient()
}

/* ------------------------------- renderer ------------------------------- */

function attrsOf(props) {
  return Object.entries(props ?? {})
    .filter(([key]) => !key.startsWith('on') && key !== 'ref' && key !== 'children')
    .map(([key, value]) => {
      if (key === 'style' && value !== null && typeof value === 'object') {
        const css = Object.entries(value)
          .map(([property, setting]) => `${property}:${String(setting)}`)
          .join(';')
        return ` style="${css}"`
      }
      return value === true ? ` ${key}` : ` ${key}="${String(value)}"`
    })
    .join('')
}

/** Serialize an element tree, calling nested components with their own hooks. */
function serialize(node, injected, evaluated) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map((child) => serialize(child, injected, evaluated)).join('')

  const { type, props, children } = node
  if (typeof type === 'function') {
    const savedPath = activePath
    const savedCursor = cursor
    activePath = `${activePath}.${type.name || 'child'}$`
    cursor = 0
    try {
      const output = type({ ...props, ...injected })
      if (evaluated !== undefined) evaluated.set(type, output)
      return serialize(output, injected, evaluated)
    } finally {
      activePath = savedPath
      cursor = savedCursor
    }
  }
  if (typeof type !== 'string') return ''

  // Attach refs the way a real renderer does: an element with a ref must expose
  // itself through ref.current, or a component that measures that node silently
  // loses the ability to do so.
  const ref = props?.ref
  if (ref !== null && typeof ref === 'object' && 'current' in ref) {
    const element = makeElement(type)
    element.props = props
    ref.current = element
  }

  return `<${type}${attrsOf(props)}>${serialize(children ?? [], injected, evaluated)}</${type}>`
}

/** Depth-first search over an element tree a component returned. */
function find(node, predicate, found = []) {
  if (node === null || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    for (const child of node) find(child, predicate, found)
    return found
  }
  if (predicate(node)) found.push(node)
  for (const child of node.children ?? []) find(child, predicate, found)
  return found
}

/* ------------------------------- fixtures ------------------------------- */

/** A directory state with one model carrying `efforts`, as the adapter publishes it. */
function stateWith(efforts, currentEffort, extra = {}) {
  return {
    current: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: currentEffort },
    groups: [
      {
        id: 'deepseek-official',
        name: 'DeepSeek',
        models: [
          {
            id: 'deepseek-flash',
            name: 'DeepSeek Flash',
            reasoning: {
              efforts: efforts.map((id) => ({ id })),
              defaultEffort: efforts[1] ?? efforts[0],
            },
          },
        ],
      },
    ],
    status: 'ready',
    error: null,
    ...extra,
  }
}

/**
 * Mount the plugin against a fixture.
 *
 * The plugin occupies exactly one composer surface -- the rider on the right rail.
 * It deliberately never takes conversation.input.model, so the harness asserts
 * that the model seat stays untouched: a regression there once left the composer
 * with no way to switch models at all.
 */
function mount(state, options = {}) {
  beginScope()
  let seatRegistration = null
  let riderRegistration = null
  let settingsRegistration = null
  const seats = []
  const selections = []
  const cleanups = []
  const form = {
    value: { ...(options.skin === undefined ? {} : { skin: options.skin }) },
    writable: options.writable !== false,
    writes: [],
    getSnapshot() {
      return { status: 'ready', value: { ...this.value }, writable: this.writable, mode: 'user' }
    },
    subscribe() { return () => {} },
    set(field, value) {
      this.writes.push([field, value])
      if (options.rejectWrite === true) return Promise.reject(new Error('nope'))
      this.value[field] = value
      return Promise.resolve(true)
    },
  }
  const services = {
    sessions: { subagentAddress: () => undefined },
    configForms: options.noSettings === true ? null : { get: () => form },
    modelDirectories: {
      directoryFor: () => ({
        store: { getSnapshot: () => state, subscribe: () => () => {} },
        load: async () => undefined,
        select: async (selection) => { selections.push(selection); return { ok: true } },
      }),
    },
    slots: {
      inject(seat, installer) {
        seats.push(seat)
        installer()
      },
      register(spec, component) {
        if (spec.name === 'settings.general.item') settingsRegistration = { ...spec, component }
        else if (spec.name === 'conversation.input.right') riderRegistration = { ...spec, component }
        else seatRegistration = { ...spec, component }
      },
    },
  }
  const ctx = {
    effect(fn) {
      const cleanup = fn()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
      return () => {}
    },
    /**
     * Cordis service awaiting: the callback receives ONE scope context whose
     * awaited services are readable properties. Nothing is read off ctx itself --
     * in the real runtime reading an undeclared service throws.
     */
    inject(names, callback) {
      for (const name of names) {
        if (!(name in services)) throw new Error(`test harness has no service "${name}"`)
      }
      callback(services)
    },
  }
  const result = client.apply(ctx)
  assert.equal(seatRegistration, null, 'the model seat must not be taken')
  assert.ok(riderRegistration !== null, 'apply() must register the rider')
  const registration = riderRegistration
  const injected = registration.inject('session-1')
  assert.notEqual(injected, null, 'the rider face must never be null')
  injected.useRheostatSkin = (selector) => selector({ skin: options.skin === undefined ? true : options.skin })

  const renderWith = (component, props, path) => {
    const savedPath = activePath
    const savedCursor = cursor
    activePath = `${scope}${path}$`
    cursor = 0
    try {
      const built = component(props)
      const evaluated = new Map()
      const html = serialize(built, {}, evaluated)
      evaluated.set(component, built)
      return { built, html, evaluated }
    } finally {
      activePath = savedPath
      cursor = savedCursor
    }
  }

  const view = (props = {}) => renderWith(registration.component, { ...injected, ...props }, 'root')
  const walk = (props = {}) => view(props).evaluated
  const flat = (props = {}) => [...view(props).evaluated.values()]

  return {
    result,
    seats,
    registration,
    rider: riderRegistration,
    settings: settingsRegistration,
    form,
    injected,
    selections,
    cleanups,
    view,
    riderView: view,
    walk,
    flat,
    tree: (props = {}) => view(props).built,
    html: (props = {}) => {
      effectCleanups.length = 0
      return view(props).html
    },
    riderHtml: (props = {}) => {
      effectCleanups.length = 0
      return view(props).html
    },
    /** Render just the settings row, with the face its registration injects. */
    settingsView: () => {
      assert.ok(settingsRegistration !== null, 'apply() must register the settings row')
      const face = settingsRegistration.inject()
      const props = {
        ...face,
        useRheostatSkin: (selector) => selector(form.getSnapshot()),
      }
      const built = settingsRegistration.component(props)
      const evaluated = new Map()
      const html = serialize(built, {}, evaluated)
      evaluated.set(settingsRegistration.component, built)
      return { built, html, evaluated, face, props }
    },
  }
}

module.exports = {
  client,
  reloadClient,
  React,
  find,
  mount,
  stateWith,
  effectCleanups,
  emitDocument,
  makeElement,
  serialize,
  storeSummary,
  runTimers,
  realDelay,
  RAIL_WIDTH,
}
