// Saving one score cell, shared by the producer's score entry and the judge's own sheet.
import { supabase } from './supabase'
import { friendly } from './errors'
import type { Cell, SendResult } from './saveQueue'
import type { TablesInsert } from './database.types'

export type ScoreComponent = { id: string; name: string; min_points: number; max_points: number; step: number }

export const fmt = (n: number) => Number(n.toFixed(2)).toString()

export async function sendCell(c: Cell): Promise<SendResult> {
  const match = { judge_id: c.judge_id, contestant_id: c.contestant_id, component_id: c.component_id }
  const del = supabase.from('scores').delete().eq('contestant_id', c.contestant_id).eq('component_id', c.component_id)
  const { error } = c.value == null
    ? await (c.judge_id == null ? del.is('judge_id', null) : del.eq('judge_id', c.judge_id))
    // contest_id and entered_by are filled in by the database trigger.
    : await supabase.from('scores').upsert({ ...match, value: c.value } as TablesInsert<'scores'>, { onConflict: 'judge_id,contestant_id,component_id' })
  if (!error) return { ok: true }
  // Database/API rejections won't succeed on retry; anything else (no code) is the network.
  const rejected = /^(P0001|2\d{4}|42\d{3}|PGRST)/.test(error.code ?? '')
  return { ok: false, retry: !rejected, message: friendly(error) }
}

// Client-side check mirrors the database trigger so typos are caught before they're queued.
export function problem(v: number, k: ScoreComponent): string | null {
  if (Number.isNaN(v)) return 'Not a number'
  if (v < k.min_points || v > k.max_points || Math.round((v - k.min_points) / k.step * 1e6) % 1e6 !== 0) {
    return `Must be ${fmt(k.min_points)}–${fmt(k.max_points)} in steps of ${fmt(k.step)}`
  }
  return null
}

