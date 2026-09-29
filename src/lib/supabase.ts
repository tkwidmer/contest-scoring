import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error('Missing Supabase env. Copy .env.example to .env.local and fill in values from `npm run db:start`.')
}

export const supabase = createClient<Database>(url, key)
