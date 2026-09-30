import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export type Role = 'producer' | 'tabulator' | 'judge' | 'none'

// The viewer's role in this contest's organization, or 'judge' for a judge with no org role.
export function useContestRole(contestId: string): Role | null {
  const [role, setRole] = useState<Role | null>(null)
  useEffect(() => {
    (async () => {
      const uid = (await supabase.auth.getUser()).data.user?.id ?? ''
      const c = await supabase.from('contests').select('org_id').eq('id', contestId).maybeSingle()
      if (!c.data) return setRole('none')
      const [m, j] = await Promise.all([
        supabase.from('org_members').select('role').eq('org_id', c.data.org_id).eq('user_id', uid).maybeSingle(),
        supabase.from('judges').select('id').eq('contest_id', contestId).eq('user_id', uid).maybeSingle(),
      ])
      setRole((m.data?.role as Role | undefined) ?? (j.data ? 'judge' : 'none'))
    })()
  }, [contestId])
  return role
}
