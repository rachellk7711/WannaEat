import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { parseCatalog } from '../src/domain/catalog.ts'

const root = new URL('../../../', import.meta.url)
// This is a snapshot, not an edit to Claude's curated data. Resync explicitly.
const bytes = await readFile(new URL('data/prepared/criteria_catalog.json', root))
const catalog = parseCatalog(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')))
const revision = createHash('sha256').update(bytes).digest('hex').slice(0, 12)
const rulesetVersion = `${catalog.version}-${revision}`
const release = { rulesetVersion, catalog }
const target = new URL('../src/catalog.snapshot.json', import.meta.url)
await writeFile(target, JSON.stringify(release) + '\n', 'utf8')
console.log(`Catalog ${rulesetVersion}: ${catalog.groups.length} groups, ${catalog.groups.flatMap(g => g.subgroups).flatMap(s => s.criteria).length} criteria`)
console.log(fileURLToPath(target))
