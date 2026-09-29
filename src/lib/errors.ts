// Turn Postgres/PostgREST errors into sentences for producers. P0001 messages are already written for people.
export function friendly(e: { code?: string; message: string }): string {
  if (e.code === '23514') {
    if (e.message.includes('email')) return "That email address doesn't look right."
    if (e.message.includes('components')) return "That value isn't allowed. Max must be above min, min can't be negative, and the range must divide evenly by the step."
    return "That value isn't allowed."
  }
  if (e.code === '23505') {
    if (e.message.includes('number')) return 'Another contestant already has that number.'
    return 'That already exists.'
  }
  if (e.code === '42501') return "You don't have permission to do that."
  return e.message
}
