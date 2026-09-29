// Turn Postgres/PostgREST errors into sentences for producers. P0001 messages are already written for people.
export function friendly(e: { code?: string; message: string }): string {
  if (e.code === '23514') return "That value isn't allowed. Max must be above min, min can't be negative, and the range must divide evenly by the step."
  if (e.code === '42501') return "You don't have permission to do that."
  return e.message
}
