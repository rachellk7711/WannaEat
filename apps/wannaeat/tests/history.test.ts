import test from 'node:test'
import assert from 'node:assert/strict'
import { addEntry, HISTORY_LIMIT, parseHistory, summarize } from '../src/domain/history.ts'
import type { HistoryEntry } from '../src/domain/history.ts'

const entry = (id: string): HistoryEntry => ({
  id, at: '2026-09-18T01:02:03.000Z', rulesetVersion: '2026-09-18-abc',
  ingredientText: '밀가루, 복합조미식품',
  criteria: [{ id: 'wheat', name: '밀', strength: 'avoid' }, { id: 'beef', name: '소고기', strength: 'inform' }],
  findings: [
    { criterionId: 'wheat', state: 'found', tokens: ['밀가루'], reasons: ['포함:밀가루'] },
    { criterionId: 'beef', state: 'unreadable', tokens: ['복합조미식품'], reasons: ['묶음 표기'] },
  ],
  opaqueTokens: ['복합조미식품'],
})

test('history keeps the newest first, drops repeats and stops at the device limit', () => {
  let list: HistoryEntry[] = []
  for (let n = 0; n < HISTORY_LIMIT + 5; n += 1) list = addEntry(list, entry(`id-${n}`))
  assert.equal(list.length, HISTORY_LIMIT)
  assert.equal(list[0].id, `id-${HISTORY_LIMIT + 4}`)
  const again = addEntry(list, entry(list[3].id))
  assert.equal(again.length, HISTORY_LIMIT)
  assert.equal(again.filter(item => item.id === list[3].id).length, 1)
})

test('a stored entry round-trips with the criteria and results of that moment', () => {
  const stored = parseHistory(JSON.parse(JSON.stringify([entry('one')])))
  assert.deepEqual(stored, [entry('one')])
  assert.deepEqual(summarize(stored[0]), { found: 1, needsReview: 0, unreadable: 1 })
})

test('unreadable history is rejected instead of being silently replaced', () => {
  for (const broken of [{}, [{ ...entry('a'), at: 'not a date' }], [{ ...entry('a'), findings: [{ criterionId: 'wheat', state: '있음', tokens: [], reasons: [] }] }],
    [{ ...entry('a'), criteria: [{ id: 'wheat', name: '밀', strength: '완전 제한' }] }], ['string']]) assert.throws(() => parseHistory(broken))
})
