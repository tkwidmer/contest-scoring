// Parsing a pasted list of people (from a spreadsheet, one per line, tab- or comma-separated).
// Contestants: [number,] name[, represents][, email]. Judges: name[, email]. Any field with an @ is the email;
// a leading whole number is the contestant number. Header rows ("Name", "Contestant", "Judge") are skipped.
export type PastedContestant = { number: number | null; display_name: string; represents: string | null; email: string | null }
export type PastedJudge = { name: string; email: string | null }

const HEADERS = new Set(['name', 'contestant', 'contestants', 'judge', 'judges', '#', 'number', 'no.'])

function rows(text: string) {
  return text.split(/\r?\n/)
    .map(line => line.split(line.includes('\t') ? '\t' : ',').map(f => f.trim()).filter(Boolean))
    .filter(f => f.length && !HEADERS.has(f[0]!.toLowerCase()))
}

export function parseContestants(text: string): PastedContestant[] {
  return rows(text).flatMap(fields => {
    const email = fields.find(f => f.includes('@')) ?? null
    let rest = fields.filter(f => f !== email)
    const number = rest[0] && /^\d+$/.test(rest[0]) ? Number(rest[0]) : null
    if (number != null) rest = rest.slice(1)
    return rest[0] ? [{ number, display_name: rest[0], represents: rest[1] ?? null, email }] : []
  })
}

export function parseJudges(text: string): PastedJudge[] {
  return rows(text).flatMap(fields => {
    const email = fields.find(f => f.includes('@')) ?? null
    const name = fields.find(f => f !== email)
    return name ? [{ name, email }] : []
  })
}
