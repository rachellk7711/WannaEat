import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { allCriteria, allSubgroups, chooseCriterion, chooseSubgroup, effectiveSelections, matchesSearch, parsePreferences, parseRelease, validSelection } from '../src/domain/catalog.ts'
import ruleSnapshot from '../src/analysis-rules.snapshot.json' with { type: 'json' }
import { analyzeIngredients, parseRuleSet } from '../src/domain/analysis.ts'

const { catalog, rulesetVersion } = parseRelease(JSON.parse(readFileSync(new URL('../src/catalog.snapshot.json', import.meta.url), 'utf8')))
const rules = parseRuleSet(ruleSnapshot)

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

test('deterministic label analysis respects direct, inferred, excluded and opaque evidence', () => {
  const selected = new Map([['wheat', 'avoid'] as const, ['soy_oil', 'inform'] as const, ['sugar', 'avoid'] as const])
  const result = analyzeIngredients('박력분, 식용유지(대두유), 복합조미식품, 무설탕', catalog, selected, rules)
  const finding = (id: string) => result.findings.find(item => item.criterionId === id)!
  assert.equal(finding('wheat').state, 'found')
  assert.deepEqual(finding('wheat').tokens, ['박력분'])
  assert.equal(finding('soy_oil').state, 'found')
  assert.deepEqual(finding('soy_oil').tokens, ['대두유'])
  assert.equal(finding('sugar').state, 'unreadable')
  assert.deepEqual(result.opaqueTokens, ['복합조미식품'])
})

test('excluded lookalikes cannot create a wheat finding', () => {
  const result = analyzeIngredients('메밀가루, 밀크향', catalog, new Map([['wheat', 'avoid'] as const]), rules)
  assert.equal(result.findings[0].state, 'none')
})

test('text extracted from a real label photo produces the expected findings', () => {
  // 실제 추출 결과(테스트 라벨 사진 → extract-ingredients 함수 응답)를 그대로 고정한다.
  const label = '밀가루(밀:미국산), 백설탕, 가공유지(대두유, 팜유), 귀리후레이크 12%, 물엿, 전지분유(우유), 합성향료(버터향), 복합조미식품, 정제소금, 팽창제(탄산수소나트륨), 대두레시틴'
  const ids = ['wheat', 'oat', 'sugar', 'soy_oil', 'palm_oil', 'dairy', 'processed_fat', 'animal_fat', 'beef']
  const selected = new Map(ids.map(id => [id, 'avoid' as const]))
  const result = analyzeIngredients(label, catalog, selected, rules)
  const state = (id: string) => result.findings.find(finding => finding.criterionId === id)!.state
  for (const id of ['wheat', 'oat', 'sugar', 'soy_oil', 'palm_oil', 'dairy']) assert.equal(state(id), 'found', id)
  // 가공유지는 어떤 기름인지 표기로 알 수 없고, 향료 표기는 그 원재료가 들었다는 뜻이 아니다.
  assert.equal(state('processed_fat'), 'needs_review')
  assert.equal(state('animal_fat'), 'needs_review')
  // 묶음 표기가 있으면 걸리지 않은 기준은 '없음' 이 아니라 '확인 불가' 다.
  assert.equal(state('beef'), 'unreadable')
  assert.deepEqual(result.opaqueTokens, ['합성향료(버터향)', '복합조미식품'])
})
