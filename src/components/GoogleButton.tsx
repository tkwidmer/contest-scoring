import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

// Google's own button (Google Identity Services) signs in with a popup on this origin and hands back an ID token, so the
// account chooser says "continue to tallymaster.top" instead of the Supabase project host that a redirect would show.
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(config: { client_id: string; nonce: string; callback: (response: { credential: string }) => void }): void
          renderButton(parent: HTMLElement, options: { theme: string; size: string; text: string; width: number }): void
        }
      }
    }
  }
}

let script: Promise<void> | undefined
function loadGoogle() {
  script ??= new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = 'https://accounts.google.com/gsi/client'
    el.onload = () => resolve()
    el.onerror = () => reject(new Error('Could not load Google sign-in'))
    document.head.append(el)
  })
  return script
}

// Google gets the SHA-256 of the nonce; Supabase gets the raw nonce and checks it against the token.
async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

export function GoogleButton({ onError }: { onError: (message: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    if (!clientId) throw new Error('Missing VITE_GOOGLE_CLIENT_ID while Google sign-in is enabled in Supabase.')
    const nonce = crypto.randomUUID()
    let live = true
    Promise.all([loadGoogle(), sha256(nonce)]).then(([, hashed]) => {
      const el = ref.current
      if (!live || !el || !window.google) return
      window.google.accounts.id.initialize({
        client_id: clientId,
        nonce: hashed,
        callback: async ({ credential }) => {
          const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: credential, nonce })
          if (error) onError(error.message)
        },
      })
      const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
      window.google.accounts.id.renderButton(el, {
        theme: dark ? 'filled_black' : 'outline', size: 'large', text: 'continue_with', width: Math.min(el.clientWidth, 400),
      })
    }, (e: Error) => onError(e.message))
    return () => { live = false }
  }, [onError])

  return <div ref={ref} className="flex min-h-10 justify-center" />
}
