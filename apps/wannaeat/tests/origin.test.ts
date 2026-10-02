import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chooseOrigin, originSelections, parsePreferences, parseRelease, validSelection } from '../src/domain/catalog.ts'
import ruleSnapshot from '../src/analysis-rules.snapshot.json' with { type: 'json' }
import { analyzeIngredients, parseRuleSet } from '../src/domain/analysis.ts'
import { labelOrigins, originFindings, splitProductOrigin } from '../src/domain/origin.ts'

const { catalog } = parseRelease(JSON.parse(readFileSync(new URL('../src/catalog.snapshot.json', import.meta.url), 'utf8')))
const rules = parseRuleSet(ruleSnapshot)
const pairs = (text: string) => labelOrigins(text).map(mention => `${mention.ingredient}=${mention.label}`)

// 아래 표기는 data/review/labels 의 실제 라벨에서 옮겼다.
test('origins in brackets belong to the ingredient they follow', () => {
  assert.deepEqual(pairs('딸기(국산)50%, 알룰로스, 펙틴, 구연산'), ['딸기50%=국산'])
  assert.deepEqual(pairs('과자[밀가루(밀:미국산), 쇼트닝1[동물성유지(호주산), 식물성유지]]'), ['밀가루=미국산', '동물성유지=호주산'])
  assert.deepEqual(pairs('건조크랜베리루비[미국산/크랜베리, 설탕, 구연산]'), ['건조크랜베리루비=미국산'])
  assert.deepEqual(pairs('대파기름 0.7%{유기농압착콩기름(대두 100%:러시아산/유기), 파후레이크(국산)}'), ['유기농압착콩기름=러시아산', '파후레이크=국산'])
  assert.deepEqual(pairs('정제소금[해수(국산), 천일염(호주산)]'), ['해수=국산', '천일염=호주산'])
  assert.deepEqual(pairs('위스키 원액(원액농도 59.8%, 영국산위스키), 정제수'), ['위스키=영국산'])
})

test('countries listed under 외국산 are collected on that ingredient', () => {
  const fish = labelOrigins('연육90 %[외국산(미국, 중국, 베트남 등)]/어육살, 설탕')
  assert.equal(fish.length, 1)
  assert.equal(fish[0].ingredient, '연육90 %')
  assert.deepEqual(fish[0].countries, ['미국', '중국', '베트남'])
  assert.equal(fish[0].label, '외국산: 미국·중국·베트남 등')
  // 하이픈으로 붙은 것 — 정규화하면 `대두외국산` 한 낱말이 된다.
  const soy = labelOrigins('원액두유[대두-외국산(미국, 캐나다, 호주 등)], 정제수')
  assert.equal(soy[0].ingredient, '대두')
  assert.deepEqual(soy[0].countries, ['미국', '캐나다', '호주'])
})

test('country names inside ingredient names are not origins', () => {
  for (const text of ['이집트콩씨앗', '브라질넛견과', '동치미국물', '한우사태국거리', '켄터키시즈닝', '인도네시아만델링', '구연산', '사과산', '중국당귀뿌리'])
    assert.deepEqual(pairs(text), [], text)
  // 긴 이름 먼저 — 중국산은 국산이 아니고, 인도네시아산은 인도산이 아니다.
  assert.deepEqual(labelOrigins('마늘(중국산)')[0].countries, ['중국'])
  assert.equal(labelOrigins('마늘(중국산)')[0].domestic, false)
  assert.deepEqual(labelOrigins('커피(인도네시아산)')[0].countries, ['인도네시아'])
})

test('the product origin line is kept apart from the ingredients', () => {
  assert.deepEqual(splitProductOrigin('가다랑어 72.28%, 정제수, 정제소금\n원산지: 태국'), { ingredients: '가다랑어 72.28%, 정제수, 정제소금', productOrigin: '태국' })
  const tuna = labelOrigins('가다랑어 72.28%, 정제수, 정제소금\n원산지: 태국')
  assert.deepEqual(tuna.map(mention => [mention.ingredient, mention.label, mention.product]), [['제품', '태국', true]])
  assert.deepEqual(labelOrigins('설탕, 밀가루\n원산지: 별도 표기'), [])
})

test('a chosen country is found by name, and 외국산 전체 also takes unnamed 외국산', () => {
  const mentions = labelOrigins('쌀(수입산), 고춧가루(중국산), 사과농축액(국내산)')
  const findings = originFindings(mentions, new Map([['origin_cn', 'avoid'], ['origin_us', 'avoid'], ['origin_foreign', 'inform']]))
  const by = Object.fromEntries(findings.map(finding => [finding.criterionId, finding]))
  assert.deepEqual(by.origin_cn.tokens, ['고춧가루 (중국산)'])
  assert.equal(by.origin_us.state, 'none')
  assert.deepEqual(by.origin_foreign.tokens, ['쌀 (수입산)', '고춧가루 (중국산)'])
})

test('origin words are not read as misread ingredients', () => {
  const selected = new Map([...Object.keys(rules.criteria)].map(id => [id, 'avoid' as const]))
  const result = analyzeIngredients('연육90 %[외국산(미국, 중국, 베트남 등)], 정제소금(중국산), 쌀(국내산), 감자전분(폴란드산)', catalog, selected, rules)
  const review = result.findings.filter(finding => finding.state === 'needs_review').flatMap(finding => finding.tokens)
  assert.deepEqual(review.filter(token => /산$|등$|미국|중국|베트남/.test(token)), [])
})

test('origin choices are saved with the other criteria', () => {
  let rows = chooseOrigin([], 'origin_cn', 'avoid')
  rows = chooseOrigin(rows, 'origin_foreign', 'inform')
  const prefs = parsePreferences({ rulesetVersion: 'x', selections: rows })
  assert.ok(prefs.selections.every(row => validSelection(catalog, row)))
  assert.deepEqual([...originSelections(prefs.selections)], [['origin_cn', 'avoid'], ['origin_foreign', 'inform']])
  assert.equal(validSelection(catalog, { kind: 'origin', id: 'origin_xx', strength: 'avoid' }), false)
  assert.deepEqual(chooseOrigin(rows, 'origin_cn'), [{ kind: 'origin', id: 'origin_foreign', strength: 'inform' }])
})

test('the fish cake label as the server actually read it', () => {
  const text = '연육90%[외국산(미국, 중국, 베트남 등)/어육살, 설탕, D-소비톨, 산도조절제], 전분가공품[타피오카전분(베트남산), 감자전분(폴란드산)], 정제소금(중국산), 소스1, 당근'
  assert.deepEqual(pairs(text), ['연육90%=외국산: 미국·중국·베트남 등', '타피오카전분=베트남산', '감자전분=폴란드산', '정제소금=중국산'])
})
