import snapshot from '../catalog.snapshot.json'
import { parseRelease } from '../domain/catalog.ts'
import type { Release } from '../domain/catalog.ts'
import { deviceStorage } from './storage.ts'

const CACHE_KEY = 'wannaeat.catalog.v1'
export const bundledRelease = parseRelease(snapshot)
export type CatalogResult = { release: Release; source: 'supabase' | 'cached' | 'bundle' }

function publicKey(key: string) {
  if (key.startsWith('sb_publishable_')) return true
  try {
    const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(payload)).role === 'anon'
  } catch { return false }
}

export async function loadCatalog(): Promise<CatalogResult> {
  let fallback: CatalogResult = { release: bundledRelease, source: 'bundle' }
  try {
    const cached = await deviceStorage.get(CACHE_KEY)
    if (cached) fallback = { release: parseRelease(JSON.parse(cached)), source: 'cached' }
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
    if (typeof manifest.rulesetVersion !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(manifest.rulesetVersion) || manifest.path !== `catalogs/${manifest.rulesetVersion}.json` || !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error('Invalid manifest')
    const file = await fetch(new URL(`${prefix}${manifest.path}`, base), options)
    if (!file.ok) throw new Error(`Catalog HTTP ${file.status}`)
    const bytes = await file.arrayBuffer()
    if (bytes.byteLength > 1_000_000) throw new Error('Catalog too large')
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('')
    if (hash !== manifest.sha256) throw new Error('Catalog checksum mismatch')
    const release = parseRelease(JSON.parse(new TextDecoder().decode(bytes)))
    if (release.rulesetVersion !== manifest.rulesetVersion) throw new Error('Catalog version mismatch')
    try { await deviceStorage.set(CACHE_KEY, JSON.stringify(release)) } catch { /* Cache is optional. */ }
    return { release, source: 'supabase' }
  } catch (error) {
    console.warn('Catalog fetch failed; using a validated local snapshot.', error instanceof Error ? error.message : 'unknown')
    return fallback
  } finally { window.clearTimeout(timer) }
}
