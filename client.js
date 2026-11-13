/**
 * Browser half of the OpenCode Go usage plugin.
 *
 * A classic script in the Harness client-module format: the module loader
 * materializes the factory below and drives the returned Cordis plugin.
 *
 * It adds one capsule to `conversation.composer.dock`, beside the shipped
 * activity and usage readings. The capsule shows the room left in the tightest
 * OpenCode Go window, and clicking it opens a panel with all three windows, a
 * bar per window and a live reset countdown.
 *
 * Only frozen platform seeds are required (`react`, `react-dom`); the capsule
 * imports no Harness Client package and styles itself with theme tokens.
 */
window.__ModuleLoader__.load({
  id: 'dsh-opencode-go-usage',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    /** Route served by this package's Host half. */
    const ROUTE = '/opencode-go-usage'
    /** Locale namespace for every visible string. */
    const NS = 'opencodeGoUsage'
    /** Slot the capsule joins, below the composer card. */
    const DOCK = 'conversation.composer.dock'
    /** How often an open page re-reads usage. */
    const POLL_MS = 60_000
    /** Windows, shortest first, as the Host reports them. */
    const WINDOWS = ['rolling', 'weekly', 'monthly']

    /** Every visible string, in the host's `{name}` interpolation syntax. */
    const COPY = {
      en: {
        'pill.label': 'Go',
        'pill.aria': 'OpenCode Go usage: {left}% left in the {window} window',
        'pill.errorAria': 'OpenCode Go usage could not be read. Open for details.',
        'panel.aria': 'OpenCode Go usage',
        'panel.title': 'OpenCode Go',
        'panel.left': '{left}% left',
        'window.rolling': '5-hour',
        'window.weekly': 'Weekly',
        'window.monthly': 'Monthly',
        'window.reading': '{used}% used · {left}% left',
        'window.resetsIn': 'resets in {time}',
        'window.resetsAt': 'no reset time',
        'status.limited': 'Rate limited',
        'status.other': 'Issue',
        'updated.seconds': 'Updated {count}s ago',
        'updated.minutes': 'Updated {count}m ago',
        'updated.now': 'Updated just now',
        'refresh': 'Refresh',
        'refreshing': 'Refreshing…',
        'stale': 'The newest request failed; this is the last reading.',
        'error.missing':
          'No OpenCode Go key is configured. Add one in Settings → Models, or set OPENCODE_GO_API_KEY in the environment.',
        'error.unauthorized': 'OpenCode Go rejected the key. Check that OPENCODE_GO_API_KEY is current.',
        'error.http': 'The usage request failed with HTTP {status}.',
        'error.network': 'Could not reach opencode.ai. Retrying automatically.',
        'error.invalid': 'The usage response could not be read.',
        'error.other': 'Usage is unavailable: {message}',
        'error.retry': 'Try again',
        'hint': 'Read with your own key from opencode.ai. It does not use quota.',
        'duration.days': '{days}d {hours}h',
        'duration.hours': '{hours}h {minutes}m',
        'duration.minutes': '{minutes}m {seconds}s',
        'duration.seconds': '{seconds}s'
      },
      zh: {
        'pill.label': 'Go',
        'pill.aria': 'OpenCode Go 用量：{window}窗口剩余 {left}%',
        'pill.errorAria': '无法读取 OpenCode Go 用量，点击查看详情',
        'panel.aria': 'OpenCode Go 用量',
        'panel.title': 'OpenCode Go',
        'panel.left': '剩余 {left}%',
        'window.rolling': '5 小时',
        'window.weekly': '本周',
        'window.monthly': '本月',
        'window.reading': '已用 {used}% · 剩余 {left}%',
        'window.resetsIn': '{time}后重置',
        'window.resetsAt': '没有重置时间',
        'status.limited': '已达上限',
        'status.other': '状态异常',
        'updated.seconds': '{count} 秒前更新',
        'updated.minutes': '{count} 分钟前更新',
        'updated.now': '刚刚更新',
        'refresh': '刷新',
        'refreshing': '正在刷新…',
        'stale': '最新一次请求失败，显示上次读数。',
        'error.missing':
          '还没有配置 OpenCode Go 密钥。请在「设置 → 模型」中填写，或设置环境变量 OPENCODE_GO_API_KEY。',
        'error.unauthorized': 'OpenCode Go 拒绝了这个密钥，请检查 OPENCODE_GO_API_KEY 是否有效。',
        'error.http': '用量请求失败（HTTP {status}）。',
        'error.network': '无法连接 opencode.ai，稍后会自动重试。',
        'error.invalid': '无法解析用量响应。',
        'error.other': '暂时无法读取用量：{message}',
        'error.retry': '重试',
        'hint': '用你自己的密钥读取 opencode.ai 的配额，不消耗额度。',
        'duration.days': '{days} 天 {hours} 小时',
        'duration.hours': '{hours} 小时 {minutes} 分',
        'duration.minutes': '{minutes} 分 {seconds} 秒',
        'duration.seconds': '{seconds} 秒'
      }
    }

    /**
     * Capsule and panel styles. Only `--dsw-alias-*` theme tokens carry color,
     * so a renamed token degrades appearance instead of breaking the reading;
     * radius and shadow are literals, as in the shipped composer readings.
     */
    const CSS = `
.dsh-gou-anchor {
  display: inline-flex;
  min-width: 0;
  font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px);
  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));
}
.dsh-gou-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  box-sizing: border-box;
  height: 21px;
  padding: 0 8px 0 6px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-variant-numeric: tabular-nums;
  line-height: inherit;
  white-space: nowrap;
  cursor: pointer;
}
.dsh-gou-pill:hover,
.dsh-gou-pill[aria-expanded='true'] {
  border-color: var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
}
.dsh-gou-pill:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.dsh-gou-ring {
  width: 11px;
  height: 11px;
  flex: none;
  overflow: visible;
}
.dsh-gou-track {
  stroke: var(--dsw-alias-border-l2);
}
.dsh-gou-arc[data-tone='ok'] { stroke: var(--dsw-alias-state-success-primary); }
.dsh-gou-arc[data-tone='warn'] { stroke: var(--dsw-alias-state-warn-primary); }
.dsh-gou-arc[data-tone='error'] { stroke: var(--dsw-alias-state-error-primary); }
.dsh-gou-value {
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.dsh-gou-value[data-tone='warn'] { color: var(--dsw-alias-state-warn-primary); }
.dsh-gou-value[data-tone='error'] { color: var(--dsw-alias-state-error-primary); }
.dsh-gou-panel {
  position: fixed;
  z-index: 1100;
  box-sizing: border-box;
  width: max-content;
  min-width: min(296px, calc(100vw - 24px));
  max-width: min(420px, calc(100vw - 24px));
  max-height: calc(100dvh - 24px);
  margin: 0;
  padding: 14px 16px 12px;
  overflow-x: hidden;
  overflow-y: auto;
  border-radius: 12px;
  background: var(--dsw-alias-bg-overlay);
  box-shadow: 0 12px 32px light-dark(#0000001f, #00000070);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
  cursor: default;
  position-area: none;
  top: max(12px, var(--dsh-frame-overlay-top, 12px));
  bottom: max(12px, calc(anchor(top) + 8px));
  left: max(12px, anchor(left));
  right: 12px;
  align-self: end;
  justify-self: start;
  height: fit-content;
  position-try-fallbacks: --dsh-gou-opposite, --dsh-gou-viewport;
}
@position-try --dsh-gou-opposite {
  top: max(12px, calc(anchor(bottom) + 8px));
  bottom: 12px;
  align-self: start;
}
@position-try --dsh-gou-viewport {
  inset: max(12px, var(--dsh-frame-overlay-top, 12px)) 12px 12px;
  align-self: safe start;
  justify-self: safe end;
}
.dsh-gou-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 8px;
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}
.dsh-gou-head-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.dsh-gou-head-value {
  font-variant-numeric: tabular-nums;
}
.dsh-gou-rule {
  margin-bottom: 10px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-gou-row + .dsh-gou-row {
  margin-top: 12px;
}
.dsh-gou-row-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 5px;
}
.dsh-gou-row-name {
  color: var(--dsw-alias-label-primary);
}
.dsh-gou-row-reading {
  font-variant-numeric: tabular-nums;
}
.dsh-gou-row-reading[data-tone='warn'] { color: var(--dsw-alias-state-warn-primary); }
.dsh-gou-row-reading[data-tone='error'] { color: var(--dsw-alias-state-error-primary); }
.dsh-gou-bar {
  position: relative;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
}
.dsh-gou-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--dsw-alias-state-success-primary);
}
.dsh-gou-fill[data-tone='warn'] { background: var(--dsw-alias-state-warn-primary); }
.dsh-gou-fill[data-tone='error'] { background: var(--dsw-alias-state-error-primary); }
.dsh-gou-row-foot {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-top: 4px;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}
.dsh-gou-row-status {
  margin-inline-start: 6px;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-state-warn-primary);
  font-size: 11px;
}
.dsh-gou-panel:focus {
  outline: none;
}
.dsh-gou-note {
  margin-top: 12px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-state-warn-primary);
}
.dsh-gou-note[data-kind='error'] { color: var(--dsw-alias-state-error-primary); }
.dsh-gou-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 0.5px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary);
}
.dsh-gou-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.dsh-gou-button {
  padding: 1px 8px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  line-height: inherit;
  cursor: pointer;
}
.dsh-gou-button:hover {
  border-color: var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
}
.dsh-gou-button:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.dsh-gou-button:disabled {
  cursor: default;
  opacity: 0.6;
}
`

    /** A compact duration such as `2h 11m`, from a millisecond count. */
    function durationText(ms, t) {
      const total = Math.max(0, Math.round(ms / 1000))
      const days = Math.floor(total / 86_400)
      const hours = Math.floor((total % 86_400) / 3_600)
      const minutes = Math.floor((total % 3_600) / 60)
      const seconds = total % 60
      if (days > 0) return t('duration.days', { days, hours })
      if (hours > 0) return t('duration.hours', { hours, minutes })
      if (minutes > 0) return t('duration.minutes', { minutes, seconds })
      return t('duration.seconds', { seconds })
    }

    /** Local wall-clock time for a reset instant, or null. */
    function clockText(iso) {
      if (typeof iso !== 'string') return null
      const at = new Date(iso)
      if (Number.isNaN(at.getTime())) return null
      return at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    }

    /** How loud a window's reading should be. */
    function toneOf(reading) {
      if (reading.status !== 'ok' || reading.used >= 90) return 'error'
      if (reading.used >= 75) return 'warn'
      return 'ok'
    }

    /**
     * One page's reading of the Host route.
     *
     * Polls while mounted, re-reads when the tab becomes visible again, and
     * keeps the last good snapshot across a failed poll.
     */
    function useUsage() {
      const [state, setState] = React.useState({ snapshot: undefined, error: undefined })
      const [refreshing, setRefreshing] = React.useState(false)
      const mounted = React.useRef(true)

      const load = React.useCallback(async (force) => {
        if (force) setRefreshing(true)
        try {
          const response = await fetch(force ? `${ROUTE}?force=1` : ROUTE, {
            credentials: 'same-origin',
            headers: { accept: 'application/json' },
          })
          if (!response.ok) {
            if (mounted.current) {
              setState((previous) => ({
                snapshot: previous.snapshot,
                error: { code: 'http', message: `HTTP ${response.status}` },
              }))
            }
            return
          }
          let body
          try {
            body = await response.json()
          } catch {
            if (mounted.current) {
              setState((previous) => ({
                snapshot: previous.snapshot,
                error: { code: 'invalid-response', message: 'The route answered with a non-JSON body.' },
              }))
            }
            return
          }
          if (!mounted.current) return
          setState((previous) => ({
            snapshot: body.ok === true ? body : previous.snapshot,
            error: body.ok === true ? undefined : body.error,
          }))
        } catch (error) {
          // Only a rejected fetch lands here: the route itself failed to answer.
          if (!mounted.current) return
          setState((previous) => ({
            snapshot: previous.snapshot,
            error: { code: 'network', message: String(error?.message ?? error) },
          }))
        } finally {
          if (force && mounted.current) setRefreshing(false)
        }
      }, [])

      React.useEffect(() => {
        mounted.current = true
        let disposed = false
        const tick = () => {
          if (disposed || document.visibilityState === 'hidden') return
          void load(false)
        }
        void load(false)
        const timer = setInterval(tick, POLL_MS)
        const onVisible = () => {
          if (document.visibilityState === 'visible') tick()
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          disposed = true
          mounted.current = false
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [load])

      return { ...state, refreshing, refresh: () => void load(true) }
    }

    /** The small quota ring: the filled part is what is left. */
    function Ring({ remaining, tone }) {
      const radius = 5.2
      const circumference = 2 * Math.PI * radius
      const filled = (circumference * Math.max(0, Math.min(100, remaining))) / 100
      return h(
        'svg',
        { className: 'dsh-gou-ring', viewBox: '0 0 12 12', 'aria-hidden': true },
        h('circle', {
          className: 'dsh-gou-track',
          cx: 6,
          cy: 6,
          r: radius,
          fill: 'none',
          strokeWidth: 1.6,
        }),
        h('circle', {
          className: 'dsh-gou-arc',
          'data-tone': tone,
          cx: 6,
          cy: 6,
          r: radius,
          fill: 'none',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeDasharray: `${filled} ${circumference}`,
          transform: 'rotate(-90 6 6)',
        }),
      )
    }

    /** One window's row in the panel. */
    function WindowRow({ name, reading, t, now }) {
      const tone = toneOf(reading)
      const reset = reading.resetsAt === null ? null : new Date(reading.resetsAt).getTime()
      const countdown = reset === null || Number.isNaN(reset) ? null : durationText(reset - now, t)
      const clock = clockText(reading.resetsAt)
      const status = reading.status === 'ok' ? null : reading.status
      return h(
        'div',
        { className: 'dsh-gou-row' },
        h(
          'div',
          { className: 'dsh-gou-row-head' },
          h(
            'span',
            { className: 'dsh-gou-row-name' },
            t(`window.${name}`),
            status === null
              ? null
              : h(
                  'span',
                  { className: 'dsh-gou-row-status' },
                  t(status === 'rate-limited' ? 'status.limited' : 'status.other'),
                ),
          ),
          h(
            'span',
            { className: 'dsh-gou-row-reading', 'data-tone': tone },
            t('window.reading', { used: reading.used, left: reading.remaining }),
          ),
        ),
        h(
          'div',
          {
            className: 'dsh-gou-bar',
            role: 'img',
            'aria-label': t('window.reading', { used: reading.used, left: reading.remaining }),
          },
          h('span', {
            className: 'dsh-gou-fill',
            'data-tone': tone,
            // The bar, the ring and the headline all measure what is left, so
            // a fuller bar always means more room.
            style: { width: `${reading.remaining}%` },
          }),
        ),
        h(
          'div',
          { className: 'dsh-gou-row-foot' },
          h('span', null, countdown === null ? t('window.resetsAt') : t('window.resetsIn', { time: countdown })),
          clock === null ? null : h('span', null, clock),
        ),
      )
    }

    /** The click-open panel, positioned against the capsule. */
    function UsagePanel({ anchorName, panelRef, snapshot, error, refreshing, onRefresh, t, now }) {
      const windowName = snapshot === undefined ? 'rolling' : snapshot.tightest
      const tightest = snapshot === undefined ? undefined : snapshot.windows[windowName]
      const fetched = snapshot === undefined ? undefined : new Date(snapshot.fetchedAt).getTime()
      const age = fetched === undefined || Number.isNaN(fetched) ? null : Math.max(0, now - fetched)
      // With no reading yet the footer carries no age: "reading…" would claim
      // work that already failed.
      const updated =
        age === null
          ? null
          : age < 5_000
            ? t('updated.now')
            : age < 60_000
              ? t('updated.seconds', { count: Math.round(age / 1000) })
              : t('updated.minutes', { count: Math.round(age / 60_000) })

      const failure = error === undefined ? undefined : error.code
      const failureText =
        error === undefined
          ? undefined
          : error.code === 'missing-credential'
            ? t('error.missing')
            : error.code === 'unauthorized'
              ? t('error.unauthorized')
              : error.code === 'network'
                ? t('error.network')
                : error.code === 'invalid-response'
                  ? t('error.invalid')
                  : error.code === 'http'
                    ? t('error.http', { status: /HTTP (\d+)/.exec(error.message ?? '')?.[1] ?? '?' })
                    : t('error.other', { message: error.message ?? failure })

      return h(
        'div',
        {
          ref: panelRef,
          className: 'dsh-gou-panel',
          role: 'dialog',
          'aria-label': t('panel.aria'),
          tabIndex: -1,
          style: { positionAnchor: anchorName },
        },
        h(
          'div',
          { className: 'dsh-gou-head' },
          h(
            'span',
            { className: 'dsh-gou-head-label' },
            tightest === undefined ? null : h(Ring, { remaining: tightest.remaining, tone: toneOf(tightest) }),
            t('panel.title'),
          ),
          tightest === undefined ? null : h('span', { className: 'dsh-gou-head-value' }, t('panel.left', { left: tightest.remaining })),
        ),
        h('div', { className: 'dsh-gou-rule', 'aria-hidden': true }),

        snapshot === undefined
          ? null
          : WINDOWS.map((name) => {
              const reading = snapshot.windows[name]
              return reading === undefined
                ? null
                : h(WindowRow, { key: name, name, reading, t, now })
            }),

        // One note at a time: with a reading on screen a failure means the rows
        // are the last good ones, so it reads as a warning, not as an error
        // that hides the data.
        failureText !== undefined
          ? h(
              'div',
              { className: 'dsh-gou-note', 'data-kind': snapshot === undefined ? 'error' : 'warn' },
              snapshot === undefined ? failureText : `${t('stale')} ${failureText}`,
              ' ',
              h(
                'button',
                { type: 'button', className: 'dsh-gou-button', onClick: onRefresh, disabled: refreshing },
                t('error.retry'),
              ),
            )
          : snapshot !== undefined && snapshot.stale === true
            ? h('div', { className: 'dsh-gou-note', 'data-kind': 'warn' }, t('stale'))
            : null,

        h(
          'div',
          { className: 'dsh-gou-foot' },
          h('span', null, updated),
          h(
            'span',
            { className: 'dsh-gou-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-gou-button',
                onClick: onRefresh,
                disabled: refreshing,
                title: t('hint'),
              },
              refreshing ? t('refreshing') : t('refresh'),
            ),
          ),
        ),
      )
    }

    /** The dock capsule. Renders nothing until a key is configured. */
    function GoUsagePill({ t }) {
      const { snapshot, error, refreshing, refresh } = useUsage()
      const [open, setOpen] = React.useState(false)
      const [now, setNow] = React.useState(() => Date.now())
      const rootRef = React.useRef(null)
      const buttonRef = React.useRef(null)
      const panelRef = React.useRef(null)
      const anchorName = React.useMemo(() => `--dsh-gou-${Math.random().toString(36).slice(2, 8)}`, [])

      // A live countdown only costs anything while the panel is open.
      React.useEffect(() => {
        if (!open) return undefined
        setNow(Date.now())
        const timer = setInterval(() => setNow(Date.now()), 1_000)
        return () => clearInterval(timer)
      }, [open])

      // Move focus into the open panel so its Refresh button is reachable with
      // the keyboard; a plain click leaves no visible ring on the panel.
      React.useEffect(() => {
        if (open) panelRef.current?.focus()
      }, [open])

      // Outside pointerdown or click closes, as do Escape and a sibling
      // trigger; the portaled panel counts as inside.
      React.useEffect(() => {
        if (!open) return undefined
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          setOpen(false)
          buttonRef.current?.focus()
        }
        const onPointerDown = (event) => {
          if (rootRef.current?.contains(event.target) === true) return
          if (panelRef.current?.contains(event.target) === true) return
          setOpen(false)
        }
        const onClick = (event) => {
          if (rootRef.current?.contains(event.target) === true) return
          if (panelRef.current?.contains(event.target) === true) return
          setOpen(false)
        }
        document.addEventListener('keydown', onKeyDown)
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('click', onClick, true)
        return () => {
          document.removeEventListener('keydown', onKeyDown)
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('click', onClick, true)
        }
      }, [open])

      // A window whose reset instant has passed re-reads once, so the row never
      // sits at "resets in 0s" until the next scheduled poll.
      const resetHandled = React.useRef(0)
      React.useEffect(() => {
        if (!open || snapshot === undefined) return
        let latest = 0
        for (const name of WINDOWS) {
          const reading = snapshot.windows[name]
          if (reading?.resetsAt == null) continue
          const at = Date.parse(reading.resetsAt)
          if (Number.isFinite(at) && at <= now && at > latest) latest = at
        }
        if (latest !== 0 && latest !== resetHandled.current) {
          resetHandled.current = latest
          refresh()
        }
      }, [open, snapshot, now, refresh])

      // No key means no OpenCode Go account here: stay out of the dock rather
      // than show a permanent placeholder. Polling keeps running, so the
      // capsule appears as soon as a key is configured. A first read in flight
      // is not a failure either, so the capsule stays hidden until it lands.
      if (snapshot === undefined && (error === undefined || error.code === 'missing-credential')) return null

      const windowName = snapshot === undefined ? 'rolling' : snapshot.tightest
      const tightest = snapshot === undefined ? undefined : snapshot.windows[windowName]
      const tone = tightest === undefined ? 'error' : toneOf(tightest)
      const value = tightest === undefined ? '—' : `${tightest.remaining}%`
      const aria =
        tightest === undefined
          ? t('pill.errorAria')
          : t('pill.aria', { left: tightest.remaining, window: t(`window.${windowName}`) })

      const label = h(
        'span',
        { className: 'dsh-gou-anchor', ref: rootRef, style: { anchorName } },
        h(
          'button',
          {
            type: 'button',
            ref: buttonRef,
            className: 'dsh-gou-pill',
            'aria-haspopup': 'dialog',
            'aria-expanded': open,
            'aria-label': aria,
            title: aria,
            onClick: () => setOpen((current) => !current),
          },
          tightest === undefined
            ? h(Ring, { remaining: 0, tone: 'error' })
            : h(Ring, { remaining: tightest.remaining, tone }),
          h('span', null, t('pill.label')),
          h('span', { className: 'dsh-gou-value', 'data-tone': tone }, value),
        ),
      )

      return h(
        React.Fragment,
        null,
        h('style', null, CSS),
        label,
        open
          ? ReactDOM.createPortal(
              h(UsagePanel, {
                anchorName,
                panelRef,
                snapshot,
                error,
                refreshing,
                onRefresh: refresh,
                t,
                now,
              }),
              document.body,
            )
          : null,
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(
          () => ctx.locale.register(NS, { en: COPY.en, zh: COPY.zh }),
          'opencode-go-usage: dictionaries',
        )
        // A fresh id adds one capsule beside the shipped `activity` and `usage`
        // readings instead of replacing either of them.
        ctx.slots.inject(DOCK, () =>
          ctx.slots.register({ name: DOCK, id: 'opencode-go-usage', order: 2, locale: NS }, GoUsagePill),
        )
      },
    }
  },
})
