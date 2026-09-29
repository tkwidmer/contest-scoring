import { useState } from 'react'
import type { PostgrestError } from '@supabase/supabase-js'
import { friendly } from './errors'

// Write-then-reload helper for the contest pages (their data is small enough to refetch whole).
export function useWrites(reload: () => Promise<unknown>, setError: (msg: string) => void) {
  const [busy, setBusy] = useState(false)

  // Run writes in parallel, surface the first error, reload. Resolves true when everything saved.
  async function run(...writes: PromiseLike<{ error: PostgrestError | null }>[]) {
    setBusy(true)
    const results = await Promise.all(writes)
    const failed = results.find(r => r.error)?.error
    setError(failed ? friendly(failed) : '')
    await reload()
    setBusy(false)
    return !failed
  }

  // Blur-to-save fields: if the database rejects the value, put the saved value back so the screen never lies.
  async function saveField(el: HTMLInputElement, saved: string | number | null, write: () => Promise<boolean>) {
    if (!(await write())) el.value = saved == null ? '' : String(saved)
  }

  return { busy, run, saveField }
}
