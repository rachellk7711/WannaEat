import { useMemo, useState } from 'react'
import { allCriteria, chooseCriterion, chooseSubgroup, effectiveSelections, matchesSearch, strengthLabels } from '../domain/catalog.ts'
import type { Catalog, Selection, Strength } from '../domain/catalog.ts'

function Choices({ label, value, onChange }: { label: string; value?: Strength; onChange: (value: Strength) => void }) {
  return <div className="strength-options" role="group" aria-label={`${label} 설정`}>
    {(['avoid', 'inform'] as const).map(strength => <button key={strength} type="button" aria-label={`${label} ${strengthLabels[strength]}`} aria-pressed={value === strength} onClick={() => onChange(strength)}>{value === strength && <span aria-hidden="true">✓ </span>}{strengthLabels[strength]}</button>)}
  </div>
}

export default function CriteriaEditor({ catalog, rows, onChange, busy, onSave, review, onCancel }: {
  catalog: Catalog; rows: Selection[]; onChange: (rows: Selection[]) => void; busy: boolean; onSave: () => void; review: string; onCancel: () => void
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('전체')
  const [selectedOnly, setSelectedOnly] = useState(false)
  const effective = useMemo(() => effectiveSelections(catalog, rows), [catalog, rows])
  const criteria = useMemo(() => allCriteria(catalog), [catalog])
  const avoid = [...effective.values()].filter(value => value === 'avoid').length
  const groups = catalog.groups.filter(group => category === '전체' || group.name === category).map(group => ({ ...group, subgroups: group.subgroups.map(sub => ({ ...sub, visible: sub.criteria.filter(c => matchesSearch(c, query) && (!selectedOnly || effective.has(c.id))) })).filter(sub => sub.visible.length) })).filter(group => group.subgroups.length)

  return <>
    <section className="intro"><span className="eyebrow">MY CHECKLIST</span><h1>내가 정하는,<br />나의 식사 기준.</h1><p>확인하고 싶은 원재료를 골라주세요.<br />표시 방식은 언제든 바꿀 수 있어요.</p></section>
    {review && <p className="notice" role="status">{review}</p>}
    <div className="strength-guide"><p><b>피해요</b><span>발견하면 눈에 띄게 표시해요.</span></p><p><b>알려만줘요</b><span>들어 있는지 가볍게 알려줘요.</span></p></div>
    <fieldset disabled={busy} className="criteria-fieldset">
      <div className="search-box"><span aria-hidden="true">⌕</span><input type="search" aria-label="원재료 검색" placeholder="밀, 박력분, 소맥분으로 찾아요" value={query} maxLength={100} onChange={event => { setQuery(event.target.value); setCategory('전체') }} /></div>
      <div className="category-tabs" role="group" aria-label="분류 선택">{['전체', ...catalog.groups.map(group => group.name)].map(name => <button type="button" key={name} aria-pressed={category === name} onClick={() => setCategory(name)}>{name}</button>)}</div>
      <div className="selection-summary"><span>피해요 <b>{avoid}</b> · 알려만줘요 <b>{effective.size - avoid}</b></span><button type="button" aria-pressed={selectedOnly} onClick={() => setSelectedOnly(!selectedOnly)}>{selectedOnly ? '전체 보기' : '선택한 것만'}</button></div>
      {groups.map(group => <section className="catalog-group" key={group.name}><h2>{group.name}</h2>{group.subgroups.map(sub => {
        const whole = rows.find(row => row.kind === 'subgroup' && row.id === sub.id)
        const overrides = whole && sub.criteria.some(c => rows.some(row => row.kind === 'criterion' && row.id === c.id))
        return <section className="subgroup" key={sub.id} aria-label={sub.name}>
          <div className="subgroup-heading"><h3>{sub.name}</h3><span>{sub.criteria.filter(c => effective.has(c.id)).length} / {sub.criteria.length}</span></div>
          {sub.selectAll ? <div className="whole-select"><div className="whole-label"><strong>{sub.name} 전체</strong><small>검색 결과와 관계없이 {sub.criteria.length}개 모두</small></div><Choices label={`${sub.name} 전체`} value={overrides ? undefined : whole?.strength} onChange={strength => onChange(chooseSubgroup(catalog, rows, sub.id, strength))} />{whole && <button className="text-button" type="button" onClick={() => onChange(chooseSubgroup(catalog, rows, sub.id))}>{sub.name} 전체 해제</button>}{overrides && <small className="override-note">개별 변경한 기준이 있어요.</small>}</div> : <p className="subgroup-note">성격이 다른 원재료라 하나씩 골라요.</p>}
          {sub.visible.map(c => {
            const strength = effective.get(c.id)
            const inherited = whole && !rows.some(row => row.kind === 'criterion' && row.id === c.id)
            return <article className={`criterion-row ${strength ? 'chosen' : ''}`} key={c.id}>
              <div className="criterion-heading"><h4>{c.name}</h4>{strength && <button className="text-button" type="button" aria-label={`${c.name} 선택 해제`} onClick={() => onChange(chooseCriterion(catalog, rows, c.id))}>해제</button>}</div>
              <p className="examples">{c.examples.slice(0, 3).join(' · ') || '상세 설명을 확인해 주세요.'}</p>
              <Choices label={c.name} value={strength} onChange={next => onChange(chooseCriterion(catalog, rows, c.id, next))} />
              {inherited && <small className="inherited">{sub.name} 전체 선택에 포함</small>}
              <details><summary>{c.name} 기준 자세히</summary><div className="criterion-detail">{c.note && <p>{c.note}</p>}<p><b>표기 예시</b><br />{c.examples.join(', ') || '등록된 예시가 없어요.'}</p>{c.notMatched.length > 0 && <p><b>이 기준으로 찾지 않는 표기</b><br />{c.notMatched.join(', ')}</p>}{!!c.includedIn?.length && <p><b>함께 나타나는 기준</b><br />{c.includedIn.map(id => criteria.find(item => item.id === id)?.name ?? id).join(', ')}<br />표기가 겹칠 수 있어요. 선택은 각각 유지해요.</p>}</div></details>
            </article>
          })}
        </section>
      })}</section>)}
      {!groups.length && <div className="empty"><strong>{selectedOnly ? '선택한 기준이 없어요.' : '찾는 기준이 아직 없어요.'}</strong><p>{selectedOnly ? '전체 보기에서 원재료를 골라주세요.' : '다른 이름으로 검색하거나 전체 분류를 살펴보세요.'}</p></div>}
    </fieldset>
    <div className="save-bar"><button className="primary" type="button" disabled={busy} onClick={onSave}>{busy ? '저장하는 중…' : review ? '변경된 기준 확인하고 저장' : `${effective.size}개 기준 저장하기`}</button><button className="text-button" type="button" disabled={busy} onClick={onCancel}>변경 취소</button><small>이 기기에 저장돼요 · 목록 {catalog.version}</small></div>
  </>
}
