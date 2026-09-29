// Resilient score saving (design doc 05, "Resilient save"). Edits are queued per cell (latest value wins),
// mirrored to localStorage so a reload or dead battery doesn't lose them, flushed shortly after typing
// stops, and retried with backoff while the venue Wi-Fi is down. Rejections from the database
// (bad value, locked sheet, no permission) are not retried; the cell shows the message instead.

export type Cell = { judge_id: string | null; contestant_id: string; component_id: string; value: number | null } // value null = clear; judge null = producer-entered
export type SendResult = { ok: true } | { ok: false; retry: boolean; message: string }
export type QueueState = { pending: number; failing: Map<string, string>; offline: boolean }

export const cellKey = (c: Pick<Cell, 'judge_id' | 'contestant_id' | 'component_id'>) => `${c.judge_id}|${c.contestant_id}|${c.component_id}`

type Options = {
  storageKey: string
  send: (cell: Cell) => Promise<SendResult>
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
  debounceMs?: number
}

export function createSaveQueue({ storageKey, send, storage = safeLocalStorage(), debounceMs = 400 }: Options) {
  const pending = new Map<string, Cell>(load())
  const failing = new Map<string, string>()
  const listeners = new Set<(s: QueueState) => void>()
  let offline = false
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let flushing = false

  function load(): [string, Cell][] {
    try {
      const raw = storage?.getItem(storageKey)
      return raw ? (JSON.parse(raw) as Cell[]).map(c => [cellKey(c), c]) : []
    } catch {
      return []
    }
  }
  function persist() {
    try { storage?.setItem(storageKey, JSON.stringify([...pending.values()])) } catch { /* private mode: memory only */ }
  }
  function emit() {
    const state = { pending: pending.size, failing: new Map(failing), offline }
    listeners.forEach(l => l(state))
  }
  function schedule(ms: number) {
    clearTimeout(timer)
    timer = setTimeout(flush, ms)
  }

  async function flush() {
    if (flushing || pending.size === 0) return
    flushing = true
    const batch = [...pending.entries()]
    const results = await Promise.all(batch.map(([, cell]) => send(cell).catch((e): SendResult => ({ ok: false, retry: true, message: String(e) }))))
    let transient = false
    batch.forEach(([key, cell], i) => {
      const r = results[i]!
      // Only settle the cell if nobody edited it again while this request was in flight.
      if (pending.get(key) !== cell) return
      if (r.ok) { pending.delete(key); failing.delete(key) }
      else if (r.retry) transient = true
      else { pending.delete(key); failing.set(key, r.message) }
    })
    offline = transient
    attempt = transient ? attempt + 1 : 0
    persist()
    flushing = false
    emit()
    if (transient) schedule(Math.min(30_000, 1000 * 2 ** (attempt - 1)))
    else if (pending.size) schedule(0) // edits that arrived mid-flight
  }

  return {
    set(cell: Cell) {
      const key = cellKey(cell)
      pending.set(key, cell)
      failing.delete(key)
      persist()
      emit()
      schedule(debounceMs)
    },
    flush,
    /** Values still waiting to reach the server, so the UI shows them over (older) server data. */
    pendingValues: () => new Map([...pending].map(([k, c]) => [k, c.value])),
    subscribe(fn: (s: QueueState) => void) {
      listeners.add(fn)
      fn({ pending: pending.size, failing: new Map(failing), offline })
      return () => { listeners.delete(fn) }
    },
    dispose() { clearTimeout(timer) },
  }
}

export type SaveQueue = ReturnType<typeof createSaveQueue>

function safeLocalStorage() {
  try { return window.localStorage } catch { return null }
}
