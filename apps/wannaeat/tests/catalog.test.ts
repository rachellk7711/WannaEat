import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { allCriteria, allSubgroups, chooseCriterion, chooseSubgroup, effectiveSelections, matchesSearch, parsePreferences, parseRelease, validSelection } from '../src/domain/catalog.ts'

const { catalog, rulesetVersion } = parseRelease(JSON.parse(readFileSync(new URL('../src/catalog.snapshot.json', import.meta.url), 'utf8')))

test('subgroup selections preserve child overrides and sibling choices when one is removed', () => {
  const subgroup = allSubgroups(catalog).find(sub => sub.id === 'grains')!
  const sibling = subgroup.criteria.find(c => c.id !== 'wheat')!
  let rows = chooseSubgroup(catalog, [], 'grains', 'avoid')
  assert.deepEqual(rows, [{ kind: 'subgroup', id: 'grains', strength: 'avoid' }])
  assert.equal(effectiveSelections(catalog, rows).size, subgroup.criteria.length)
  rows = chooseCriterion(catalog, rows, sibling.id, 'inform')
  rows = chooseCriterion(catalog, rows, 'wheat')
  const effective = effectiveSelections(catalog, rows)
  assert.equal(effective.has('wheat'), false)
  assert.equal(effective.get(sibling.id), 'inform')
  assert.equal(effective.size, subgroup.criteria.length - 1)
  assert.equal(rows.some(row => row.kind === 'subgroup'), false)
})

test('choosing the subgroup again replaces overrides without duplicate rows', () => {
  let rows = chooseSubgroup(catalog, [], 'grains', 'avoid')
  rows = chooseCriterion(catalog, rows, 'wheat', 'inform')
  rows = chooseCriterion(catalog, rows, 'wheat', 'avoid')
  assert.equal(rows.length, 1)
  rows = chooseCriterion(catalog, rows, 'wheat', 'inform')
  rows = chooseSubgroup(catalog, rows, 'grains', 'inform')
  assert.deepEqual([...new Set(effectiveSelections(catalog, rows).values())], ['inform'])
  assert.equal(rows.length, 1)
  assert.deepEqual(chooseSubgroup(catalog, rows, 'grains'), [])
})

test('heterogeneous subgroups cannot be selected as a whole', () => {
  for (const sub of allSubgroups(catalog).filter(sub => !sub.selectAll)) {
    assert.throws(() => chooseSubgroup(catalog, [], sub.id, 'avoid'))
    assert.equal(validSelection(catalog, { kind: 'subgroup', id: sub.id, strength: 'avoid' }), false)
  }
})

test('empirical inclusion metadata never silently chooses another criterion', () => {
  const child = allCriteria(catalog).find(c => c.includedIn?.length)!
  const effective = effectiveSelections(catalog, chooseCriterion(catalog, [], child.id, 'inform'))
  assert.equal(effective.size, 1)
  for (const parent of child.includedIn!) assert.equal(effective.has(parent), false)
})

test('saved choices round-trip kind/id/strength under one ruleset version', () => {
  const prefs = { rulesetVersion, selections: [{ kind: 'subgroup', id: 'grains', strength: 'avoid' }, { kind: 'criterion', id: 'wheat', strength: 'inform' }] }
  assert.deepEqual(parsePreferences(JSON.parse(JSON.stringify(prefs))), prefs)
  for (const strength of ['소량 허용', 'allow', 'none', '', 1]) assert.throws(() => parsePreferences({ rulesetVersion, selections: [{ kind: 'criterion', id: 'wheat', strength }] }))
  assert.throws(() => parsePreferences({ rulesetVersion, selections: [prefs.selections[0], prefs.selections[0]] }))
  assert.throws(() => parsePreferences([{ name: '밀', strength: '완전 제한' }]))
})

test('removed IDs survive decoding for explicit review, but never expand silently', () => {
  const prefs = parsePreferences({ rulesetVersion: 'previous', selections: [{ kind: 'criterion', id: 'removed_id', strength: 'avoid' }] })
  assert.equal(prefs.selections.length, 1)
  assert.equal(validSelection(catalog, prefs.selections[0]), false)
  assert.equal(effectiveSelections(catalog, prefs.selections).size, 0)
})

test('catalog aliases find wheat without treating excluded milk or buckwheat as wheat', () => {
  const wheat = allCriteria(catalog).find(c => c.id === 'wheat')!
  for (const word of ['밀', '박력분', '소맥분']) assert.equal(matchesSearch(wheat, word), true, word)
  for (const word of ['메밀', '밀크']) assert.equal(matchesSearch(wheat, word), false, word)
})

test('bad catalog references and duplicated IDs reject the whole release', () => {
  const duplicate = structuredClone(catalog)
  duplicate.groups[0].subgroups[0].criteria.push(duplicate.groups[0].subgroups[0].criteria[0])
  assert.throws(() => parseRelease({ rulesetVersion, catalog: duplicate }))
  const broken = structuredClone(catalog)
  broken.groups[0].subgroups[0].criteria[0].includedIn = ['missing_id']
  assert.throws(() => parseRelease({ rulesetVersion, catalog: broken }))
})
