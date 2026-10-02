import { expand } from './analysis.ts'
import type { Finding } from './analysis.ts'
import type { Strength } from './catalog.ts'
import { attachedOrigin, bareCountry, countriesIn, ORIGIN_CHOICES, originWord } from './origin-words.ts'
import type { OriginWord } from './origin-words.ts'

// 원산지 모드 — 라벨에 적힌 원산지를 적힌 그대로 보여준다(2026-10-01 결정).
//  · 비율은 계산하지 않는다. 원산지는 많이 쓴 원료 2~3개에만 의무라 합계를 내면 틀린 숫자가 된다.
//  · `미국산` 을 고른 사람에게 이름 없는 `외국산` 은 발견이라고 하지 않는다. 그것은 「외국산 전체」만 찾는다.

/** 원료 하나에 적힌 원산지. ingredient 는 라벨에 적힌 모양 그대로다(`연육90 %`). */
export type OriginMention = { ingredient: string; label: string; countries: string[]; domestic: boolean; foreign: boolean; product?: boolean }

/** 수입 제품의 「원산지: 태국」 줄을 원재료명과 나눈다. 원재료 판정에 섞이면 `태국` 이 원재료가 된다. */
export function splitProductOrigin(text: string) {
  const products: string[] = []
  const ingredients = text.split(/\r?\n/).filter(line => {
    const match = line.match(/^\s*(원산지|제조국)\s*[:：]?\s*(.*)$/)
    if (match) { if (match[2].trim()) products.push(match[2].trim()); return false }
    return true
  }).join('\n').trim()
  return { ingredients, productOrigin: products.join(', ') }
}

function describe(word: OriginWord, countries: string[], etc: boolean) {
  if (word.foreign && !word.country && countries.length) return `${word.label}: ${countries.join('·')}${etc ? ' 등' : ''}`
  return word.label
}

export function labelOrigins(text: string): OriginMention[] {
  const { ingredients, productOrigin } = splitProductOrigin(text)
  const items = expand(ingredients)
  // 원산지 하나가 어느 원료에 붙었는지. `외국산(미국, 중국 등)` 은 나라들이 같은 자리에 모인다.
  const byItem = new Map<number, { ingredient: string; word: OriginWord; countries: string[]; etc: boolean }>()
  items.forEach((item, index) => {
    const whole = originWord(item.token)
    if (whole) {
      const owner = items[item.parentIndex]
      if (owner) byItem.set(index, { ingredient: owner.raw || owner.token, word: whole, countries: whole.country ? [whole.country] : [], etc: false })
      return
    }
    const attached = attachedOrigin(item.token)
    if (attached && attached.ingredient) {
      byItem.set(index, { ingredient: attached.ingredient, word: attached.word, countries: attached.word.country ? [attached.word.country] : [], etc: false })
      return
    }
    // 나라 이름만 있는 것은 `외국산(…)` 안에서만 원산지다 — `이집트콩` · `브라질넛` 은 원산지가 아니다.
    const country = bareCountry(item.token)
    const holder = byItem.get(item.parentIndex)
    if (country && holder && holder.word.foreign && !holder.word.country) {
      if (!holder.countries.includes(country)) holder.countries.push(country)
      if (item.token.endsWith('등')) holder.etc = true
    }
  })
  const mentions: OriginMention[] = [...byItem.values()].map(entry => ({
    ingredient: entry.ingredient.replace(/\s+/g, ' ').trim(), label: describe(entry.word, entry.countries, entry.etc),
    countries: entry.countries, domestic: !!entry.word.domestic, foreign: !!entry.word.foreign,
  }))
  const product = countriesIn(productOrigin)
  if (product.length) mentions.unshift({
    ingredient: '제품', label: product.map(word => word.label).join('·'), product: true,
    countries: product.flatMap(word => word.country ? [word.country] : []), domestic: product.some(word => word.domestic), foreign: product.some(word => word.foreign),
  })
  return mentions
}

export const originName = (id: string) => ORIGIN_CHOICES.find(choice => choice.id === id)?.name ?? id
export const mentionText = (mention: OriginMention) => mention.product ? `제품 원산지 ${mention.label}` : `${mention.ingredient} (${mention.label})`

/** 고른 원산지마다 라벨에서 찾은 원료를 모은다. 판정 결과와 같은 모양이라 화면과 이력이 그대로 쓴다. */
export function originFindings(mentions: OriginMention[], selected: Map<string, Strength>): Finding[] {
  return [...selected.keys()].flatMap(id => {
    const choice = ORIGIN_CHOICES.find(item => item.id === id)
    if (!choice) return []
    const country = 'country' in choice ? choice.country : undefined
    const hits = mentions.filter(mention => country ? mention.countries.includes(country) : mention.foreign)
    return [hits.length
      ? { criterionId: id, state: 'found' as const, tokens: [...new Set(hits.map(mentionText))], reasons: ['원산지'] }
      : { criterionId: id, state: 'none' as const, tokens: [], reasons: [] }]
  })
}
