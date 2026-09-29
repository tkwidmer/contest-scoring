import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cellKey, createSaveQueue, type Cell, type QueueState, type SendResult } from './saveQueue'

const cell = (value: number | null, component_id = 'k1'): Cell => ({ judge_id: 'j1', contestant_id: 'c1', component_id, value })

function memoryStorage() {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data }
}

function setup(send: (c: Cell) => Promise<SendResult>, storage = memoryStorage()) {
  const q = createSaveQueue({ storageKey: 'q', send, storage })
  let state!: QueueState
  q.subscribe(s => { state = s })
  return { q, storage, state: () => state }
}

describe('saveQueue', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('debounces and sends only the latest value per cell', async () => {
    const send = vi.fn<(c: Cell) => Promise<SendResult>>(async () => ({ ok: true }))
    const { q, state } = setup(send)
    q.set(cell(7)); q.set(cell(8)); q.set(cell(9, 'k2'))
    expect(state().pending).toBe(2)
    expect(send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(400)
    expect(send.mock.calls.map(c => c[0])).toEqual([cell(8), cell(9, 'k2')])
    expect(state()).toMatchObject({ pending: 0, offline: false })
  })

  it('keeps cells queued and retries with backoff while offline', async () => {
    let online = false
    const send = vi.fn(async (): Promise<SendResult> => (online ? { ok: true } : { ok: false, retry: true, message: 'Failed to fetch' }))
    const { q, state } = setup(send)
    q.set(cell(7))
    await vi.advanceTimersByTimeAsync(400)
    expect(state()).toMatchObject({ pending: 1, offline: true })
    await vi.advanceTimersByTimeAsync(1000) // 1st retry after 1s
    expect(send).toHaveBeenCalledTimes(2)
    online = true
    await vi.advanceTimersByTimeAsync(2000) // 2nd retry after 2s
    expect(state()).toMatchObject({ pending: 0, offline: false })
  })

  it('does not retry rejections; reports them per cell until the cell is edited', async () => {
    const send = vi.fn(async (c: Cell): Promise<SendResult> =>
      c.value! > 10 ? { ok: false, retry: false, message: 'Score must be between 0 and 10' } : { ok: true })
    const { q, state } = setup(send)
    q.set(cell(11))
    await vi.advanceTimersByTimeAsync(400)
    expect(state().pending).toBe(0)
    expect(state().failing.get(cellKey(cell(11)))).toBe('Score must be between 0 and 10')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(send).toHaveBeenCalledTimes(1)
    q.set(cell(9))
    expect(state().failing.size).toBe(0)
  })

  it('survives a reload via storage', async () => {
    const storage = memoryStorage()
    const dead = setup(async () => ({ ok: false, retry: true, message: 'offline' }), storage)
    dead.q.set(cell(7)); dead.q.set(cell(null, 'k2'))
    dead.q.dispose()

    const send = vi.fn<(c: Cell) => Promise<SendResult>>(async () => ({ ok: true }))
    const { state } = setup(send, storage)
    expect(state().pending).toBe(2)
  })

  it('an edit made while a save is in flight is not lost', async () => {
    let release!: () => void
    const send = vi.fn<(c: Cell) => Promise<SendResult>>(() => new Promise<SendResult>(r => { release = () => r({ ok: true }) }))
    const { q, state } = setup(send)
    q.set(cell(7))
    await vi.advanceTimersByTimeAsync(400)
    q.set(cell(8)) // user types again before the first save returns
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(state().pending).toBe(1)
    await vi.advanceTimersByTimeAsync(400)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(send.mock.calls.map(c => c[0].value)).toEqual([7, 8])
    expect(state().pending).toBe(0)
  })

  it('works without storage (private browsing)', async () => {
    const q = createSaveQueue({ storageKey: 'q', send: async () => ({ ok: true }), storage: null })
    q.set(cell(1))
    await vi.advanceTimersByTimeAsync(400)
    expect(q.pendingValues().size).toBe(0)
  })
})
