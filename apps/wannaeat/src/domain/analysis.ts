import type { Catalog, Strength } from './catalog.ts'

type RuleKind = '정확' | '접두' | '접미' | '포함'
type Confidence = '직접' | '추정'
type Rule = { kind: RuleKind; confidence: Confidence; pattern: string }
type CriterionRules = { rules: Rule[]; exclude: string[]; excludeSuffix: string[] }
type OpaqueRule = { kind: '정확' | '접미' | '포함'; pattern: string }
export type RuleSet = { rulesetVersion: string; criteria: Record<string, CriterionRules>; opaque: OpaqueRule[] }
export type FindingState = 'found' | 'needs_review' | 'unreadable' | 'none'
export type Finding = { criterionId: string; state: FindingState; tokens: string[]; reasons: string[] }
export type Analysis = { tokens: string[]; opaqueTokens: string[]; findings: Finding[] }

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const textArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')
const allowedKinds = new Set<RuleKind>(['정확', '접두', '접미', '포함'])
const allowedConfidence = new Set<Confidence>(['직접', '추정'])

export function parseRuleSet(value: unknown): RuleSet {
  if (!record(value) || typeof value.rulesetVersion !== 'string' || !record(value.criteria) || !Array.isArray(value.opaque)) throw new Error('판정 규칙 형식 오류')
  const criteria: Record<string, CriterionRules> = {}
  for (const [id, ruleValue] of Object.entries(value.criteria)) {
    if (!/^[a-z0-9_]+$/.test(id) || !record(ruleValue) || !Array.isArray(ruleValue.rules) || !textArray(ruleValue.exclude) || !textArray(ruleValue.excludeSuffix)) throw new Error('판정 기준 형식 오류')
    const rules = ruleValue.rules.map(rule => {
      if (!record(rule) || !allowedKinds.has(rule.kind as RuleKind) || !allowedConfidence.has(rule.confidence as Confidence) || typeof rule.pattern !== 'string' || !rule.pattern) throw new Error('판정 규칙 형식 오류')
      return rule as Rule
    })
    criteria[id] = { rules, exclude: ruleValue.exclude, excludeSuffix: ruleValue.excludeSuffix }
  }
  const opaque = value.opaque.map(rule => {
    if (!record(rule) || !['정확', '접미', '포함'].includes(String(rule.kind)) || typeof rule.pattern !== 'string' || !rule.pattern) throw new Error('묶음 표기 규칙 오류')
    return rule as OpaqueRule
  })
  return { rulesetVersion: value.rulesetVersion, criteria, opaque }
}

const kindRank: Record<RuleKind, number> = { 정확: 0, 접두: 1, 접미: 1, 포함: 2 }
const confidenceRank: Record<Confidence, number> = { 직접: 0, 추정: 1 }
const flavorPattern = /((향|후레바|후레버|플레이버|에센스|flavou?r)(료|분말|베이스|키베이스|오일|액|유|파우더|[#a-z0-9]*)?|맛(엑기스|분말|오일|베이스|파우더|파우다|[#a-z0-9]*))$/
const seasoning = ['소스', '스프', '다시', '쓰유', '양념', '시즈닝', '씨즈닝', '건더기', '조미', '용액', '베이스']
const flavorCriteria = new Set(['flavor'])

function stripTrailingNumber(value: string) {
  const match = value.match(/\d+(\.\d+)?%?$/)
  if (!match) return value
  const number = match[0], head = value.slice(0, -number.length)
  if (number.endsWith('%') || number.includes('.') || (head && /[A-Za-z]$/.test(head)) || head.endsWith('폴리소르베이트')) return value
  return head
}

export function normalizeIngredient(value: string) {
  return stripTrailingNumber((value || '').split('(')[0].replace(/[\s·ㆍ・/\-‐‑–—_]/g, '').replaceAll('.', '').toLocaleLowerCase()).trim()
}

export function splitIngredients(raw: string) {
  const result: string[] = [], current: string[] = []
  let depth = 0
  for (const char of raw) {
    if ('([{'.includes(char)) depth += 1
    else if (')]}'.includes(char)) depth = Math.max(0, depth - 1)
    if (char === ',' && depth === 0) { if (current.join('').trim()) result.push(current.join('').trim()); current.length = 0 }
    else current.push(char)
  }
  if (current.join('').trim()) result.push(current.join('').trim())
  return result
}

function qualifiers(raw: string) {
  const result: { parent: string; token: string }[] = []
  for (const top of splitIngredients(raw)) for (const match of top.matchAll(/\(([^()]*)\)/g)) for (const part of match[1].split(/[,:]|또는/)) {
    const token = normalizeIngredient(part)
    if (token) result.push({ parent: normalizeIngredient(top), token })
  }
  return result
}

function hasRule(kind: RuleKind, pattern: string, token: string) {
  return kind === '정확' ? token === pattern : kind === '접두' ? token.startsWith(pattern) : kind === '접미' ? token.endsWith(pattern) : token.includes(pattern)
}

function isFlavor(token: string) { return flavorPattern.test(token) && !token.includes('향신') }

function findInToken(token: string, rules: RuleSet) {
  const flavor = isFlavor(token), seasoningContext = seasoning.some(word => token.includes(word))
  const hits: { criterionId: string; confidence: Confidence; reason: string }[] = []
  for (const [criterionId, criterionRules] of Object.entries(rules.criteria)) {
    if (criterionRules.exclude.some(pattern => token.includes(pattern)) || criterionRules.excludeSuffix.some(pattern => token.endsWith(pattern))) continue
    let best: Rule | undefined
    for (const rule of criterionRules.rules) {
      if (rule.confidence === '추정' && seasoningContext) continue
      if (!hasRule(rule.kind, rule.pattern, token)) continue
      if (!best || [kindRank[rule.kind], confidenceRank[rule.confidence], -rule.pattern.length].join() < [kindRank[best.kind], confidenceRank[best.confidence], -best.pattern.length].join()) best = rule
    }
    if (!best) continue
    const confidence: Confidence = flavor && !flavorCriteria.has(criterionId) ? '추정' : token.includes('또는') ? '추정' : best.confidence
    const prefix = flavor && !flavorCriteria.has(criterionId) ? '향료표기·' : token.includes('또는') ? '또는표기·' : ''
    hits.push({ criterionId, confidence, reason: `${prefix}${best.kind}:${best.pattern}` })
  }
  return hits
}

function opaqueToken(token: string, rules: RuleSet) {
  return rules.opaque.some(rule => rule.kind === '정확' ? token === rule.pattern : rule.kind === '접미' ? token.endsWith(rule.pattern) : token.includes(rule.pattern))
}

export function analyzeIngredients(raw: string, catalog: Catalog, selected: Map<string, Strength>, rules: RuleSet): Analysis {
  const tokenSources = splitIngredients(raw).map(value => ({ source: value, token: normalizeIngredient(value) })).filter(item => item.token)
  for (const qualifier of qualifiers(raw)) tokenSources.push({ source: qualifier.token, token: qualifier.token })
  const matches = new Map<string, { direct: { token: string; reason: string }[]; inferred: { token: string; reason: string }[] }>()
  for (const { source, token } of tokenSources) for (const hit of findInToken(token, rules)) {
    const item = matches.get(hit.criterionId) ?? { direct: [], inferred: [] }
    item[hit.confidence === '직접' ? 'direct' : 'inferred'].push({ token: source, reason: hit.reason })
    matches.set(hit.criterionId, item)
  }
  const opaqueTokens = tokenSources.filter(item => opaqueToken(item.token, rules)).map(item => item.source)
  const catalogIds = new Set(catalog.groups.flatMap(group => group.subgroups).flatMap(subgroup => subgroup.criteria).map(criterion => criterion.id))
  const findings = [...selected.keys()].filter(id => catalogIds.has(id)).map(criterionId => {
    const hit = matches.get(criterionId)
    if (hit?.direct.length) return { criterionId, state: 'found' as const, tokens: [...new Set(hit.direct.map(value => value.token))], reasons: [...new Set(hit.direct.map(value => value.reason))] }
    if (hit?.inferred.length) return { criterionId, state: 'needs_review' as const, tokens: [...new Set(hit.inferred.map(value => value.token))], reasons: [...new Set(hit.inferred.map(value => value.reason))] }
    if (opaqueTokens.length) return { criterionId, state: 'unreadable' as const, tokens: [...new Set(opaqueTokens)], reasons: ['묶음 표기'] }
    return { criterionId, state: 'none' as const, tokens: [], reasons: [] }
  })
  return { tokens: [...new Set(tokenSources.map(item => item.source))], opaqueTokens: [...new Set(opaqueTokens)], findings }
}
