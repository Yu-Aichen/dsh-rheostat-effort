'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { readdirSync } = require('node:fs')
const { join } = require('node:path')

const logic = require('../lib/logic.js')

const ASSET_DIR = join(__dirname, '..', 'assets')

test('every anchor level has exactly one shipped frame, and no frame is orphaned', () => {
  const shipped = readdirSync(ASSET_DIR)
    .filter((name) => name.endsWith('.webp'))
    .sort()
  const expected = logic.ANCHOR_LEVELS.map((level) => logic.frameName(level)).sort()
  assert.deepEqual(shipped, expected)
  assert.equal(shipped.length, 24)
})

test('frameForLevel is exact on anchors and blends strictly between them', () => {
  for (const level of logic.ANCHOR_LEVELS) {
    const frame = logic.frameForLevel(level)
    assert.equal(frame.exact, true, `level ${level} should be an anchor`)
    assert.equal(frame.lower, level)
    assert.equal(frame.upper, level)
    assert.equal(frame.mix, 0)
  }

  // 2, 5, 8, 11, 20, 23, 26 are the gaps in the shipped set.
  for (const level of [2, 5, 8, 11, 20, 23, 26]) {
    const frame = logic.frameForLevel(level)
    assert.equal(frame.exact, false, `level ${level} should blend`)
    assert.ok(frame.lower < level && level < frame.upper, `level ${level} must sit between anchors`)
    assert.ok(frame.mix > 0 && frame.mix < 1)
  }
})

test('frameForLevel clamps out-of-range input and blends on fractions', () => {
  assert.deepEqual(logic.frameForLevel(-5), { lower: 0, upper: 0, mix: 0, exact: true })
  assert.deepEqual(logic.frameForLevel(99), { lower: 30, upper: 30, mix: 0, exact: true })

  // 2.4 rounds to the gap at 2, so it blends the frames at 1 and 3.
  const fraction = logic.frameForLevel(2.4)
  assert.equal(fraction.exact, false)
  assert.equal(fraction.lower, 1)
  assert.equal(fraction.upper, 3)
  assert.ok(Math.abs(fraction.mix - 0.5) < 1e-9)

  // 2.5 rounds onto the anchor at 3 and is therefore exact.
  assert.deepEqual(logic.frameForLevel(2.5), { lower: 3, upper: 3, mix: 0, exact: true })
})

test('levelForIndex spreads N efforts evenly across 0-30', () => {
  assert.equal(logic.levelForIndex(0, 2), 0)
  assert.equal(logic.levelForIndex(1, 2), 30)

  assert.equal(logic.levelForIndex(0, 3), 0)
  assert.equal(logic.levelForIndex(1, 3), 15)
  assert.equal(logic.levelForIndex(2, 3), 30)

  assert.equal(logic.levelForIndex(0, 5), 0)
  assert.equal(logic.levelForIndex(1, 5), 8)
  assert.equal(logic.levelForIndex(2, 5), 15)
  assert.equal(logic.levelForIndex(3, 5), 23)
  assert.equal(logic.levelForIndex(4, 5), 30)

  // A single effort is not a slider.
  assert.equal(logic.levelForIndex(0, 1), 0)
  assert.equal(logic.levelForIndex(0, 0), 0)
})

test('nearestEffortIndex is the inverse of levelForIndex for every effort', () => {
  for (const count of [2, 3, 4, 5, 6, 7]) {
    for (let index = 0; index < count; index++) {
      const level = logic.levelForIndex(index, count)
      assert.equal(
        logic.nearestEffortIndex(level, count),
        index,
        `count=${count} index=${index} level=${level} should round-trip`,
      )
    }
  }
})

test('nearestEffortIndex clamps instead of returning an out-of-range effort', () => {
  assert.equal(logic.nearestEffortIndex(-10, 3), 0)
  assert.equal(logic.nearestEffortIndex(999, 3), 2)
  assert.equal(logic.nearestEffortIndex(15, 1), 0)
  assert.equal(logic.nearestEffortIndex(15, 0), 0)
})

test('the backdrop tone is monotonic and bounded', () => {
  let previousAlpha = -1
  let previousHue = -1
  for (let level = 0; level <= 30; level++) {
    const tone = logic.backdropForLevel(level)
    assert.ok(tone.hue >= 8 && tone.hue <= 272, `hue ${tone.hue} out of range at level ${level}`)
    assert.ok(tone.alpha >= 0.05 && tone.alpha <= 0.17, `alpha ${tone.alpha} out of range at level ${level}`)
    assert.ok(tone.glow >= 0.1 && tone.glow <= 0.55, `glow ${tone.glow} out of range at level ${level}`)
    assert.ok(tone.alpha >= previousAlpha, `alpha decreased at level ${level}`)
    assert.ok(tone.hue >= previousHue, `hue decreased at level ${level}`)
    previousAlpha = tone.alpha
    previousHue = tone.hue
  }
  assert.equal(logic.backdropForLevel(-1).alpha, logic.backdropForLevel(0).alpha)
  assert.equal(logic.backdropForLevel(31).hue, logic.backdropForLevel(30).hue)
})

test('indicatorText prefers the effort label and falls back to the level', () => {
  assert.equal(logic.indicatorText(30, { id: 'max', label: '梁圣' }), '梁圣 · #30')
  assert.equal(logic.indicatorText(15, { id: 'high' }), 'high · #15')
  assert.equal(logic.indicatorText(0, { id: 'off', label: '   ' }), 'off · #0')
  assert.equal(logic.indicatorText(7, undefined), '#7')
  assert.equal(logic.indicatorText(7, { label: '' }), '#7')
})
