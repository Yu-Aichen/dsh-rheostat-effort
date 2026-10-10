'use strict'

/**
 * Render smoke test for the client half.
 *
 * Drives `apply()`, the slot registration and the component end to end against
 * the stubs in `harness.js`. It catches what a syntax check cannot: a bad hook
 * order, a missing prop, a lost return value, an unguarded session, or a commit
 * that submits the wrong selection.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const { join } = require('node:path')

const { client, find, makeElement, mount, realDelay, reloadClient, runTimers, stateWith } = require('./harness.js')

/* Regression guard for the shipped artifact.
 *
 * This plugin once shipped a bare IIFE whose body called `require(...)`. `require`
 * only exists as the loader factory's argument, so the browser threw
 * `ReferenceError: require is not defined` at import time 鈥?and the damage was not
 * limited to this plugin: the web boot reported "1 entry did not activate" and the
 * GUI could not be opened at all. The harness now materializes the bundle through
 * a loader stand-in, so every test below fails if the wrapper goes missing again;
 * these three keep that failure legible and specific. */
test('the shipped bundle is registered in module-table form and materializes', () => {
  const { definition, client: reloaded } = reloadClient()
  assert.equal(definition.id, 'dsh-rheostat-effort')
  assert.equal(typeof definition.factory, 'function')
  assert.deepEqual(
    reloaded.inject,
    [],
    'nothing may be gated: a service name that never arrives parks activation forever, silently',
  )
  assert.equal(typeof reloaded.apply, 'function')
})

test('the bundle requires nothing except platform seeds', () => {
  const source = readFileSync(join(__dirname, '..', 'lib', 'client.js'), 'utf8')
  const requests = [...source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1])
  assert.ok(requests.length > 0, 'the component must require react')
  for (const spec of requests) {
    assert.equal(spec, 'react', `the browser cannot resolve require("${spec}")`)
  }
  assert.ok(
    !/require\(\s*['"]\.\//.test(source),
    'a relative require cannot resolve in the browser 鈥?inline the module instead',
  )
  assert.match(source, /window\.__ModuleLoader__\.load\(/, 'the loader wrapper must be present')
  assert.match(source, /return module\.exports/, 'the factory must return module.exports')
})

test('the committed bundle matches its sources', () => {
  const result = spawnSync(
    process.execPath,
    [join(__dirname, '..', 'scripts', 'build-client.mjs'), '--check'],
    { encoding: 'utf8' },
  )
  assert.equal(
    result.status,
    0,
    `lib/client.js is stale 鈥?run: node scripts/build-client.mjs\n${result.stdout}${result.stderr}`,
  )
})

/* Activation guard.
 *
 * Cordis delivers services by awaiting them: `ctx.inject(names, cb)` calls back
 * with a scope context once every name is available, and reading `ctx.<name>` for
 * a service nobody awaited **throws** 鈥?inside a seat face that kills the whole
 * entry. Services are therefore awaited in two independent groups, so a missing
 * settings service can never hold the composer seat hostage. */
test('activation installs its side effects before any service is awaited', () => {
  let effects = 0
  const groups = []
  const registrations = []
  const ctx = {
    effect(fn) {
      effects += 1
      const cleanup = fn()
      return typeof cleanup === 'function' ? cleanup : () => {}
    },
    inject(names, callback) {
      groups.push(names)
      const slots = {
        inject: (seat, installer) => installer(),
        register: (spec) => registrations.push(spec.name),
      }
      if (names.includes('sessions')) {
        callback({
          slots,
          sessions: { subagentAddress: () => undefined },
          modelDirectories: { directoryFor: () => null },
        })
      } else {
        callback({ slots, configForms: { get: () => null } })
      }
    },
    // DELIBERATELY ABSENT: a `configForms` property on ctx. Reading one here is a
    // violation 鈥?the real runtime throws `cannot get property 鈥?without inject`,
    // and inside a seat face that kills the whole entry.
  }
  const result = client.apply(ctx)
  assert.equal(result.id, 'dsh-rheostat-effort')
  assert.equal(result.failed, undefined, 'activation must not fall into its error path')
  assert.ok(effects > 0, 'the stylesheet and backdrop effects must run without waiting for services')
  assert.deepEqual(groups, [
    ['slots', 'sessions', 'modelDirectories'],
    ['slots', 'configForms'],
  ])
  assert.deepEqual(registrations, ['conversation.input.right', 'settings.general.item'])
})

test('the control still activates when the settings service never arrives', () => {
  const registrations = []
  let settingsGroupAwaited = false
  const ctx = {
    effect: (fn) => fn(),
    inject(names, callback) {
      if (!names.includes('sessions')) {
        // The settings group is awaited 鈥?and left waiting, as if the service
        // never arrives. It must not block the control registered by the other group.
        settingsGroupAwaited = true
        return
      }
      callback({
        slots: { inject: (seat, installer) => installer(), register: (spec) => registrations.push(spec.name) },
        sessions: { subagentAddress: () => undefined },
        modelDirectories: { directoryFor: () => null },
      })
    },
  }
  const result = client.apply(ctx)
  assert.equal(result.failed, undefined)
  assert.deepEqual(
    registrations,
    ['conversation.input.right'],
    'the composer control must register without configForms',
  )
  assert.equal(settingsGroupAwaited, true, 'the settings group is awaited separately from the control')
})

test('a context without inject() degrades instead of throwing', () => {
  const result = client.apply({ effect: (fn) => fn() })
  assert.equal(result.id, 'dsh-rheostat-effort')
  assert.equal(result.seat, false, 'a composition with no inject() must be reported, not thrown')
  assert.equal(result.failed, undefined)
})

test('nothing is read off ctx except the config form the entry resolves itself', () => {
  const read = []
  const ctx = new Proxy(
    {
      effect: (fn) => fn(),
      inject: () => {},
    },
    {
      get(target, property, receiver) {
        if (typeof property === 'string' && !['effect', 'inject', 'configForms', 'get'].includes(property)) {
          read.push(property)
        }
        return Reflect.get(target, property, receiver)
      },
    },
  )
  assert.doesNotThrow(() => client.apply(ctx))
  assert.deepEqual(read, [], 'reading an undeclared service throws in the real runtime')
})

/* Seat-face contract.
 *
 * A slot's `inject` face is merged into props before the entry renders, so a face
 * that resolves to `null` crashes the renderer with
 * `Cannot read properties of null (reading 'hooks')` and takes the whole entry
 * down. It is also not a way to decline a seat 鈥?the framework does not offer one.
 * The consequences shaped this plugin's architecture:
 *
 *   - it never takes `conversation.input.model`, because declining that seat is
 *     impossible and taking it without a directory suppresses the native selector;
 *   - its one entry (the rider) therefore always returns props, and reports the
 *     missing directory as data.
 *
 * A missing directory is a NORMAL state, not an error: a brand-new session has no
 * binding, and the official resolver throws `resolved no binding` for it. */
function facesFrom(directoryFor = () => null, subagentAddress = () => undefined) {
  const faces = {}
  const ctx = {
    effect: (fn) => fn(),
    inject: (names, callback) =>
      callback({
        slots: {
          inject: (seat, installer) => installer(),
          register: (spec) => { faces[spec.name] = spec.inject },
        },
        sessions: { subagentAddress },
        modelDirectories: { directoryFor },
      }),
  }
  assert.doesNotThrow(() => client.apply(ctx))
  return faces
}

test('the model seat is never taken, because a seat face cannot decline', () => {
  const faces = facesFrom()
  assert.equal(
    faces['conversation.input.model'],
    undefined,
    'taking this seat without a directory would suppress the native model selector',
  )
})

test('the rider face never returns null, and reports a missing directory as data', () => {
  const props = facesFrom()['conversation.input.right']('session-1')
  assert.notEqual(props, null, 'a null face crashes the renderer')
  assert.equal(typeof props, 'object')
  assert.equal(props.available, true)
  assert.equal(props.directory, null, 'no binding yet: a normal state, not an error')
  assert.equal(typeof props.resolveDirectory, 'function', 'the control must be able to re-ask')
})

test('the rider face carries the store once the session has a directory', () => {
  const store = { getSnapshot: () => null, subscribe: () => () => {} }
  const props = facesFrom(() => ({ store, load: async () => undefined, select: async () => ({ ok: true }) }))[
    'conversation.input.right'
  ]('session-1')
  assert.equal(props.directory, store)
})

test('a throwing resolver yields a null directory instead of a crash', () => {
  const props = facesFrom(() => { throw new Error('resolved no binding') })['conversation.input.right']('session-1')
  assert.notEqual(props, null)
  assert.equal(props.directory, null)
  assert.doesNotThrow(() => props.resolveDirectory(), 're-asking must be safe while the session is new')
})

test('an addressed subagent draws nothing and cannot select', async () => {
  const props = facesFrom(() => { throw new Error('must not be reached') }, () => ({ kind: 'subagent' }))[
    'conversation.input.right'
  ]('sub-1')
  assert.equal(props.available, false)
  assert.equal(props.directory, null)
  assert.equal(await props.select({ provider: 'p', model: 'm' }), undefined)
})

test('the rider draws nothing without a directory, and never blocks the composer', () => {
  const m = mount(stateWith(['off', 'high', 'max'], 'high'))
  const out = m.html({ directory: null, resolveDirectory: () => null })
  assert.equal(out, '', 'nothing to draw without a directory')
})

/** Find nodes across every element this render evaluated, nested ones included. */
function findAll(m, predicate, view = m.settingsView()) {
  const found = []
  for (const element of view.evaluated.values()) found.push(...find(element, predicate))
  return found
}

/** A pointer event whose `currentTarget` is a real stand-in element. */
function pointerEvent(clientX) {
  return {
    button: 0,
    pointerId: 1,
    clientX,
    currentTarget: makeElement('button'),
    preventDefault() {},
    stopPropagation() {},
  }
}

test('apply() registers the rider and returns its id without gating any service', () => {
  assert.deepEqual(client.inject, [], 'nothing is gated, so activation can never be parked')
  const m = mount(stateWith(['off', 'high', 'max'], 'high'))
  assert.equal(m.result.id, 'dsh-rheostat-effort')
  assert.equal(m.result.failed, undefined)
  assert.equal(m.registration.name, 'conversation.input.right')
  assert.equal(m.registration.id, 'rheostat-effort-rider')
  assert.ok(m.cleanups.length > 0, 'apply() must register effect cleanups')
})

test('apply() registers the settings row into the general ledger', () => {
  const m = mount(stateWith(['off', 'high'], 'off'))
  assert.deepEqual(m.seats, ['conversation.input.right', 'settings.general.item'])
  assert.equal(m.settings.name, 'settings.general.item')
  assert.equal(m.settings.id, 'rheostat-effort-appearance')
  const face = m.settings.inject()
  assert.equal(typeof face.setRheostatSkin, 'function')
  assert.equal(typeof face.enabled, 'boolean')
  assert.ok('rheostatSkin' in face.hooks, 'the store must ride the hooks face')
})

test('the rider entry carries no priority, because it competes with no one', () => {
  const { registration } = mount(stateWith(['off', 'high'], 'off'))
  assert.equal(registration.name, 'conversation.input.right')
  assert.equal(registration.priority, undefined, 'only a contested single seat needs a priority')
})

test('the injected face carries the directory store, a selector and a resolver', () => {
  const { injected } = mount(stateWith(['off', 'high'], 'off'))
  assert.equal(injected.available, true)
  assert.equal(typeof injected.directory.getSnapshot, 'function')
  assert.equal(typeof injected.select, 'function')
  assert.equal(typeof injected.resolveDirectory, 'function')
  assert.equal(typeof injected.setBackdropVisible, 'function')
})

test('a non-addressable session never asks for a directory', () => {
  let asked = false
  const faces = {}
  const ctx = {
    effect: (fn) => fn(),
    inject: (names, callback) =>
      callback({
        slots: {
          inject: (seat, installer) => installer(),
          register: (spec) => { faces[spec.name] = spec.inject },
        },
        sessions: { subagentAddress: () => ({ kind: 'subagent' }) },
        modelDirectories: {
          directoryFor: () => {
            asked = true
            throw new Error('a subagent session must not be asked for a directory')
          },
        },
      }),
  }
  assert.doesNotThrow(() => client.apply(ctx))
  const props = faces['conversation.input.right']('sub-1')
  assert.equal(props.available, false)
  assert.equal(props.directory, null)
  assert.equal(asked, false, 'an addressed subagent is recognised before any directory lookup')
})

test('three efforts spread across 0/15/30 and the selected one marks the pointer', () => {
  const out = mount(stateWith(['off', 'high', 'max'], 'high')).html()
  assert.match(out, /role="slider"/)
  assert.match(out, /aria-valuemin="0"/)
  assert.match(out, /aria-valuemax="30"/)
  assert.match(out, /aria-valuenow="15"/)
  // Asserted through the aria text rather than a literal, so the test does not
  // depend on the separator character surviving every tool in the chain.
  assert.match(out, /aria-valuetext="high[^"]*#15"/)
})

test('the control carries the level, and the character lives in the backdrop', () => {
  const out = mount(stateWith(['off', 'high', 'max'], 'high')).html()
  assert.match(out, /width:50%/, 'the rail fill follows the level')
  // The knob is machinery now: it turns, and paints no frame. The portrait is the
  // backdrop stage's job (asserted in tools/check-portrait.mjs).
  assert.match(out, /--rheostat-turn:0deg/, 'three efforts put the lever in the middle')
  assert.doesNotMatch(out, /intensity-\d\d\.webp/, 'no frame is painted inside the control')
})

test('a two-effort model lands on the axis ends', () => {
  const out = mount(stateWith(['off', 'max'], 'off')).html()
  assert.match(out, /aria-valuenow="0"/)
  assert.match(out, /width:0%/)
  assert.match(out, /--rheostat-turn:-120deg/, 'level 0 parks the lever at one end')
})

test('five efforts spread across 0/8/15/23/30', () => {
  const out = mount(stateWith(['a', 'b', 'c', 'd', 'e'], 'd')).html()
  assert.match(out, /aria-valuenow="23"/)
  assert.match(out, /#23/)
})

test('releasing the pointer commits the nearest advertised effort id, once', () => {
  const m = mount(stateWith(['off', 'high', 'max'], 'off'))
  const built = m.tree()
  const control = find(built, (node) => node.props.role === 'slider')[0]
  assert.ok(control !== undefined)

  // Press at the far right of the 124px rail, then release: one commit at max.
  const event = pointerEvent(124)
  control.props.onPointerDown(event)
  assert.equal(m.selections.length, 0, 'a drag must not commit on press')
  assert.match(m.html(), /data-dragging="true"/, 'the press must start a preview')

  // The release reads the level the last pointer event produced, so it is driven
  // from a freshly rendered handler, exactly as a re-render would supply.
  const released = find(m.tree(), (node) => node.props.role === 'slider')[0]
  released.props.onPointerUp(event)
  assert.deepEqual(m.selections, [
    { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' },
  ])
  assert.match(m.html(), /data-dragging="false"/, 'the release must end the preview')
})

test('a drag that lands back on the committed level submits nothing', () => {
  const m = mount(stateWith(['off', 'high', 'max'], 'high'))
  const control = find(m.tree(), (node) => node.props.role === 'slider')[0]
  const event = pointerEvent(62) // roughly the middle of a 124px rail -> level 15 -> 'high'
  control.props.onPointerDown(event)
  find(m.tree(), (node) => node.props.role === 'slider')[0].props.onPointerUp(event)
  assert.deepEqual(m.selections, [])
})

test('a locked composer refuses pointer and keyboard commits', () => {
  const m = mount(stateWith(['off', 'high', 'max'], 'off'))
  const control = find(m.tree({ locked: true }), (node) => node.props.role === 'slider')[0]
  const prevented = []
  control.props.onPointerDown(pointerEvent(124))
  control.props.onKeyDown({ key: 'End', preventDefault: () => prevented.push('key') })
  assert.deepEqual(m.selections, [])
  assert.deepEqual(prevented, [])
})

test('keyboard End schedules a commit at level 30 after the settle delay', () => {
  const m = mount(stateWith(['off', 'high', 'max'], 'off'))
  const control = find(m.tree(), (node) => node.props.role === 'slider')[0]
  control.props.onKeyDown({ key: 'End', shiftKey: false, preventDefault() {} })
  assert.equal(m.selections.length, 0, 'the commit must wait for the settle timer')

  // Timers are queued in this harness, so "the delay elapsed" is expressed by
  // firing the queue rather than by sleeping.
  runTimers()
  assert.deepEqual(m.selections, [
    { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' },
  ])
})

/** Click the model trigger, then return the option rows of the opened menu. */
function openModelMenu(m) {
  const trigger = find(m.flat(), (node) => node.props?.className === 'rheostat-model')[0]
  assert.ok(trigger !== undefined, 'the chooser trigger must render')
  trigger.props.onClick({ stopPropagation() {} })
  return find(m.flat(), (node) => node.props?.className === 'rheostat-option')
}

test('the model list only appears for more than one offered model', () => {
  // The rider competes with nothing and the native selector is untouched, so for
  // a single-model catalog it stays out of the way entirely.
  const single = mount(stateWith(['off', 'high'], 'off'))
  assert.doesNotMatch(single.html(), /rheostat-model/)
  assert.doesNotMatch(single.html(), /rheostat-menu/)
  // The instrument itself is still there: one model does not mean no slider.
  assert.match(single.html(), /role="slider"/)

  const state = stateWith(['off', 'high'], 'off')
  state.groups[0].models.push({
    id: 'deepseek-reasoner',
    name: 'DeepSeek Reasoner',
    reasoning: { efforts: [{ id: 'off' }, { id: 'high' }], defaultEffort: 'high' },
  })
  const m = mount(state)
  assert.match(m.html(), /rheostat-model/, 'with two models the rider offers a chooser')

  // The rows live in the menu, which only exists once the chooser is open.
  assert.equal(openModelMenu(m).length, 2)
  const out = m.html()
  assert.match(out, /rheostat-menu/)
  assert.match(out, /DeepSeek Reasoner/)
})

test('picking another model keeps the effort when the new model offers it', () => {
  const state = stateWith(['off', 'high', 'max'], 'max')
  state.groups[0].models.push({
    id: 'deepseek-reasoner',
    name: 'DeepSeek Reasoner',
    reasoning: { efforts: [{ id: 'off' }, { id: 'max' }], defaultEffort: 'off' },
  })
  const m = mount(state)
  const options = openModelMenu(m)
  assert.equal(options.length, 2)
  options[1].props.onClick({ stopPropagation() {} })
  assert.deepEqual(m.selections, [
    { provider: 'deepseek-official', model: 'deepseek-reasoner', reasoningEffort: 'max' },
  ])
})

test('picking a model that cannot keep the effort falls back to its default', () => {
  const state = stateWith(['off', 'high', 'max'], 'max')
  state.groups[0].models.push({
    id: 'plain-model',
    name: 'Plain',
    reasoning: { efforts: [{ id: 'low' }, { id: 'medium' }], defaultEffort: 'medium' },
  })
  const m = mount(state)
  const options = openModelMenu(m)
  assert.equal(options.length, 2)
  options[1].props.onClick({ stopPropagation() {} })
  assert.deepEqual(m.selections, [
    { provider: 'deepseek-official', model: 'plain-model', reasoningEffort: 'medium' },
  ])
})

test('a model without reasoning metadata draws no instrument and no chooser', () => {
  const state = stateWith(['off'], 'off')
  state.groups[0].models.push({ id: 'plain', name: 'Plain' })
  const m = mount(state)
  const out = m.html()
  assert.doesNotMatch(out, /role="slider"/, 'no reasoning axis means no slider')
  // The native selector is untouched, so this control steps aside rather than
  // drawing a second, partial model picker next to it.
  assert.doesNotMatch(out, /rheostat-model/)
})

test('an empty directory renders nothing and re-asks instead of giving up', () => {
  const m = mount({ current: null, groups: [], status: 'loading', error: null })
  assert.equal(m.html(), '', 'an empty catalog has nothing to draw yet')
  assert.doesNotThrow(() => m.injected.resolveDirectory())
})

test('unmounting runs every cleanup without throwing', () => {
  const m = mount(stateWith(['off', 'high', 'max'], 'high'))
  m.html()
  assert.ok(m.cleanups.length > 0)
  for (const cleanup of m.cleanups) assert.doesNotThrow(() => cleanup())
})

/* ------------------------- appearance switch ---------------------------- */

test('the switch is on by default and writes a boolean to the settings form', async () => {
  const m = mount(stateWith(['off', 'high', 'max'], 'high'))
  const view = m.settingsView()
  assert.equal(view.props.bound, true, 'the host serves the preference namespace')
  assert.equal(view.props.enabled, true, 'an unset field means the skin is on')

  const toggle = findAll(m, (node) => node.props?.role === 'switch', view)[0]
  assert.ok(toggle !== undefined, 'the row must render a switch')
  assert.equal(toggle.props['aria-checked'], 'true')

  toggle.props.onClick()
  await realDelay(0)
  assert.deepEqual(m.form.writes, [['skin', false]])
})

test('the switch reflects an off preference and turns it back on', async () => {
  const m = mount(stateWith(['off', 'high'], 'off'), { skin: false })
  const view = m.settingsView()
  assert.equal(view.props.enabled, false)
  const toggle = findAll(m, (node) => node.props?.role === 'switch', view)[0]
  assert.equal(toggle.props['aria-checked'], 'false')
  toggle.props.onClick()
  await realDelay(0)
  assert.deepEqual(m.form.writes, [['skin', true]])
})

test('a read-only form disables the switch instead of writing', () => {
  const m = mount(stateWith(['off', 'high'], 'off'), { writable: false })
  const toggle = findAll(m, (node) => node.props?.role === 'switch')[0]
  assert.equal(toggle.props.disabled, true)
  assert.equal(toggle.props['data-disabled'], 'true')
  toggle.props.onClick()
  assert.deepEqual(m.form.writes, [])
})

test('a rejected write surfaces a retry hint instead of throwing', async () => {
  const m = mount(stateWith(['off', 'high'], 'off'), { rejectWrite: true })
  const toggle = findAll(m, (node) => node.props?.role === 'switch')[0]
  assert.doesNotThrow(() => toggle.props.onClick())
  await realDelay(0)
  assert.equal(m.form.writes.length, 1, 'the attempt is recorded even when it fails')
})

test('a composition without a settings form renders the row read-only and off', () => {
  const m = mount(stateWith(['off', 'high'], 'off'), { noSettings: true })
  const view = m.settingsView()
  assert.equal(view.props.bound, false)
  assert.equal(view.props.enabled, false, 'without a form nothing may claim to be on')
  assert.match(view.html, /role="switch"/)
  assert.match(view.html, /aria-checked="false"/)
  const toggle = findAll(m, (node) => node.props?.role === 'switch', view)[0]
  assert.equal(toggle.props.disabled, true)
})

test('switching the skin off withdraws the control entirely', () => {
  const out = mount(stateWith(['off', 'high', 'max'], 'high'), { skin: false }).html()
  assert.equal(out, '', 'skin off means this control draws nothing at all')
})

/* Late directory adoption.
 *
 * A brand-new session has no binding, so the official resolver throws for it and
 * there is no directory to read. The face cannot wait for that, so the control
 * re-asks after mount; these two tests pin both halves of that behaviour. */
test('a session with no directory yet draws nothing, then appears once it exists', () => {
  const store = { getSnapshot: () => stateWith(['off', 'high', 'max'], 'high'), subscribe: () => () => {} }
  let available = null
  const m = mount(stateWith(['off', 'high', 'max'], 'high'))
  const withLateDirectory = {
    ...m.injected,
    directory: null,
    resolveDirectory: () => available,
  }

  assert.equal(m.view(withLateDirectory).html, '', 'nothing to draw before the binding exists')

  available = store
  runTimers()
  const after = m.view(withLateDirectory).html
  assert.match(after, /role="slider"/, 'the instrument appears once the directory does')
  assert.match(after, /aria-valuenow="15"/)
})

test('a throwing resolver is retried, not treated as fatal', () => {
  const m = mount(stateWith(['off', 'high'], 'off'))
  let calls = 0
  const props = {
    ...m.injected,
    directory: null,
    resolveDirectory: () => {
      calls += 1
      throw new Error('ui-model-selection: session resolved no binding')
    },
  }
  assert.doesNotThrow(() => m.view(props))
  runTimers()
  runTimers()
  assert.ok(calls > 0, 'the control must keep asking while the session is still new')
})
