'use strict'

/**
 * Pure logic for the rheostat effort control.
 *
 * Everything here is deliberately free of React and of DSH types so it can be
 * unit-tested with plain `node --test`. The client half is only a view over
 * these functions.
 *
 * The visual axis is 0-30 (31 positions). Only 24 frames exist, so the frames
 * are modelled as *anchors* on that axis and a level that has no frame of its
 * own blends the two neighbouring ones.
 */

const MIN_LEVEL = 0
const MAX_LEVEL = 30
const VIEWPORT_PREVIEW_LEVEL = 15

/** Intensity -> file name. Replace a file to replace that anchor; no rebuild. */
function frameName(level) {
  return `intensity-${String(level).padStart(2, '0')}.webp`
}

const ANCHOR_LEVELS = [
  0, 1, 3, 4, 6, 7, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 25, 27, 28, 29, 30,
]

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value
}

function round1(value) {
  return Math.round(value * 1000) / 1000
}

/** Position on the 0-30 axis for an effort, spread evenly over `count` steps. */
function levelForIndex(index, count) {
  if (!Number.isInteger(count) || count <= 1) return MIN_LEVEL
  const bounded = clamp(Number.isInteger(index) ? index : 0, 0, count - 1)
  return Math.round((bounded * MAX_LEVEL) / (count - 1))
}

function nearestEffortIndex(level, count) {
  if (!Number.isInteger(count) || count <= 1) return 0
  return clamp(Math.round((clamp(level, MIN_LEVEL, MAX_LEVEL) * (count - 1)) / MAX_LEVEL), 0, count - 1)
}

/**
 * The frame to display for a level: the exact anchor when one exists, otherwise
 * the two anchors to blend with `mix` in [0,1].
 */
function frameForLevel(level) {
  const bounded = clamp(Math.round(level), MIN_LEVEL, MAX_LEVEL)
  if (ANCHOR_LEVELS.includes(bounded)) {
    return { lower: bounded, upper: bounded, mix: 0, exact: true }
  }
  let lower = MIN_LEVEL
  let upper = MAX_LEVEL
  for (const anchor of ANCHOR_LEVELS) {
    if (anchor <= bounded) lower = anchor
    if (anchor >= bounded) {
      upper = anchor
      break
    }
  }
  if (upper === lower) return { lower, upper, mix: 0, exact: true }
  return { lower, upper, mix: (bounded - lower) / (upper - lower), exact: false }
}

/** Label for the knob, e.g. `high · 高强度`. */
function effortLabel(effort) {
  if (effort === undefined || effort === null) return ''
  const explicit = typeof effort.label === 'string' && effort.label.trim() !== '' ? effort.label.trim() : ''
  if (explicit !== '') return explicit
  const id = typeof effort.id === 'string' ? effort.id.trim() : ''
  return id === '' ? '' : id
}

/** The knob is a lever, so its caption is the level, not the raw effort id. */
function indicatorText(level, effort) {
  const caption = effortLabel(effort)
  return caption === '' ? `#${level}` : `${caption} · #${level}`
}

/** Background layer tone: red at 0, teal around 15, violet at 30. */
function backdropForLevel(level) {
  const t = clamp(level, MIN_LEVEL, MAX_LEVEL) / MAX_LEVEL
  const hue = t <= 0.5 ? 8 + (168 - 8) * (t / 0.5) : 168 + (272 - 168) * ((t - 0.5) / 0.5)
  return { hue: Math.round(hue), alpha: round1(0.05 + 0.12 * t), glow: round1(0.1 + 0.45 * t) }
}

module.exports = {
  MIN_LEVEL,
  MAX_LEVEL,
  VIEWPORT_PREVIEW_LEVEL,
  ANCHOR_LEVELS,
  frameName,
  frameForLevel,
  levelForIndex,
  nearestEffortIndex,
  effortLabel,
  indicatorText,
  backdropForLevel,
}
