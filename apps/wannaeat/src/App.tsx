import { useEffect, useRef, useState } from 'react'
import { Device, fetchAlbumItems, graniteEvent, OpenCameraPermissionError } from '@apps-in-toss/web-framework'
import { allCriteria, effectiveSelections, parsePreferences, validSelection, strengthLabels } from './domain/catalog.ts'
import type { Preferences, Selection } from './domain/catalog.ts'
import { analyzeIngredients } from './domain/analysis.ts'
import { bundledRelease, bundledRules, loadCatalog } from './lib/catalog-loader.ts'
import { deviceId, deviceStorage, isNative, LEGACY_KEY, PREFERENCES_KEY, READS_KEY } from './lib/storage.ts'
import { extractIngredients, imageForExtraction, imageKey, rotateImage } from './lib/extract.ts'
import type { CropArea } from './lib/extract.ts'
import CropBox from './components/CropBox.tsx'
import { addEntry, formatWhen, HISTORY_KEY, newId, parseHistory, summarize } from './domain/history.ts'
import type { HistoryEntry } from './domain/history.ts'
import CriteriaEditor from './components/CriteriaEditor.tsx'
import { BrandMark, Icon, LabelArt } from './components/Brand.tsx'
import './App.css'

type Page = 'home' | 'criteria' | 'image' | 'review' | 'result' | 'history'
const pages: Page[] = ['criteria', 'image', 'review', 'result', 'history']
const readPage = (): Page => pages.find(page => location.hash === `#${page}`) ?? 'home'

function App() {
  const [page, setPage] = useState<Page>(readPage)
  const [release, setRelease] = useState(bundledRelease)
  const [rules, setRules] = useState(bundledRules)
  const [saved, setSaved] = useState<Preferences>({ rulesetVersion: bundledRelease.rulesetVersion, selections: [] })
  const [draft, setDraft] = useState<Selection[]>([])
  const [busy, setBusy] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [readFailed, setReadFailed] = useState(false)
  const [review, setReview] = useState('')
  const [message, setMessage] = useState('')
  const oldRaw = useRef<string | null>(null)
  const [imageUri, setImageUri] = useState<string | null>(null)
  const [imageBusy, setImageBusy] = useState(false)
  const [imageMessage, setImageMessage] = useState('')
  const [consented, setConsented] = useState(false)
  const [crop, setCrop] = useState<CropArea | null>(null)
  const [pending, setPending] = useState<{ base64: string; mimeType: string; preview: string } | null>(null)
  const [extractBusy, setExtractBusy] = useState(false)
  const [ingredientText, setIngredientText] = useState('')
  const [analysisMessage, setAnalysisMessage] = useState('')
  const [analysis, setAnalysis] = useState<ReturnType<typeof analyzeIngredients> | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyMessage, setHistoryMessage] = useState('')
  const [openEntry, setOpenEntry] = useState<string | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [closed, setClosed] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const heading = useRef<HTMLDivElement>(null)
  const catalog = release.catalog
  const effective = effectiveSelections(catalog, saved.selections)
  const selected = allCriteria(catalog).filter(c => effective.has(c.id))
  const avoid = [...effective.values()].filter(strength => strength === 'avoid').length
  const named = (id: string) => allCriteria(catalog).find(item => item.id === id)?.name ?? id
  // 결과는 걸린 것부터 보여준다. 고른 기준을 그대로 나열하면 정작 중요한 것이 묻힌다.
  const shown = (state: string, strength?: string) => (analysis?.findings ?? [])
    .filter(finding => finding.state === state && (!strength || effective.get(finding.criterionId) === strength))
  // 「들었을 수 있어요」 — 라벨에 보이는 글자를 앞에 두고, 무엇이 왜 들었을 수 있는지 한 줄로 말한다.
  const shortName = (id: string) => named(id).replace(/\(.*?\)/g, '').trim()
  // 레시틴은 콩 자체가 아니라 콩에서 뽑은 성분이다. "대두가 들었다" 보다 "원료로 대두를 썼다" 가 사실에 맞다.
  const object = (word: string) => {
    const code = word.charCodeAt(word.length - 1)
    return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 === 0 ? `${word}를` : `${word}을`
  }
  const maybe = () => {
    const byToken = new Map<string, { kind: 'flavor' | 'either' | 'plain' | 'typo'; ids: string[]; corrected?: string }>()
    for (const finding of shown('needs_review')) for (const item of finding.evidence ?? finding.tokens.map(token => ({ token, reason: '' }))) {
      const entry = byToken.get(item.token) ?? (item.reason.startsWith('오독:') ? { kind: 'typo' as const, ids: [], corrected: item.reason.slice(3) }
        : { kind: item.reason.startsWith('향료표기') ? 'flavor' as const : item.reason.startsWith('또는표기') ? 'either' as const : 'plain' as const, ids: [] })
      if (!entry.ids.includes(finding.criterionId)) entry.ids.push(finding.criterionId)
      byToken.set(item.token, entry)
    }
    // 피해요가 걸린 표기를 먼저 보여준다.
    const avoids = (ids: string[]) => ids.some(id => effective.get(id) === 'avoid') ? 0 : 1
    return [...byToken].sort((a, b) => avoids(a[1].ids) - avoids(b[1].ids))
  }
  // 강도가 하나면 그대로, 섞여 있으면 어느 기준이 어느 강도인지 이름을 붙인다.
  const strengthBadge = (ids: string[]) => {
    const labels = ids.map(id => strengthLabels[effective.get(id) ?? 'inform'])
    return new Set(labels).size === 1 ? labels[0] : ids.map((id, index) => `${shortName(id)} ${labels[index]}`).join(' · ')
  }
  // 표기와 기준의 관계는 세 가지다. 한 문장으로 다 쓰면 "가공유지 — 원료로 쇼트닝을 썼을 수 있어요" 처럼 어색해진다.
  //  · 무엇으로 만들었나  레시틴 → 원료로 대두를 썼을 수 있어요
  //  · 그것 자체일 수 있다 가공유지 → 쇼트닝·마가린일 수 있어요
  //  · 그 용도로 썼다     토코페롤 → 산화방지제로 쓰였을 수 있어요
  const isKind = new Set(['processed_fat', 'other_veg_oil', 'animal_fat', 'syrup', 'other_meat'])
  const asRole = new Set(['preservative', 'antioxidant', 'colorant'])
  const toward = (word: string) => {
    const code = word.charCodeAt(word.length - 1)
    if (code < 0xac00 || code > 0xd7a3) return `${word}로`
    const last = (code - 0xac00) % 28
    return last === 0 || last === 8 ? `${word}로` : `${word}으로`
  }
  const maybeLine = (kind: 'flavor' | 'either' | 'plain' | 'typo', ids: string[], corrected?: string) => {
    const names = (list: string[]) => list.map(shortName).join(', ')
    // 사진에서 글자를 잘못 읽었을 수 있다 — 고친 표기를 보여주고 그것이 무엇인지 말한다.
    if (kind === 'typo') return `${object(corrected ?? '')} 잘못 읽었을 수 있어요. ${names(ids)}일 수 있어요.`
    if (kind === 'flavor') return `향 이름이에요. 원료로 ${object(names(ids))} 실제로 썼는지는 알 수 없어요.`
    const made = ids.filter(id => !isKind.has(id) && !asRole.has(id)), same = ids.filter(id => isKind.has(id)), role = ids.filter(id => asRole.has(id))
    const sentences = [
      made.length ? `원료로 ${object(names(made))} 썼을 수 있어요.` : '',
      same.length ? `${names(same)}일 수 있어요.` : '',
      role.length ? `${toward(names(role))} 쓰였을 수 있어요.` : '',
    ].filter(Boolean).join(' ')
    return kind === 'either' ? `둘 중 무엇인지 적혀 있지 않아요. ${sentences}` : sentences
  }
  const cards = (list: { criterionId: string; tokens: string[] }[]) => list.map(finding =>
    <article className="finding" key={finding.criterionId}>
      <h3>{named(finding.criterionId)}</h3>
      {finding.tokens.length > 0 && <p>{finding.tokens.slice(0, 4).join(' · ')}{finding.tokens.length > 4 ? ` 외 ${finding.tokens.length - 4}개` : ''}</p>}
    </article>)

  useEffect(() => {
    let active = true
    async function initialize() {
      try {
        const [{ release: current, rules: currentRules }, raw, legacy] = await Promise.all([loadCatalog(), deviceStorage.get(PREFERENCES_KEY), deviceStorage.get(LEGACY_KEY)])
        if (!active) return
        setRelease(current)
        setRules(currentRules)
        let prefs: Preferences = { rulesetVersion: current.rulesetVersion, selections: [] }
        oldRaw.current = raw
        if (raw) {
          try {
            prefs = parsePreferences(JSON.parse(raw))
            const missing = prefs.selections.filter(row => !validSelection(current.catalog, row))
            if (prefs.rulesetVersion !== current.rulesetVersion || missing.length) setReview(`기준 목록이 업데이트됐어요. 전체 선택에 포함되는 항목과 개별 설정을 확인한 뒤 저장해 주세요.${missing.length ? ` 현재 목록에서 사용할 수 없는 항목: ${missing.map(row => row.id).join(', ')}. 저장하면 이 항목은 제외돼요.` : ''}`)
          } catch { setReview('이전에 저장한 기준을 읽을 수 없어요. 기준을 다시 골라 저장해 주세요. 기존 기록은 별도로 보관해요.') }
        } else if (legacy) setReview('예전 이름 기반 설정을 새 기준으로 바꿔주세요. 피해요 / 알려만줘요를 직접 고른 뒤 저장해 주세요. 예전 기록은 유지돼요.')
        setSaved(prefs)
        setDraft(prefs.selections.filter(row => validSelection(current.catalog, row)))
      } catch {
        if (active) { setReadFailed(true); setMessage('저장된 기준을 불러오지 못했어요. 다시 불러와 주세요.') }
      } finally { if (active) { setBusy(false); setLoaded(true) } }
    }
    void initialize()
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    deviceStorage.get(HISTORY_KEY).then(raw => {
      if (!active || !raw) return
      try { setHistory(parseHistory(JSON.parse(raw))) }
      // 읽을 수 없는 이력은 조용히 덮어쓰지 않는다.
      catch { setHistoryMessage('이 기기에 저장된 이력을 읽을 수 없어요. 지우고 다시 시작할 수 있어요.') }
    }).catch(() => { if (active) setHistoryMessage('이 기기의 이력을 불러오지 못했어요.') })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const update = () => { setPage(readPage()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])

  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
    if (!isNative || page === 'home') return
    const goHome = () => { location.hash = ''; setPage('home') }
    const offBack = graniteEvent.addEventListener('backEvent', { onEvent: goHome })
    const offHome = graniteEvent.addEventListener('homeEvent', { onEvent: goHome })
    return () => { offBack(); offHome() }
  }, [page])

  useEffect(() => () => { if (imageUri?.startsWith('blob:')) URL.revokeObjectURL(imageUri) }, [imageUri])

  function go(next: Page) {
    setMessage('')
    if (next === 'criteria') setDraft(saved.selections.filter(row => validSelection(catalog, row)))
    // oxlint-disable-next-line react/immutability -- hash routing is browser navigation state.
    location.hash = next === 'home' ? '' : next
    setPage(next)
    window.scrollTo(0, 0)
  }

  // 보낼 픽셀을 먼저 만들어 사용자에게 보여준다. 확인 전에는 서버로 아무것도 보내지 않는다.
  async function preparePhoto() {
    if (!imageUri || extractBusy) return
    setAnalysisMessage('')
    try { setPending(await imageForExtraction(imageUri, crop ?? undefined)) }
    catch (error) { setAnalysisMessage(error instanceof Error ? error.message : '사진을 준비하지 못했어요.') }
  }

  async function readPhoto() {
    if (!pending || !consented || extractBusy) return
    setExtractBusy(true)
    setAnalysisMessage('')
    try {
      // 같은 사진을 다시 보내지 않는다. 뒤로 갔다가 같은 사진을 다시 읽는 경우가 많다.
      const key = await imageKey(pending.base64)
      const reads = await readCache()
      const known = reads[key]
      if (known) {
        setIngredientText(known)
        go('review')
        return
      }
      const extracted = await extractIngredients({ base64: pending.base64, mimeType: pending.mimeType }, await deviceId())
      if (typeof extracted.remaining === 'number') setRemaining(extracted.remaining)
      // 장바구니·상품 목록에는 원재료가 없다. 무엇을 캡처해야 하는지 알려준다.
      if (extracted.screen === 'shopping_list' && !extracted.ingredientText.trim()) throw new Error('장바구니·상품 목록 화면에는 원재료가 나오지 않아요. 상품을 눌러 상세페이지의 원재료 부분을 캡처해 주세요.')
      if (!extracted.readable || !extracted.ingredientText.trim()) throw new Error('원재료를 읽지 못했어요. 원재료명 부분이 선명한 사진을 골라주세요.')
      await rememberRead(key, extracted.ingredientText)
      setIngredientText(extracted.ingredientText)
      go('review')
    } catch (error) {
      if (error instanceof Error && error.name === 'BudgetClosed') { setClosed(true); setRemaining(0) }
      if (error instanceof Error && error.name === 'DailyLimit') setRemaining(0)
      setAnalysisMessage(error instanceof Error ? error.message : '원재료를 읽지 못했어요. 다시 시도해 주세요.')
    }
    finally { setExtractBusy(false) }
  }

  async function readCache(): Promise<Record<string, string>> {
    try {
      const raw = await deviceStorage.get(READS_KEY)
      const value = raw ? JSON.parse(raw) : {}
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    } catch { return {} }
  }

  async function rememberRead(key: string, text: string) {
    const reads = await readCache()
    // 최근 20장까지만 기억한다.
    const entries = [[key, text] as const, ...Object.entries(reads).filter(([id]) => id !== key)].slice(0, 20)
    try { await deviceStorage.set(READS_KEY, JSON.stringify(Object.fromEntries(entries))) } catch { /* 캐시는 없어도 된다. */ }
  }

  function compareIngredients() {
    if (!ingredientText.trim()) { setAnalysisMessage('읽은 원재료를 입력해 주세요.'); return }
    if (release.rulesetVersion !== rules.rulesetVersion) { setAnalysisMessage('기준 목록과 판정 규칙의 버전이 맞지 않아요. 목록을 다시 불러온 뒤 시도해 주세요.'); return }
    const result = analyzeIngredients(ingredientText, catalog, effective, rules)
    setAnalysis(result)
    setAnalysisMessage('')
    // 이력은 기기에만 남긴다. 사진은 저장하지 않는다.
    void storeHistory({
      id: newId(), at: new Date().toISOString(), rulesetVersion: rules.rulesetVersion,
      ingredientText, criteria: selected.map(item => ({ id: item.id, name: item.name, strength: effective.get(item.id)! })),
      findings: result.findings, opaqueTokens: result.opaqueTokens,
    })
    go('result')
  }

  async function storeHistory(entry: HistoryEntry) {
    const next = addEntry(history, entry)
    setHistory(next)
    try { await deviceStorage.set(HISTORY_KEY, JSON.stringify(next)) }
    catch { setHistoryMessage('이 기기에 이력을 저장하지 못했어요.') }
  }

  async function clearHistory() {
    try {
      await deviceStorage.remove(HISTORY_KEY)
      setHistory([]); setHistoryMessage(''); setOpenEntry(null)
    } catch { setHistoryMessage('이력을 지우지 못했어요. 다시 시도해 주세요.') }
  }

  async function removeEntry(id: string) {
    const next = history.filter(item => item.id !== id)
    setHistory(next)
    if (openEntry === id) setOpenEntry(null)
    try { await deviceStorage.set(HISTORY_KEY, JSON.stringify(next)) }
    catch { setHistoryMessage('이력을 지우지 못했어요. 다시 시도해 주세요.') }
  }

  async function save() {
    if (busy || readFailed) return
    setBusy(true)
    setMessage('')
    try {
      const prefs = parsePreferences({ rulesetVersion: release.rulesetVersion, selections: draft })
      if (prefs.selections.some(row => !validSelection(catalog, row))) throw new Error('Invalid selection')
      if (review && oldRaw.current) await deviceStorage.set(`${PREFERENCES_KEY}.previous`, oldRaw.current)
      const raw = JSON.stringify(prefs)
      await deviceStorage.set(PREFERENCES_KEY, raw)
      oldRaw.current = raw
      setSaved(prefs)
      setReview('')
      go('home')
      setMessage('내 기준을 저장했어요.')
    } catch { setMessage('저장하지 못했어요. 선택은 그대로 두었으니 다시 시도해 주세요.') }
    finally { setBusy(false) }
  }

  function imageSource(uri: string) { return /^(data:|blob:|https?:)/.test(uri) ? uri : `data:image/jpeg;base64,${uri}` }
  async function pickImage(camera = false) {
    if (!isNative) { (camera ? cameraInput : fileInput).current?.click(); return }
    setImageBusy(true)
    setImageMessage('')
    try {
      if (camera) {
        const photo = await Device.openCamera({ base64: true, maxWidth: 1600 })
        setPhoto(imageSource(photo.dataUri))
      } else {
        const items = await fetchAlbumItems({ types: ['PHOTO'], maxCount: 1, maxWidth: 1600, base64: true })
        if (items[0]) setPhoto(imageSource(items[0].dataUri))
      }
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      if (!['CANCELED', 'CANCELLED', 'USER_CANCELLED'].includes(code)) setImageMessage(error instanceof OpenCameraPermissionError || code === 'NOT_ALLOWED' ? '사진 접근 권한을 확인해 주세요.' : '사진을 불러오지 못했어요. 다시 선택해 주세요.')
    } finally { setImageBusy(false) }
  }

  async function turnPhoto() {
    if (!imageUri || extractBusy) return
    try {
      const turned = await rotateImage(imageUri)
      if (imageUri.startsWith('blob:')) URL.revokeObjectURL(imageUri)
      setImageUri(turned)
      setCrop(null); setPending(null); setConsented(false)
    } catch (error) { setImageMessage(error instanceof Error ? error.message : '사진을 돌리지 못했어요.') }
  }

  function setPhoto(uri: string | null) {
    // 사진을 고르면 안내부터 보이게 맨 위로 올린다.
    if (uri) window.scrollTo(0, 0)
    setImageMessage('')
    setAnalysisMessage('')
    setConsented(false)
    setCrop(null)
    setPending(null)
    setIngredientText('')
    setAnalysis(null)
    setImageUri(uri)
  }

  function localPhoto(file?: File) {
    if (!file) return
    if (!file.type.startsWith('image/') || file.size > 20 * 1024 * 1024) { setImageMessage('20MB 이하의 이미지 파일을 골라주세요.'); return }
    setPhoto(URL.createObjectURL(file))
  }

  return <main className="app">
    {!isNative && <header className="topbar">{page !== 'home' ? <button className="icon-button" type="button" onClick={() => go('home')} aria-label="홈으로 돌아가기"><Icon name="back" /></button> : <BrandMark />}<span className="brand">알고먹을래?</span><span className="topbar-dot" /></header>}
    <div className={`content page-${page}`} ref={heading} tabIndex={-1}>
      {message && <div className="notice" role="status">{message}{readFailed && <button className="text-button" type="button" onClick={() => location.reload()}>다시 불러오기</button>}</div>}
      {page === 'home' && <>
        <section className="intro"><span className="eyebrow"><span className="tiny-dot" /> 나를 위한 식품 선택</span><h1>먹기 전에,<br />내 기준으로 한 번 더.</h1><p>길고 복잡한 라벨, 이제 사진 한 장으로 똑똑하게 걸러내요.</p></section>
        <section className="scan-card"><div className="scan-card-top"><span><Icon name="camera" size={16} /> 라벨로 확인</span><span>01</span></div><LabelArt /><h2>궁금한 제품이 있나요?</h2><p>원재료 표시를 사진으로 담아주세요.</p><button className="primary" type="button" onClick={() => go('image')}>라벨 확인하기 <Icon name="arrow" size={19} /></button></section>
        <button className="gallery-link" type="button" onClick={() => { go('image'); void pickImage() }}><Icon name="image" size={18} /> 사진첩에서 가져오기 <Icon name="arrow" size={16} /></button>
        <button className="gallery-link" type="button" onClick={() => go('history')}><Icon name="sliders" size={18} /> 확인한 기록 {history.length ? `${history.length}건` : '보기'} <Icon name="arrow" size={16} /></button>
        <section className="my-criteria"><div className="section-line"><h2><Icon name="sliders" size={20} /> 내 기준</h2><button className="text-button" type="button" disabled={busy || readFailed} onClick={() => go('criteria')}>{selected.length ? '수정' : '설정하기'} <Icon name="arrow" size={15} /></button></div>
          {busy ? <p role="status">내 기준을 불러오고 있어요.</p> : <>
            {review ? <p className="review-prompt">기준 목록이 바뀌었거나 다시 설정이 필요해요. 수정에서 확인해 주세요.</p> : <p>{selected.length ? <>피해요 <b>{avoid}</b> · 알려만줘요 <b>{selected.length - avoid}</b></> : '내가 확인할 원재료를 골라보세요.'}</p>}
            <div className="ingredient-chips">{selected.slice(0, 6).map(c => <button key={c.id} type="button" disabled={readFailed} onClick={() => go('criteria')}><span className={`chip-dot ${effective.get(c.id)}`} /><span>{c.name}</span><small>{strengthLabels[effective.get(c.id)!]}</small></button>)}<button className="chip-add" type="button" disabled={readFailed} onClick={() => go('criteria')} aria-label="기준 추가"><Icon name="plus" size={15} />{selected.length > 6 ? `외 ${selected.length - 6}개` : '기준 추가'}</button></div>
          </>}
        </section><p className="brand-signoff"><Icon name="leaf" size={15} /> 내 몸을 위한 선택, 타협하지 마세요.</p>
      </>}
      {page === 'criteria' && (!loaded ? <p className="empty" role="status">기준을 불러오고 있어요.</p> : readFailed ? <p className="empty">기준을 다시 불러온 뒤 설정할 수 있어요.</p> : <CriteriaEditor catalog={catalog} rows={draft} onChange={setDraft} busy={busy} onSave={() => void save()} review={review} onCancel={() => go('home')} />)}
      {page === 'image' && <>
        {imageUri
          ? <section className="step-head">
              <ol className="steps" aria-label="진행 단계"><li className="on">① 영역 고르기</li><li className={pending ? 'on' : ''}>② 보낼 사진 확인</li><li>③ 결과</li></ol>
              <h1>{pending ? '이 부분만 보낼게요.' : '원재료명 부분을 손가락으로 끌어 고르세요.'}</h1>
              <p>{pending ? '동의하면 원재료 글자를 읽어요.' : '고르지 않으면 사진 전체를 보내요. 글자가 누워 있으면 먼저 돌려주세요.'}</p>
            </section>
          : <section className="intro"><span className="eyebrow">READ THE LABEL</span><h1>원재료명이 보이는<br />사진을 넣어주세요.</h1><p>사진 속 원재료명을 읽어 내 기준과 대조해요. 두 가지 방법이 있어요.</p></section>}
        {!imageUri && <>
          {/* 안내와 버튼을 하나로 — 카드를 누르면 바로 그 방법으로 사진을 고른다. */}
          <div className="source-guide">
            <button className="source-pick main" type="button" disabled={imageBusy} onClick={() => void pickImage()}><Icon name="image" size={22} /><p><b>{imageBusy ? '사진을 불러오는 중…' : '캡처·사진첩에서 고르기'}</b><span>쇼핑몰 상세페이지의 원재료 부분을 캡처해 둔 이미지도 돼요.</span></p></button>
            <button className="source-pick" type="button" disabled={imageBusy} onClick={() => void pickImage(true)}><Icon name="camera" size={22} /><p><b>카메라로 찍기</b><span>제품 뒷면의 원재료명을 가까이, 흔들리지 않게 찍어주세요.</span></p></button>
          </div>
        </>}
        {imageUri && !pending && <>
          <CropBox src={imageUri} area={crop} onChange={area => { setCrop(area); setPending(null); setConsented(false) }} onError={() => { setImageUri(null); setImageMessage('표시할 수 없는 사진이에요. JPG 또는 PNG로 다시 골라주세요.') }} />
          <div className="sticky-action"><button className="primary wide" type="button" disabled={extractBusy || closed} onClick={() => void preparePhoto()}>{crop ? '고른 영역으로 계속하기' : '사진 전체로 계속하기'} <Icon name="arrow" size={19} /></button></div>
          <div className="image-actions row">
            <button className="secondary" type="button" disabled={extractBusy} onClick={() => void turnPhoto()}><Icon name="arrow" size={18} /> 사진 돌리기</button>
            <button className="secondary" type="button" disabled={imageBusy || extractBusy} onClick={() => void pickImage()}><Icon name="image" size={18} /> 다른 사진</button>
          </div>
          <button className="text-button" type="button" onClick={() => setPhoto(null)}>사진 지우기</button>
        </>}
        {pending && <section className="extract-card">
          <img className="send-preview" src={pending.preview} alt="분석 서버로 보낼 사진" />
          <p>이 그림에 보이는 부분만 분석 서버로 전송해요. 서버는 사진을 저장하지 않고, 읽은 글자는 다음 화면에서 고칠 수 있어요.</p>
          <label className="consent"><input type="checkbox" checked={consented} disabled={extractBusy} onChange={event => setConsented(event.target.checked)} /><span>이 사진을 보내 원재료 텍스트를 읽는 데 동의해요.</span></label>
          <button className="primary" type="button" disabled={!consented || extractBusy || closed} onClick={() => void readPhoto()}>{extractBusy ? '원재료를 읽는 중…' : '원재료 읽기'}</button>
          {remaining !== null && <p className="remaining">오늘 남은 확인 {remaining}장</p>}
          <button className="text-button" type="button" disabled={extractBusy} onClick={() => { setPending(null); setConsented(false) }}>영역 다시 고르기</button>
        </section>}
        {closed && <p className="notice" role="status">이번 달 무료 분석이 모두 끝났어요. 다음 달에 다시 열려요. 그때까지도 이미 확인한 기록은 볼 수 있어요.</p>}
        {imageMessage && <p className="notice" role="status">{imageMessage}</p>}
        {analysisMessage && <p className="notice" role="status">{analysisMessage}</p>}
        <p className="photo-privacy">사진은 원재료를 읽는 데만 쓰고 저장하지 않아요.</p>
      </>}
      {page === 'history' && <>
        <section className="intro"><span className="eyebrow">MY RECORDS</span><h1>지금까지<br />확인한 기록이에요.</h1><p>이 기기에만 저장돼요. 사진은 저장하지 않고, 읽은 원재료와 그때의 내 기준만 남겨요.</p></section>
        {historyMessage && <p className="notice" role="status">{historyMessage}</p>}
        {history.length === 0 ? <section className="empty"><strong>아직 확인한 기록이 없어요.</strong><p>라벨을 확인하면 결과가 이 기기에 쌓여요.</p><button className="secondary" type="button" onClick={() => go('image')}>라벨 확인하기</button></section> : <>
          <div className="history-list">{history.map(entry => {
            const counts = summarize(entry)
            const open = openEntry === entry.id
            return <article className="history-row" key={entry.id}>
              <button className="history-head" type="button" aria-expanded={open} onClick={() => setOpenEntry(open ? null : entry.id)}>
                <span className="history-when">{formatWhen(entry.at)}</span>
                <strong>{counts.found ? `발견 ${counts.found}` : '발견 없음'}{counts.needsReview ? ` · 확인 필요 ${counts.needsReview}` : ''}</strong>
                <span className="history-text">{entry.ingredientText}</span>
              </button>
              {open && <div className="history-detail">
                <h3>그때의 내 기준</h3>
                <p>{entry.criteria.length ? entry.criteria.map(item => `${item.name}(${strengthLabels[item.strength]})`).join(' · ') : '기준 없음'}</p>
                {(() => {
                  const name = (id: string) => entry.criteria.find(item => item.id === id)?.name ?? id
                  const found = entry.findings.filter(finding => finding.state === 'found')
                  const review = entry.findings.filter(finding => finding.state === 'needs_review')
                  return <>
                    {found.length > 0 && <><h3>표기에서 발견 {found.length}가지</h3><ul>{found.map(finding => <li key={finding.criterionId}><b>{name(finding.criterionId)}</b> {finding.tokens.join(' · ')}</li>)}</ul></>}
                    {review.length > 0 && <><h3>가능성이 있어요 {review.length}가지</h3><ul>{review.map(finding => <li key={finding.criterionId}><b>{name(finding.criterionId)}</b> {finding.tokens.join(' · ')}</li>)}</ul></>}
                  </>
                })()}
                <h3>읽은 원재료</h3>
                <p className="history-raw">{entry.ingredientText}</p>
                <p className="history-version">판정 규칙 {entry.rulesetVersion}</p>
                <div className="history-actions">
                  <button className="secondary" type="button" onClick={() => { setIngredientText(entry.ingredientText); go('review') }}>이 원재료로 다시 확인하기</button>
                  <button className="text-button" type="button" onClick={() => void removeEntry(entry.id)}>이 기록 지우기</button>
                </div>
              </div>}
            </article>
          })}</div>
          <button className="text-button danger" type="button" onClick={() => void clearHistory()}>기록 모두 지우기</button>
        </>}
        {history.length === 0 && historyMessage && <button className="text-button danger" type="button" onClick={() => void clearHistory()}>저장된 이력 지우기</button>}
      </>}
      {page === 'review' && <>
        <section className="intro"><span className="eyebrow">CHECK THE TEXT</span><h1>읽은 원재료를<br />한 번 확인해요.</h1><p>사진에서 읽은 내용이에요. 빠졌거나 잘못 읽은 부분은 고친 뒤 비교해 주세요.</p></section>
        <label className="ingredient-editor" htmlFor="ingredient-text"><span>원재료 표시</span><textarea id="ingredient-text" value={ingredientText} maxLength={12000} rows={10} onChange={event => setIngredientText(event.target.value)} placeholder="원재료명을 쉼표로 구분해 입력해 주세요." /></label>
        {analysisMessage && <p className="notice" role="status">{analysisMessage}</p>}
        {selected.length ? <button className="primary" type="button" onClick={compareIngredients}>내 기준과 비교하기 <Icon name="arrow" size={19} /></button> : <section className="empty"><strong>비교할 내 기준이 없어요.</strong><p>기준을 먼저 설정하면 이 원재료와 대조할 수 있어요.</p><button className="secondary" type="button" onClick={() => go('criteria')}>내 기준 설정하기</button></section>}
        <button className="text-button back-step" type="button" onClick={() => go('image')}>사진 다시 고르기</button>
      </>}
      {page === 'result' && analysis && <>
        <section className={`verdict ${shown('found', 'avoid').length ? 'hit' : 'clear'}`}>
          <span className="eyebrow">내 기준 대조 결과</span>
          {shown('found', 'avoid').length
            ? <h1>피해요로 고른 <b>{shown('found', 'avoid').length}가지</b>가<br />표기에 있어요.</h1>
            : <h1>피해요로 고른 기준은<br />표기에 없었어요.</h1>}
          <p>읽은 원재료 표기와 내 기준을 대조한 결과예요.</p>
        </section>
        {shown('found', 'avoid').length > 0 && <section className="result-block hit">
          <h2>피해요 · 표기에서 찾았어요</h2>{cards(shown('found', 'avoid'))}</section>}
        {shown('found', 'inform').length > 0 && <section className="result-block inform">
          <h2>알려만줘요 · 표기에서 찾았어요</h2>{cards(shown('found', 'inform'))}</section>}
        {shown('needs_review').length > 0 && <section className="result-block review">
          <h2>가능성이 있어요</h2>
          {maybe().map(([token, entry]) => <article className="finding maybe" key={token}>
            <div className="maybe-head"><h3>{token}</h3><span className="maybe-strength">{strengthBadge(entry.ids)}</span></div>
            <p>{maybeLine(entry.kind, entry.ids, entry.corrected)}</p>
          </article>)}</section>}
        <details className="result-fold"><summary>읽은 원재료 {analysis.tokens.length}개 보기</summary><p className="read-text">{ingredientText}</p></details>
        <div className="result-actions"><button className="primary" type="button" onClick={() => go('review')}>읽은 원재료 고치기</button><button className="secondary" type="button" onClick={() => go('image')}>다른 사진 확인하기</button><button className="text-button" type="button" onClick={() => go('history')}>확인한 기록 보기</button></div>
        <p className="result-limit">이 결과는 제품의 성분 안전성, 알레르기, 함량 또는 건강 영향을 판단하지 않아요. 표기와 내 기준의 대조 결과예요.</p>
      </>}
    </div>
    <input ref={fileInput} type="file" accept="image/*" hidden onChange={event => { localPhoto(event.target.files?.[0]); event.target.value = '' }} />
    <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={event => { localPhoto(event.target.files?.[0]); event.target.value = '' }} />
  </main>
}

export default App
