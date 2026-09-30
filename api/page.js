// Link previews. Social sites don't run JavaScript, so for the pages people share (home, pricing, a published
// result) this fills the title, description and preview image into the built index.html. Anything that goes
// wrong falls back to the unmodified page, so the app itself never depends on this.
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function meta(path) {
  const site = 'Tallymaster.top'
  if (path === '/features') return { title: `Features · ${site}`, description: 'Everything your title contest needs: judges scoring on their phones (or paper), live standings, tiebreaks, deductions, public results and a record of every score.' }
  if (path === '/pricing') return { title: `Pricing · ${site}`, description: 'One flat fee per event. What’s left after running costs goes to Desire Unchained Events.' }
  const id = path.match(/^\/r\/([^/]+)$/)?.[1]
  if (id && UUID.test(id)) {
    const url = `${process.env.VITE_SUPABASE_URL}/rest/v1/published_results?select=snapshot&contest_id=eq.${id}`
    const rows = await fetch(url, { headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY } }).then(r => r.json())
    const s = rows?.[0]?.snapshot
    if (s) return {
      title: `${s.contest}: official results`,
      description: s.winner ? `Congratulations to ${s.winner.name}, the new ${s.contest}! Official results from ${s.event}.` : `Official results from ${s.event}.`,
    }
  }
  return { title: `${site}: the tally is done when the last score is in`, description: 'Scoring for leather, bear and bootblack title contests: judges score on their phones, standings update live, and results publish when the last score is in.' }
}

export default async function handler(req, res) {
  const origin = `https://${req.headers['x-forwarded-host'] ?? req.headers.host}`
  const path = new URL(req.url, origin).searchParams.get('path') ?? '/'
  let html = await fetch(`${origin}/index.html`).then(r => r.text())
  try {
    const m = await meta(path)
    const tags = [
      `<meta property="og:site_name" content="Tallymaster.top" />`,
      `<meta property="og:title" content="${esc(m.title)}" />`,
      `<meta property="og:description" content="${esc(m.description)}" />`,
      `<meta property="og:image" content="${origin}/og.png" />`,
      `<meta property="og:url" content="${esc(origin + path)}" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
    ].join('\n    ')
    html = html.replace(/\s*<meta (property="og:|name="twitter:)[^>]*>/g, '') // the home page's defaults
      .replace(/<title>[^<]*<\/title>/, `<title>${esc(m.title)}</title>`)
      .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(m.description)}" />`)
      .replace('</head>', `    ${tags}\n  </head>`)
  } catch { /* serve the plain page */ }
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.setHeader('cache-control', 'public, max-age=0, s-maxage=300')
  res.status(200).send(html)
}
