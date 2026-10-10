import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Host half of `dsh-rheostat-effort`.
 *
 * The client half needs 24 portrait frames addressed as
 * `/plugins/<PACKAGE_ID>/assets/intensity-<NN>.webp`. This half serves them from
 * `assets/` at the package root, so replacing a frame is a file drop — no
 * rebuild, no code edit. Only `intensity-<NN>.webp` names are recognised, and
 * every path is resolved inside the package's own `assets/` directory.
 */

export const PACKAGE_ID = 'dsh-rheostat-effort'
export const ASSET_PREFIX = `/plugins/${PACKAGE_ID}/assets/`

const ASSET_NAME = /^intensity-(\d{1,2})\.webp$/
const CACHE_CONTROL = 'private, max-age=3600, must-revalidate'

/** Missing or unreadable files simply drop that anchor; the client blends over it. */
function collectAssets() {
  const directory = fileURLToPath(new URL('../assets/', import.meta.url))
  const assets = new Map()
  if (!existsSync(directory)) return assets

  for (const name of readdirSync(directory)) {
    const match = ASSET_NAME.exec(name)
    if (match === null) continue
    const intensity = Number(match[1])
    if (!Number.isInteger(intensity) || intensity < 0 || intensity > 30) continue

    const path = fileURLToPath(new URL(`../assets/${name}`, import.meta.url))
    try {
      const info = statSync(path)
      if (!info.isFile()) continue
      assets.set(`${ASSET_PREFIX}${name}`, {
        path,
        size: info.size,
        etag: `W/"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`,
      })
    } catch {
      // A frame that vanished between readdir and stat is not fatal.
    }
  }
  return assets
}

function respond(res, status, headers = {}) {
  res.writeHead(status, { 'X-Content-Type-Options': 'nosniff', ...headers })
  res.end()
}

/**
 * The client asks for a whole frame with a plain `<img src>`; the only Range the
 * browser may issue for these small files is a single byte range for a resumed
 * request, so a compact `bytes=start-end` parser is enough here.
 */
function parseRange(value, size) {
  if (value === undefined) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (match === null || value.includes(',') || (match[1] === '' && match[2] === '')) return false

  if (match[1] === '') {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(match[1])
  let end = match[2] === '' ? size - 1 : Number(match[2])
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return false
  if (start >= size || end < start) return false
  return { start, end: Math.min(end, size - 1) }
}

function createHandler(assets, activeStreams) {
  return (req, res) => {
    const method = req.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD') {
      respond(res, 405, { Allow: 'GET, HEAD' })
      return
    }

    let pathname
    try {
      pathname = new URL(req.url ?? '/', 'http://dsh.local').pathname
    } catch {
      respond(res, 400)
      return
    }

    const asset = assets.get(pathname)
    if (asset === undefined) {
      respond(res, 404)
      return
    }
    if (req.headers['if-none-match'] === asset.etag) {
      respond(res, 304, { ETag: asset.etag })
      return
    }

    const range = parseRange(req.headers.range, asset.size)
    if (range === false) {
      respond(res, 416, { 'Content-Range': `bytes */${asset.size}` })
      return
    }

    const start = range?.start ?? 0
    const end = range?.end ?? asset.size - 1
    const headers = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': CACHE_CONTROL,
      'Content-Length': String(end - start + 1),
      'Content-Type': 'image/webp',
      ETag: asset.etag,
      ...(range === null ? {} : { 'Content-Range': `bytes ${start}-${end}/${asset.size}` }),
    }

    if (method === 'HEAD') {
      respond(res, range === null ? 200 : 206, headers)
      return
    }

    res.writeHead(range === null ? 200 : 206, {
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    })
    const stream = createReadStream(asset.path, { start, end })
    activeStreams.add(stream)
    const release = () => activeStreams.delete(stream)
    stream.once('close', release)
    stream.once('end', release)
    stream.once('error', () => {
      release()
      if (!res.headersSent) respond(res, 500)
      else res.destroy()
    })
    res.once('close', () => {
      if (!stream.destroyed) stream.destroy()
    })
    stream.pipe(res)
  }
}

export const inject = ['webServer']

export function apply(ctx) {
  ctx.effect(() => {
    const assets = collectAssets()
    const activeStreams = new Set()
    const handler = createHandler(assets, activeStreams)
    const unregister = [...assets.keys()].map((path) =>
      ctx.webServer.register({ kind: 'exact', path, handler }),
    )
    ctx.logger?.info?.(
      `rheostat-effort: serving ${assets.size} intensity frame(s) from ${ASSET_PREFIX}`,
    )
    return () => {
      for (const dispose of unregister) dispose()
      for (const stream of activeStreams) stream.destroy()
      activeStreams.clear()
    }
  }, 'rheostat-effort: intensity frame routes')
}
