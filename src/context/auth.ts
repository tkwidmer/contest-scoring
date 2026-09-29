import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'

// undefined = still loading, null = signed out
export const AuthContext = createContext<Session | null | undefined>(undefined)
export const useSession = () => useContext(AuthContext)
