import { useEffect, useRef } from 'react'
import type { Criterion } from '../domain/catalog.ts'

/** 미니사전 — 음식에서 하는 일, 사람들이 확인하는 이유, 출처. 기준 화면과 결과 화면이 같이 쓴다. */
export function GlossaryBody({ criterion }: { criterion: Criterion }) {
  return <>
    {criterion.role && <p className="glossary-line"><b>음식에서 하는 일</b><span>{criterion.role}</span></p>}
    {criterion.issue && <p className="glossary-line"><b>알아둘 점</b><span>{criterion.issue}</span></p>}
    {!!criterion.sources?.length && <p className="glossary-source">출처 {criterion.sources.map((source, index) => <span key={source.url}>{index > 0 && ' · '}<a href={source.url} target="_blank" rel="noreferrer">{source.label}</a></span>)}{criterion.checked && ` (${criterion.checked} 확인)`}</p>}
  </>
}

/** 결과 카드를 누르면 아래에서 올라오는 설명 창. */
export function GlossarySheet({ criterion, badge, onClose }: { criterion: Criterion; badge?: string; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    close.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return <div className="sheet-backdrop" onClick={onClose}>
    <section className="glossary-sheet" role="dialog" aria-modal="true" aria-labelledby="glossary-title" onClick={event => event.stopPropagation()}>
      <div className="sheet-head"><h2 id="glossary-title">{criterion.name}</h2>{badge && <span className="maybe-strength">{badge}</span>}</div>
      {criterion.what && <p className="sheet-what">{criterion.what}</p>}
      <GlossaryBody criterion={criterion} />
      <button ref={close} className="secondary wide" type="button" onClick={onClose}>닫기</button>
    </section>
  </div>
}
