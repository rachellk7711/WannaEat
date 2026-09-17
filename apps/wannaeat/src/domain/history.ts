import type { Strength } from './catalog.ts'
import type { Finding } from './analysis.ts'

/** 기기 안에만 남는 분석 이력. 사진은 저장하지 않는다. */
export type HistoryCriterion = { id: string; name: string; strength: Strength }
export type HistoryEntry = {
  id: string
  at: string
  rulesetVersion: string
  ingredientText: string
  criteria: HistoryCriterion[]
  findings: Finding[]
  opaqueTokens: string[]
}

export const HISTORY_KEY = 'wannaeat.history.v1'
export const HISTORY_LIMIT = 30
const TEXT_LIMIT = 12_000
const states = new Set(['found', 'needs_review', 'unreadable', 'none'])
const strengths = new Set(['avoid', 'inform'])

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const textArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')

/** 읽을 수 없는 이력은 조용히 덮어쓰지 않는다. 사용자가 지울지 정한다. */
export function parseHistory(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) throw new Error('이력 형식 오류')
  return value.map(entry => {
    if (!record(entry) || typeof entry.id !== 'string' || typeof entry.at !== 'string' || Number.isNaN(Date.parse(entry.at))
      || typeof entry.rulesetVersion !== 'string' || typeof entry.ingredientText !== 'string' || entry.ingredientText.length > TEXT_LIMIT
      || !Array.isArray(entry.criteria) || !Array.isArray(entry.findings) || !textArray(entry.opaqueTokens)) throw new Error('이력 형식 오류')
    const criteria = entry.criteria.map(item => {
      if (!record(item) || typeof item.id !== 'string' || typeof item.name !== 'string' || !strengths.has(String(item.strength))) throw new Error('이력 기준 형식 오류')
      return item as HistoryCriterion
    })
    const findings = entry.findings.map(item => {
      if (!record(item) || typeof item.criterionId !== 'string' || !states.has(String(item.state)) || !textArray(item.tokens) || !textArray(item.reasons)) throw new Error('이력 결과 형식 오류')
      return item as Finding
    })
    return { id: entry.id, at: entry.at, rulesetVersion: entry.rulesetVersion, ingredientText: entry.ingredientText, criteria, findings, opaqueTokens: entry.opaqueTokens }
  })
}

/** 최근 것이 앞에 오고, 기기에는 최근 30건만 남긴다. */
export function addEntry(list: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [entry, ...list.filter(item => item.id !== entry.id)].slice(0, HISTORY_LIMIT)
}

export function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function summarize(entry: HistoryEntry) {
  const count = (state: Finding['state']) => entry.findings.filter(finding => finding.state === state).length
  return { found: count('found'), needsReview: count('needs_review'), unreadable: count('unreadable') }
}

export function formatWhen(at: string) {
  const date = new Date(at)
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}. ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
