import snapshot from '../catalog.snapshot.json'
import ruleSnapshot from '../analysis-rules.snapshot.json'
import { parseRelease } from '../domain/catalog.ts'
import type { Release } from '../domain/catalog.ts'
import { parseRuleSet } from '../domain/analysis.ts'
import type { RuleSet } from '../domain/analysis.ts'
import { deviceStorage } from './storage.ts'

const CACHE_KEY = 'wannaeat.catalog.v2'
export const bundledRelease = parseRelease(snapshot)
export const bundledRules = parseRuleSet(ruleSnapshot)
if (bundledRules.rulesetVersion !== bundledRelease.rulesetVersion) throw new Error('Bundled catalog and rules differ')
export type CatalogResult = { release: Release; rules: RuleSet; source: 'supabase' | 'cached' | 'bundle' }

function publicKey(key: string) {
  if (key.startsWith('sb_publishable_')) return true
  try {
    const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(payload)).role === 'anon'
  } catch { return false }
}

export async function loadCatalog(): Promise<CatalogResult> {
  let fallback: CatalogResult = { release: bundledRelease, rules: bundledRules, source: 'bundle' }
  try {
    const cached = await deviceStorage.get(CACHE_KEY)
    if (cached) {
      const value = JSON.parse(cached)
      const release = parseRelease(value.release)
      const rules = parseRuleSet(value.rules)
      if (release.rulesetVersion === rules.rulesetVersion) fallback = { release, rules, source: 'cached' }
    }
  } catch { /* Bundled snapshot is usable when caching is unavailable. */ }
  const base = import.meta.env.VITE_SUPABASE_URL || 'https://rnfhcwoqcrdoevabtjku.supabase.co'
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!key) return fallback
  if (!publicKey(key)) {
    console.error('Supabase requires a publishable/anon key. Check .env.local.')
    return fallback
  }
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 5000)
  try {
    const prefix = '/storage/v1/object/public/wannaeat-reference/'
    const endpoint = new URL(`${prefix}catalogs/latest.json`, base)
    if (endpoint.protocol !== 'https:') throw new Error('HTTPS required')
    const options = { headers: { apikey: key }, signal: controller.signal, credentials: 'omit' as const }
    const response = await fetch(endpoint, { ...options, cache: 'no-cache' })
    if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`)
    const manifestText = await response.text()
    if (manifestText.length > 4096) throw new Error('Manifest too large')
    const manifest = JSON.parse(manifestText)
    if (typeof manifest.rulesetVersion !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(manifest.rulesetVersion) || manifest.catalogPath !== `catalogs/${manifest.rulesetVersion}.json` || manifest.rulesPath !== `rules/${manifest.rulesetVersion}.json` || !/^[a-f0-9]{64}$/.test(manifest.catalogSha256) || !/^[a-f0-9]{64}$/.test(manifest.rulesSha256)) throw new Error('Invalid manifest')
    const fetchAsset = async (path: string, checksum: string, label: string) => {
      const file = await fetch(new URL(`${prefix}${path}`, base), options)
      if (!file.ok) throw new Error(`${label} HTTP ${file.status}`)
      const bytes = await file.arrayBuffer()
      if (bytes.byteLength > 1_000_000) throw new Error(`${label} too large`)
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('')
      if (hash !== checksum) throw new Error(`${label} checksum mismatch`)
      return JSON.parse(new TextDecoder().decode(bytes))
    }
    const [catalog, rulesValue] = await Promise.all([fetchAsset(manifest.catalogPath, manifest.catalogSha256, 'Catalog'), fetchAsset(manifest.rulesPath, manifest.rulesSha256, 'Rules')])
    const release = parseRelease(catalog)
    const rules = parseRuleSet(rulesValue)
    if (release.rulesetVersion !== manifest.rulesetVersion) throw new Error('Catalog version mismatch')
    if (rules.rulesetVersion !== manifest.rulesetVersion) throw new Error('Rules version mismatch')
    try { await deviceStorage.set(CACHE_KEY, JSON.stringify({ release, rules })) } catch { /* Cache is optional. */ }
    return { release, rules, source: 'supabase' }
  } catch (error) {
    console.warn('Catalog fetch failed; using a validated local snapshot.', error instanceof Error ? error.message : 'unknown')
    return fallback
  } finally { window.clearTimeout(timer) }
}
