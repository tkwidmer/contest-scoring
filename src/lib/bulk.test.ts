import { describe, expect, it } from 'vitest'
import { parseContestants, parseJudges } from './bulk'

describe('pasted lists', () => {
  it('reads contestants from a spreadsheet paste (tabs), skipping the header', () => {
    expect(parseContestants('#\tName\tRepresents\tEmail\n1\tRex Harlan\tMr. Pacific\trex@x.dev\n2\tMarcus Vale\n\n')).toEqual([
      { number: 1, display_name: 'Rex Harlan', represents: 'Mr. Pacific', email: 'rex@x.dev' },
      { number: 2, display_name: 'Marcus Vale', represents: null, email: null },
    ])
  })
  it('reads comma lists, with or without numbers, email anywhere', () => {
    expect(parseContestants('Diego Santos, diego@x.dev\n7, Kai Rivers, Leather Pride')).toEqual([
      { number: null, display_name: 'Diego Santos', represents: null, email: 'diego@x.dev' },
      { number: 7, display_name: 'Kai Rivers', represents: 'Leather Pride', email: null },
    ])
  })
  it('reads judges', () => {
    expect(parseJudges('Name, Email\nJudge Ana, ana@x.dev\nJudge Bo')).toEqual([
      { name: 'Judge Ana', email: 'ana@x.dev' }, { name: 'Judge Bo', email: null },
    ])
  })
})
