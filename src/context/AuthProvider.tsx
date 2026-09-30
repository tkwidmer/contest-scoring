import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { AuthContext } from './auth'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    // Fires INITIAL_SESSION immediately, so no separate getSession() call is needed. On sign-in and each app load,
    // claim judge seats and org invites sent to this email before any page reads data, so a direct /judge link works.
    // (Deferred: supabase calls inside this callback can deadlock the auth client.)
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (s && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        setTimeout(() => { supabase.rpc('claim_invites').then(() => setSession(s)) }, 0)
      } else setSession(s)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  return <AuthContext.Provider value={session}>{children}</AuthContext.Provider>
}
