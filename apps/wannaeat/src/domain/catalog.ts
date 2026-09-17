export type Strength = 'avoid' | 'inform'
export const strengthLabels: Record<Strength, string> = { avoid: '피해요', inform: '알려만줘요' }
export type Selection = { kind: 'criterion' | 'subgroup'; id: string; strength: Strength }
export type Preferences = { rulesetVersion: string; selections: Selection[] }
export type Criterion = {
  id: string; name: string; examples: string[]; notMatched: string[]; aliases: string[]
  productsFound: number; includedIn?: string[]; note?: string
}
export type Subgroup = { id: string; name: string; selectAll: boolean; criteria: Criterion[] }
export type Catalog = { version: string; groups: { name: string; subgroups: Subgroup[] }[] }
export type Release = { rulesetVersion: string; catalog: Catalog }

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string')
const nonempty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const validId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9_]+$/.test(v)

export function parseCatalog(value: unknown): Catalog {
  if (!record(value) || !nonempty(value.version) || !Array.isArray(value.groups) || !value.groups.length) throw new Error('카탈로그 형식 오류')
  const ids = new Set<string>(), subgroupIds = new Set<string>()
  const relationships: string[] = []
  for (const group of value.groups) {
    if (!record(group) || !nonempty(group.name) || !Array.isArray(group.subgroups) || !group.subgroups.length) throw new Error('분류 형식 오류')
    for (const sub of group.subgroups) {
      if (!record(sub) || !validId(sub.id) || subgroupIds.has(sub.id) || !nonempty(sub.name) || typeof sub.selectAll !== 'boolean' || !Array.isArray(sub.criteria) || !sub.criteria.length) throw new Error('소분류 형식 오류')
      subgroupIds.add(sub.id)
      for (const c of sub.criteria) {
        if (!record(c) || !validId(c.id) || ids.has(c.id) || !nonempty(c.name) || !strings(c.examples) || !strings(c.notMatched) || !strings(c.aliases) || typeof c.productsFound !== 'number' || !Number.isFinite(c.productsFound) || c.productsFound < 0 || (c.note !== undefined && typeof c.note !== 'string') || (c.includedIn !== undefined && !strings(c.includedIn))) throw new Error('기준 형식 오류')
        ids.add(c.id)
        relationships.push(...(c.includedIn as string[] | undefined ?? []))
      }
    }
  }
  if (relationships.some(id => !ids.has(id))) throw new Error('포함 관계 참조 오류')
  return value as Catalog
}

export function parseRelease(value: unknown): Release {
  if (!record(value) || !nonempty(value.rulesetVersion)) throw new Error('버전 형식 오류')
  return { rulesetVersion: value.rulesetVersion, catalog: parseCatalog(value.catalog) }
}

export function parsePreferences(value: unknown): Preferences {
  if (!record(value) || !nonempty(value.rulesetVersion) || !Array.isArray(value.selections)) throw new Error('저장된 기준 형식 오류')
  const keys = new Set<string>()
  const selections = value.selections.map(row => {
    if (!record(row) || (row.kind !== 'criterion' && row.kind !== 'subgroup') || !validId(row.id) || (row.strength !== 'avoid' && row.strength !== 'inform')) throw new Error('저장된 기준 형식 오류')
    const key = `${row.kind}:${row.id}`
    if (keys.has(key)) throw new Error('중복된 기준')
    keys.add(key)
    return { kind: row.kind, id: row.id, strength: row.strength } as Selection
  })
  return { rulesetVersion: value.rulesetVersion, selections }
}

export const allSubgroups = (catalog: Catalog) => catalog.groups.flatMap(group => group.subgroups)
export const allCriteria = (catalog: Catalog) => allSubgroups(catalog).flatMap(sub => sub.criteria)
export function validSelection(catalog: Catalog, row: Selection) {
  return row.kind === 'criterion' ? allCriteria(catalog).some(c => c.id === row.id)
    : allSubgroups(catalog).some(sub => sub.id === row.id && sub.selectAll)
}

// Explicit criterion choices override a whole-subgroup choice. includedIn is
// descriptive co-occurrence metadata, never a logical selection relationship.
export function effectiveSelections(catalog: Catalog, rows: Selection[]): Map<string, Strength> {
  const result = new Map<string, Strength>()
  for (const sub of allSubgroups(catalog)) {
    const whole = rows.find(row => row.kind === 'subgroup' && row.id === sub.id)
    if (whole && sub.selectAll) for (const c of sub.criteria) result.set(c.id, whole.strength)
  }
  for (const row of rows) if (row.kind === 'criterion' && validSelection(catalog, row)) result.set(row.id, row.strength)
  return result
}

export function chooseSubgroup(catalog: Catalog, rows: Selection[], id: string, strength?: Strength): Selection[] {
  const sub = allSubgroups(catalog).find(s => s.id === id)
  if (!sub?.selectAll) throw new Error('전체 선택할 수 없는 소분류')
  const next = rows.filter(row => !(row.kind === 'subgroup' && row.id === id) && !(row.kind === 'criterion' && sub.criteria.some(c => c.id === row.id)))
  return strength ? [...next, { kind: 'subgroup', id, strength }] : next
}

export function chooseCriterion(catalog: Catalog, rows: Selection[], id: string, strength?: Strength): Selection[] {
  const sub = allSubgroups(catalog).find(s => s.criteria.some(c => c.id === id))
  if (!sub) throw new Error('알 수 없는 기준')
  const whole = rows.find(row => row.kind === 'subgroup' && row.id === sub.id)
  let next = rows.filter(row => !(row.kind === 'criterion' && row.id === id))
  if (!strength && whole) {
    // Removing one inherited item expands its siblings, without inventing an
    // extra strength value or losing overrides that the user already chose.
    const effective = effectiveSelections(catalog, rows)
    next = next.filter(row => !(row.kind === 'subgroup' && row.id === sub.id) && !(row.kind === 'criterion' && sub.criteria.some(c => c.id === row.id)))
    for (const c of sub.criteria) if (c.id !== id && effective.has(c.id)) next.push({ kind: 'criterion', id: c.id, strength: effective.get(c.id)! })
  }
  if (strength && whole?.strength !== strength) next.push({ kind: 'criterion', id, strength })
  return next
}

const normalize = (text: string) => text.toLocaleLowerCase().replace(/\s+/g, '')
export function matchesSearch(c: Criterion, query: string) {
  const q = normalize(query)
  return !q || [c.name, ...c.examples, ...c.aliases].some(text => normalize(text).includes(q))
}
