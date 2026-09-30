// Inviting people by email (judges and org members). Both work the same way: the invite is stored against the
// email, and claim_invites() on the dashboard hands it over once they sign in with that address.
import { supabase } from './supabase'
import { friendly } from './errors'

// An ordinary email sign-in link (it also creates their account), landing on the dashboard.
export async function sendSignInLink(email: string): Promise<string> {
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/dashboard` } })
  return error ? friendly(error) : `Sign-in link sent to ${email}.`
}

// Fallback for texting: returns a notice to show.
export async function copyInvite(email: string, what: string): Promise<string> {
  const text = `You've been invited to ${what} on Tallymaster.top. Sign in at ${window.location.origin}/login with ${email}.`
  try {
    await navigator.clipboard.writeText(text)
    return 'Invite copied. Paste it into a text or email.'
  } catch {
    window.prompt('Copy this invite:', text)
    return ''
  }
}
