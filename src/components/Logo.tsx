import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { friendly } from '../lib/errors'
import { buttonQuiet, label } from './ui'

const url = (path: string) => supabase.storage.from('logos').getPublicUrl(path).data.publicUrl

export function Logo({ path, alt, className = 'h-16' }: { path: string | null | undefined; alt: string; className?: string }) {
  return path ? <img src={url(path)} alt={alt} className={`${className} w-auto max-w-48 object-contain`} /> : null
}

// Uploads to <org id>/<random name> in the public logos bucket (producers only, by storage policy), points the row at it,
// then deletes the file it replaced. Size and type limits are enforced by the bucket.
export function LogoUpload({ title, orgId, table, id, path, onChange }: {
  title: string; orgId: string; table: 'events' | 'contests'; id: string; path: string | null; onChange: () => void
}) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(next: string | null, file?: File) {
    setBusy(true); setError('')
    const bucket = supabase.storage.from('logos')
    const write = async () => {
      if (file) { const { error } = await bucket.upload(next!, file); if (error) return error }
      const { error } = await supabase.from(table).update({ logo_path: next }).eq('id', id)
      if (error) return error
      if (path) return (await bucket.remove([path])).error
    }
    const failed = await write()
    if (failed) setError(friendly(failed)); else onChange()
    setBusy(false)
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Logo path={path} alt={title} />
      <label className="grid gap-1">
        <span className={label}>{title}</span>
        <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} className="text-sm"
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) save(`${orgId}/${crypto.randomUUID()}`, f) }} />
      </label>
      {path && <button type="button" className={buttonQuiet} disabled={busy} onClick={() => save(null)}>Remove</button>}
      <span className="text-xs text-muted">PNG, JPEG or WebP, up to 1 MB.</span>
      {error && <p role="alert" className="w-full text-sm text-danger">{error}</p>}
    </div>
  )
}
