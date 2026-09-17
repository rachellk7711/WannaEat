// Run locally or in a protected CI job. This module is never imported by Vite.
import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { createHash } from 'node:crypto'
import { parseRelease } from '../src/domain/catalog.ts'

const env = { ...parseEnv(await readFile(new URL('../../../.env.local', import.meta.url), 'utf8')), ...process.env }
const base = new URL(env.SUPABASE_URL)
if (base.protocol !== 'https:') throw new Error('SUPABASE_URL must use HTTPS')
const secret = env.SUPABASE_SECRET_KEY
if (!secret?.startsWith('sb_secret_')) throw new Error('SUPABASE_SECRET_KEY is required in the root .env.local')
const bucket = 'wannaeat-reference'
const bytes = await readFile(new URL('../src/catalog.snapshot.json', import.meta.url))
const release = parseRelease(JSON.parse(bytes.toString('utf8')))
if (!/^[a-zA-Z0-9._-]+$/.test(release.rulesetVersion)) throw new Error('Invalid version path')
const path = `catalogs/${release.rulesetVersion}.json`
const sha256 = createHash('sha256').update(bytes).digest('hex')
async function request(pathname, options = {}) {
  return fetch(new URL(`/storage/v1/${pathname}`, base), { ...options, headers: { apikey: secret, ...options.headers }, signal: AbortSignal.timeout(20000) })
}
const existingBucket = await request(`bucket/${bucket}`)
if (!existingBucket.ok) {
  // Storage returns 400 with a 404 statusCode for a missing bucket.
  const error = await existingBucket.json().catch(() => ({}))
  if (existingBucket.status !== 404 && String(error.statusCode) !== '404') throw new Error(`Bucket inspection failed: HTTP ${existingBucket.status}`)
  const created = await request('bucket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: bucket, name: bucket, public: true, file_size_limit: 1_048_576, allowed_mime_types: ['application/json'] }) })
  if (!created.ok) throw new Error(`Bucket creation failed: HTTP ${created.status}`)
} else if (!(await existingBucket.json()).public) throw new Error('Existing reference bucket is private; check configuration')

const existing = await request(`object/${bucket}/${path}`)
if (existing.ok) {
  if (createHash('sha256').update(Buffer.from(await existing.arrayBuffer())).digest('hex') !== sha256) throw new Error('Immutable release collision; resync the catalog')
} else {
  const error = await existing.json().catch(() => ({}))
  if (existing.status !== 404 && String(error.statusCode) !== '404') throw new Error(`Release inspection failed: HTTP ${existing.status}`)
  const upload = await request(`object/${bucket}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'cache-control': '31536000', 'x-upsert': 'false' }, body: bytes })
  if (!upload.ok) throw new Error(`Release upload failed: HTTP ${upload.status}`)
}

// Verify the uploaded artifact before switching the current version pointer.
const verify = await fetch(new URL(`/storage/v1/object/public/${bucket}/${path}`, base), { signal: AbortSignal.timeout(20000) })
if (!verify.ok || createHash('sha256').update(Buffer.from(await verify.arrayBuffer())).digest('hex') !== sha256) throw new Error('Published release verification failed')
const manifest = { rulesetVersion: release.rulesetVersion, path, sha256 }
const pointer = await request(`object/${bucket}/catalogs/latest.json`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'cache-control': '60', 'x-upsert': 'true' }, body: JSON.stringify(manifest) })
if (!pointer.ok) throw new Error(`Manifest upload failed: HTTP ${pointer.status}`)
console.log(`Published and verified ${release.rulesetVersion} (${bytes.length} bytes) in ${bucket}`)
