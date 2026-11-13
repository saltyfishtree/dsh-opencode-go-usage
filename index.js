/**
 * Host half of the OpenCode Go usage plugin.
 *
 * It reads the subscription quota of an OpenCode Go account from the gateway's
 * own usage endpoint and hands the result to two callers:
 *
 * - the browser capsule, through `GET /opencode-go-usage`;
 * - the agent, through the `opencode_go_usage` tool.
 *
 * Both go through one cached reader, so a page, several open Sessions and a
 * tool call share a single upstream request per cache window.
 *
 * The key is never copied into this package: it is resolved per request from
 * the `credentials` service under the configured reference name, so a key set
 * in Settings → Models or in the environment both work, and a rotated key is
 * picked up without a restart.
 *
 * The package imports Node builtins only — it needs no dependency tree, so it
 * can be installed from a directory, a Git URL or the registry.
 */

/** Browser route read by the capsule. */
export const USAGE_ROUTE = '/opencode-go-usage'

/** Official usage endpoint of the OpenCode Go gateway. */
export const DEFAULT_ENDPOINT = 'https://opencode.ai/zen/go/v1/usage'

/** Credential reference the `opencode-go` LLM provider already uses. */
export const DEFAULT_KEY_REF = 'OPENCODE_GO_API_KEY'

/** Windows the gateway reports, shortest first. */
export const WINDOW_ORDER = ['rolling', 'weekly', 'monthly']

/** Write one JSON response. */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(payload)
}

/** A failure the callers can branch on. */
function failure(code, message) {
  return { ok: false, error: { code, message } }
}

/** Readable text for an unknown thrown value. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Normalize the row's config with defaults.
 * @param config - the Loader row's `config`, possibly absent.
 */
export function resolveSettings(config) {
  const value = config !== null && typeof config === 'object' ? config : {}
  const positive = (input, fallback) =>
    typeof input === 'number' && Number.isFinite(input) && input > 0 ? input : fallback
  return {
    endpoint: typeof value.endpoint === 'string' && value.endpoint !== '' ? value.endpoint : DEFAULT_ENDPOINT,
    apiKeyEnv:
      typeof value.apiKeyEnv === 'string' && value.apiKeyEnv !== '' ? value.apiKeyEnv : DEFAULT_KEY_REF,
    cacheSeconds: typeof value.cacheSeconds === 'number' && Number.isFinite(value.cacheSeconds)
      ? Math.max(0, value.cacheSeconds)
      : 30,
    staleSeconds: typeof value.staleSeconds === 'number' && Number.isFinite(value.staleSeconds)
      ? Math.max(0, value.staleSeconds)
      : 900,
    timeoutMs: positive(value.timeoutMs, 8000),
  }
}

/**
 * Pick the window with the least room left. Ties prefer the longer window,
 * because it resets later and is therefore the harder constraint.
 * @param windows - normalized windows keyed by window name.
 */
export function tightestWindow(windows) {
  let pick
  for (const name of ['monthly', 'weekly', 'rolling']) {
    const candidate = windows[name]
    if (candidate === undefined) continue
    if (pick === undefined || candidate.remaining < pick.remaining) {
      pick = { name, remaining: candidate.remaining }
    }
  }
  return pick?.name
}

/**
 * Validate one gateway payload into the shape the capsule and the tool read.
 * @param payload - the endpoint's decoded JSON.
 * @returns normalized windows, or undefined when a window is missing.
 */
export function normalizeUsage(payload) {
  const usage = payload !== null && typeof payload === 'object' ? payload.usage : undefined
  if (usage === null || typeof usage !== 'object') return undefined
  const windows = {}
  for (const name of WINDOW_ORDER) {
    const raw = usage[name]
    if (raw === null || typeof raw !== 'object') return undefined
    const percent = Number(raw.percent)
    if (!Number.isFinite(percent)) return undefined
    const used = Math.min(100, Math.max(0, Math.round(percent)))
    windows[name] = {
      status: typeof raw.status === 'string' ? raw.status : 'unknown',
      used,
      remaining: 100 - used,
      resetsAt: typeof raw.resetsAt === 'string' ? raw.resetsAt : null,
    }
  }
  return { windows, tightest: tightestWindow(windows) }
}

/**
 * Read the gateway once, resolving the key for this call only.
 * @param settings - resolved row config.
 * @param ctx - Host plugin context, used to reach `credentials`.
 */
async function fetchUsage(settings, ctx) {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) {
    return failure('credential-service', 'The credentials service is unavailable in this profile.')
  }
  let resolved
  try {
    resolved = await credentials.resolve(settings.apiKeyEnv)
  } catch (error) {
    return failure('credential-service', `The credential could not be read: ${messageOf(error)}`)
  }
  if (resolved === undefined || resolved.value === '') {
    return failure(
      'missing-credential',
      `No ${settings.apiKeyEnv} credential is configured. Add an OpenCode Go key in Settings → Models, or set ${settings.apiKeyEnv} in the environment.`,
    )
  }

  const timeout =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(settings.timeoutMs)
      : undefined

  let response
  try {
    response = await fetch(settings.endpoint, {
      method: 'GET',
      headers: { authorization: `Bearer ${resolved.value}`, accept: 'application/json' },
      ...(timeout === undefined ? {} : { signal: timeout }),
    })
  } catch (error) {
    return failure('network', `Could not reach opencode.ai: ${messageOf(error)}`)
  }

  if (response.status === 401 || response.status === 403) {
    return failure(
      'unauthorized',
      `OpenCode Go rejected the ${settings.apiKeyEnv} key (HTTP ${response.status}). Check that the key is current and belongs to a Go subscription.`,
    )
  }
  if (!response.ok) {
    return failure('http', `The usage endpoint answered HTTP ${response.status}.`)
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    return failure('invalid-response', 'The usage response was not JSON.')
  }

  const normalized = normalizeUsage(payload)
  if (normalized === undefined) {
    return failure('invalid-response', 'The usage response has no rolling, weekly and monthly windows.')
  }
  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    windows: normalized.windows,
    tightest: normalized.tightest,
  }
}

/**
 * Build the shared cached reader.
 *
 * A failed read keeps serving the last good snapshot while it is younger than
 * `staleSeconds`, marked `stale`, so a flaky network does not blank the capsule.
 * @param settings - resolved row config.
 * @param ctx - Host plugin context.
 */
export function createUsageReader(settings, ctx) {
  /** Last successful snapshot and when it was read. */
  let snapshot
  let snapshotAt = 0
  /** The in-flight read, shared by every caller. */
  let inflight

  const fresh = () => snapshot !== undefined && Date.now() - snapshotAt < settings.cacheSeconds * 1000

  const read = async (force) => {
    if (!force && fresh()) return { ...snapshot, cached: true }
    if (inflight !== undefined) return inflight

    const task = fetchUsage(settings, ctx)
      .then((value) => {
        if (value.ok !== true) return value
        snapshot = value
        snapshotAt = Date.now()
        return { ...value, cached: false }
      })
      .catch((error) => failure('unexpected', `The usage reader failed: ${messageOf(error)}`))
      .then((value) => {
        if (value.ok === true || snapshot === undefined) return value
        if (Date.now() - snapshotAt > settings.staleSeconds * 1000) return value
        return { ...snapshot, cached: true, stale: true, error: value.error }
      })
      .finally(() => {
        if (inflight === task) inflight = undefined
      })

    inflight = task
    return task
  }

  return { read, peek: () => snapshot }
}

/** One line per window, for the tool's readable result. */
function summarize(value) {
  const lines = []
  if (value.ok !== true) {
    const error = value.error
    return `OpenCode Go usage unavailable: ${error?.message ?? 'unknown error'} (${error?.code ?? 'unknown'})`
  }
  const label = { rolling: '5-hour', weekly: 'weekly', monthly: 'monthly' }
  for (const name of WINDOW_ORDER) {
    const window = value.windows[name]
    if (window === undefined) continue
    const reset = window.resetsAt === null ? 'no reset time' : `resets ${window.resetsAt}`
    lines.push(
      `- ${label[name]}: ${window.used}% used, ${window.remaining}% left, ${reset}` +
        (window.status === 'ok' ? '' : `, status ${window.status}`),
    )
  }
  lines.push(`Tightest window: ${label[value.tightest] ?? value.tightest}. Read at ${value.fetchedAt}.`)
  if (value.stale === true) lines.push('This is the last successful reading; the newest request failed.')
  return lines.join('\n')
}

/** The agent-facing tool around the same reader. */
function defineUsageTool(read) {
  return {
    name: 'opencode_go_usage',
    description:
      'Read the OpenCode Go subscription quota of this machine\'s account: the 5-hour (rolling), weekly and monthly windows with used and remaining percentages and their reset times. Call it when the user asks how much OpenCode Go quota is left, or whether a window is exhausted. It does not consume quota.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        refresh: {
          type: 'boolean',
          description: 'Bypass the short server-side cache and read the usage endpoint again.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          fetchedAt: { type: 'string' },
          tightest: { type: 'string' },
          stale: { type: 'boolean' },
          error: {
            type: 'object',
            additionalProperties: true,
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: summarize(value) }],
    },
    async execute(args) {
      return read(args !== null && typeof args === 'object' && args.refresh === true)
    },
  }
}

/**
 * Mount the Host half.
 * @param ctx - Host plugin context.
 * @param config - the Loader row's config.
 */
export function apply(ctx, config) {
  const settings = resolveSettings(config)
  const reader = createUsageReader(settings, ctx)

  // The browser capsule's data source. The route runs the same Host/Origin and
  // browser-authentication checks as the shared API channel.
  ctx.inject(['webServer', 'connection'], (scoped) => {
    const rejected = (req, res) => {
      const rejection = scoped.connection.requestRejection(req)
      if (rejection === undefined) return false
      res.statusCode = rejection
      res.end()
      return true
    }

    scoped.effect(
      () =>
        scoped.webServer.register({
          kind: 'exact',
          path: USAGE_ROUTE,
          handler: async (req, res) => {
            if (rejected(req, res)) return
            if (req.method !== 'GET' && req.method !== 'HEAD') {
              res.statusCode = 405
              res.setHeader('allow', 'GET, HEAD')
              res.end()
              return
            }
            const force = new URL(req.url ?? USAGE_ROUTE, 'http://dsh.invalid').searchParams.get('force') === '1'
            let body
            try {
              body = await reader.read(force)
            } catch (error) {
              body = failure('unexpected', `The usage reader failed: ${messageOf(error)}`)
            }
            if (req.method === 'HEAD') {
              res.statusCode = 200
              res.setHeader('content-type', 'application/json; charset=utf-8')
              res.setHeader('cache-control', 'no-store')
              res.end()
              return
            }
            sendJson(res, 200, body)
          },
        }),
      `opencode-go-usage: GET ${USAGE_ROUTE}`,
    )

    ctx.logger?.info?.(`opencode-go-usage: browser readings at ${USAGE_ROUTE}`)
  })

  // The same reading, for the agent.
  ctx.inject(['tools'], (scoped) => {
    scoped.effect(
      () => scoped.tools.register(defineUsageTool(reader.read)),
      'opencode-go-usage: opencode_go_usage tool',
    )
  })
}
