import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import './preview.css'

type Concept = 'green' | 'coral'
type Screen = 'home' | 'criteria' | 'scan'
type IconName = 'arrow' | 'back' | 'camera' | 'image' | 'plus' | 'check' | 'close' | 'sliders' | 'search' | 'leaf' | 'spark' | 'more'

function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    back: <path d="m14 5-7 7 7 7" />,
    camera: <><path d="M8 5 6 8H3v12h18V8h-3l-2-3Z" /><circle cx="12" cy="13" r="3.5" /></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8" cy="8" r="1.5" /><path d="m4 17 5-5 4 4 3-3 5 5" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    check: <path d="m5 12 4.5 4.5L19 7" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    sliders: <><path d="M4 7h7m5 0h4M4 17h3m5 0h8" /><circle cx="13.5" cy="7" r="2.5" /><circle cx="9.5" cy="17" r="2.5" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    leaf: <><path d="M19 4C8 3 3 9 6 15s14 3 13-11Z" /><path d="m5 20 9-10" /></>,
    spark: <path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z" />,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function BrandMark({ className = '' }: { className?: string }) {
  return <span className={`brand-symbol ${className}`} aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M8 16c0-5 3-9 8-9s8 4 8 9-3 10-8 10S8 21 8 16Z" fill="currentColor" /><path d="m12 16 3 3 6-7" stroke="var(--mark-ink, white)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /><path d="M16 7c0-3 3-4 6-3-1 3-3 4-6 3Z" fill="currentColor" /></svg></span>
}

function LabelArt({ coral = false }: { coral?: boolean }) {
  const ink = coral ? '#583d32' : '#175a45'
  const pale = coral ? '#f5c18d' : '#d9e9b9'
  return <svg className="label-art" viewBox="0 0 330 225" fill="none" aria-hidden="true">
    <ellipse cx="160" cy="207" rx="92" ry="8" fill={ink} opacity=".07" />
    <g transform="rotate(-10 140 120)">
      <path d="M89 25h113l-7 25 16 129q2 13-12 13H88q-14 0-11-14L94 50Z" fill={coral ? '#ffe5b8' : '#f8f8e9'} stroke={ink} strokeWidth="1.4" />
      <path d="M90 25h111M94 39h103M94 50h101" stroke={ink} strokeWidth="1.4" />
      <rect x="96" y="72" width="96" height="91" rx="8" fill={pale} />
      <text x="111" y="92" fill={ink} fontSize="10" letterSpacing="2" fontWeight="700">MY DAILY</text>
      <text x="111" y="112" fill={ink} fontSize="19" fontWeight="800">OAT BITES</text>
      <path d="M112 131h59m-59 8h51m-51 8h35" stroke={ink} strokeWidth="2" opacity=".6" />
      <path d="M112 174v8m4-8v8m5-8v8m3-8v8m5-8v8m6-8v8m3-8v8m4-8v8m7-8v8m4-8v8m4-8v8m6-8v8m4-8v8" stroke={ink} />
    </g>
    <g transform="rotate(10 234 136)">
      <rect x="184" y="96" width="105" height="72" rx="12" fill="white" stroke={ink} strokeWidth="1.5" />
      <rect x="199" y="111" width="49" height="5" rx="2.5" fill={pale} />
      <path d="M199 126h70m-70 9h50m-50 9h60" stroke={ink} strokeWidth="2" opacity=".35" />
      <circle cx="283" cy="101" r="17" fill={ink} />
      <path d="m276 101 5 5 9-11" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </g>
    <path d="M50 98V84h14m225-22h14v14M61 177v14h14" stroke={ink} strokeWidth="2" strokeLinecap="round" />
    <path d="m248 30 3 9 9 3-9 3-3 9-3-9-9-3 9-3Z" fill={ink} />
    <circle cx="65" cy="137" r="4" fill={ink} opacity=".35" />
  </svg>
}

const initialIngredients = ['설탕', '밀가루', '대두']

function Phone({ concept, initialScreen = 'home' }: { concept: Concept; initialScreen?: Screen }) {
  const [screen, setScreen] = useState<Screen>(initialScreen)
  const [ingredients, setIngredients] = useState(initialIngredients)
  const [input, setInput] = useState('')
  const [saved, setSaved] = useState(false)
  const [photo, setPhoto] = useState<string | null>(null)
  const coral = concept === 'coral'
  const go = (next: Screen) => { setSaved(false); setScreen(next) }
  function add() {
    const name = input.trim()
    if (name && !ingredients.includes(name)) setIngredients([...ingredients, name])
    setInput('')
  }
  return <div className={`phone ${concept}`}>
    <div className="phone-status" aria-hidden="true"><span>9:41</span><div><svg width="16" height="12" viewBox="0 0 16 12"><path d="M1 11V8h2v3Zm4 0V6h2v5Zm4 0V3h2v8Zm4 0V0h2v11Z" fill="currentColor" /></svg><svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M1 3q7-5 14 0M4 6q4-3 8 0m-5 3 1 1 1-1" /></svg><span className="battery" /></div></div>
    <nav className="toss-nav" aria-label={`${coral ? 'B' : 'A'}안 미니앱 내비게이션 예시`}>
      {screen === 'home' ? <span className="nav-back-static"><Icon name="back" size={20} /></span> : <button className="icon-button" onClick={() => go('home')} aria-label="홈으로 돌아가기"><Icon name="back" size={20} /></button>}
      <span className="nav-brand"><BrandMark />알고먹을래?</span>
      <span className="nav-actions" aria-hidden="true"><Icon name="more" size={20} /><span /><Icon name="close" size={18} /></span>
    </nav>
    <div className="phone-body">
      {screen === 'home' && <>
        {coral ? <div className="coral-home">
          <div className="edition"><span>MY FOOD, MY CHOICE</span><span className="edition-dot" /></div>
          <div className="coral-heading"><h1>먹는 기준은,<br /><span>내가 정해요.</span></h1><p>복잡한 원재료 표시도<br />내 기준으로 가볍게 확인해요.</p></div>
          <div className="coral-art"><span className="art-stamp">READ<br />BEFORE<br />YOU EAT.</span><LabelArt coral /></div>
          <button className="scan-card" onClick={() => go('scan')}><span className="scan-icon"><Icon name="camera" size={26} /></span><span><strong>이거, 내 기준에 맞을까?</strong><small>라벨을 찍어서 확인해요</small></span><Icon name="arrow" /></button>
          <div className="coral-section-heading"><h2>나만의 체크리스트</h2><button onClick={() => go('criteria')}>수정하기 <Icon name="arrow" size={15} /></button></div>
          <button className="coral-criteria" onClick={() => go('criteria')}><span className="criteria-count">{String(ingredients.length).padStart(2, '0')}</span><span><strong>내가 확인할 원재료</strong><small>{ingredients.length ? ingredients.join(' · ') : '나만의 기준을 추가해요'}</small></span><span className="round-arrow"><Icon name="arrow" size={18} /></span></button>
          <p className="brand-signoff"><BrandMark /> 조금 더 알고, 나답게 먹어요.</p>
        </div> : <div className="green-home">
          <div className="green-intro"><span className="eyebrow"><span className="tiny-dot" /> 나를 위한 식품 선택</span><h1>먹기 전에,<br />내 기준으로 한 번 더.</h1><p>원재료 표시를 읽고, 내 기준과 대조해요.</p></div>
          <section className="green-scan-card"><div className="scan-card-top"><span><Icon name="camera" size={16} /> 라벨로 확인</span><span>01</span></div><LabelArt /><h2>궁금한 제품이 있나요?</h2><p>원재료 표시를 사진으로 담아주세요.</p><button className="action-primary" onClick={() => go('scan')}>라벨 확인하기 <Icon name="arrow" size={19} /></button></section>
          <button className="gallery-link" onClick={() => go('scan')}><Icon name="image" size={18} /> 사진첩에서 가져오기 <Icon name="arrow" size={16} /></button>
          <section className="green-criteria"><div className="section-line"><h2><Icon name="sliders" size={20} /> 내 기준</h2><button onClick={() => go('criteria')}>수정 <Icon name="arrow" size={15} /></button></div><p>내가 확인하고 싶은 원재료 <b>{ingredients.length}</b></p><div className="ingredient-chips">{ingredients.map(item => <button key={item} onClick={() => go('criteria')}>{item}</button>)}<button className="chip-add" onClick={() => go('criteria')} aria-label="기준 추가"><Icon name="plus" size={15} /></button></div></section>
          <p className="green-footnote"><Icon name="leaf" size={14} /> 선택의 기준은 언제나 나에게 있어요.</p>
        </div>}
      </>}
      {screen === 'criteria' && <div className="criteria-page">
        <span className="eyebrow">MY CHECKLIST</span><h1>{coral ? <>나답게 먹는<br />작은 기준들.</> : <>내가 정하는,<br />나의 식사 기준.</>}</h1><p className="page-description">확인하고 싶은 원재료를 골라주세요.<br />언제든 내 취향에 맞게 바꿀 수 있어요.</p>
        <form className="ingredient-search" onSubmit={event => { event.preventDefault(); add() }}><Icon name="search" size={20} /><input aria-label="원재료 이름" value={input} onChange={event => setInput(event.target.value)} placeholder="원재료 이름으로 찾아요" maxLength={30} /><button type="submit" aria-label="원재료 추가" disabled={!input.trim()}><Icon name="plus" size={20} /></button></form>
        <div className="selected-heading"><h2>내가 고른 원재료</h2><span>{ingredients.length}</span></div>
        <div className="selected-list">{ingredients.map((item, index) => <div className="selected-row" key={item}><span className="ingredient-number">{String(index + 1).padStart(2, '0')}</span><span className="ingredient-title">{item}</span><button aria-label={`${item} 선택 해제`} onClick={() => setIngredients(ingredients.filter(name => name !== item))}><Icon name="check" size={17} /></button></div>)}{!ingredients.length && <p className="empty-criteria">위에서 원재료를 추가해 주세요.</p>}</div>
        <div className="criterion-hint"><Icon name="sliders" size={22} /><div><strong>같은 제품도, 기준은 다르니까</strong><p>다른 사람의 기준보다<br />내가 고른 원재료부터 확인해요.</p></div></div>
        <button className="action-primary save-button" onClick={() => { setScreen('home'); setSaved(true) }}>이 기준으로 확인할게요 <Icon name="check" size={18} /></button>
      </div>}
      {screen === 'scan' && <div className="photo-page"><span className="eyebrow">READ THE LABEL</span><h1>이름보다 자세히,<br />원재료를 봐요.</h1><p className="page-description">제품의 원재료 표시가<br />잘 보이는 사진을 골라주세요.</p><div className={`photo-frame ${photo ? 'has-photo' : ''}`}>{photo ? <img src={photo} alt="선택한 원재료 라벨" /> : <><LabelArt coral={coral} /><span>원재료명 영역을 담아주세요</span></>}</div><label className="action-primary photo-select"><Icon name="image" size={20} /> {photo ? '다른 사진 고르기' : '사진 선택하기'}<input type="file" accept="image/*" onChange={event => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => setPhoto(String(reader.result)); reader.readAsDataURL(file) }} /></label><p className="photo-note">이미지는 이 브라우저에서만 미리 보여요.</p></div>}
      {saved && <div className="preview-toast" role="status"><Icon name="check" size={16} /> 시안에 기준을 적용했어요</div>}
    </div>
    <div className="home-indicator" aria-hidden="true"><span /></div>
  </div>
}

const params = new URLSearchParams(window.location.search)
const solo = params.get('concept')
const requestedScreen = params.get('screen')
const initialScreen: Screen = requestedScreen === 'criteria' || requestedScreen === 'scan' ? requestedScreen : 'home'

export default function Preview() {
  const [screen, setScreen] = useState<Screen>(initialScreen)
  const [revision, setRevision] = useState(0)
  const soloConcept: Concept | null = solo === 'a' ? 'green' : solo === 'b' ? 'coral' : null
  if (soloConcept) return <div className="solo-preview"><Phone concept={soloConcept} initialScreen={screen} /><a className="back-to-gallery" href="/design.html">두 시안 비교하기 ↗</a></div>
  return <main className="preview-shell">
    <header className="review-header"><a className="review-brand" href="/design.html"><BrandMark /><span>알고먹을래?<small>DESIGN EXPLORATION</small></span></a><span className="review-version">01 — VISUAL DIRECTIONS</span></header>
    <section className="review-intro"><div><span className="review-kicker">같은 서비스, 두 가지 분위기</span><h1>어떤 느낌으로<br className="mobile-break" /> 알고 먹을까요?</h1><p>내 기준으로 식품을 고르는 일, 더 쉽고 기분 좋게.</p></div><div className="screen-switcher" role="group" aria-label="두 시안의 시작 화면"><button aria-pressed={screen === 'home'} onClick={() => { setScreen('home'); setRevision(revision + 1) }}>홈 화면</button><button aria-pressed={screen === 'criteria'} onClick={() => { setScreen('criteria'); setRevision(revision + 1) }}>내 기준</button></div></section>
    <div className="concept-grid">{(['green', 'coral'] as const).map((concept, index) => <section className={`concept-panel panel-${concept}`} key={concept} aria-labelledby={`${concept}-title`}>
      <div className="concept-heading"><span className="concept-letter">{index === 0 ? 'A' : 'B'}</span><div><h2 id={`${concept}-title`}>{index === 0 ? '산뜻하고 명확하게' : '따뜻하고 나답게'}</h2><p>{index === 0 ? '딥그린 · 세이지 · 정돈된 카드' : '코랄 · 버터크림 · 매거진 같은 구성'}</p></div><a href={`/design.html?concept=${index === 0 ? 'a' : 'b'}&screen=${screen}`} className="open-concept" aria-label={`${index === 0 ? 'A' : 'B'}안 단독으로 열기`}><Icon name="arrow" size={20} /></a></div>
      <div className="device-stage"><Phone concept={concept} initialScreen={screen} key={`${screen}-${revision}`} /></div>
      <div className="concept-footer"><div className="swatches" aria-label="대표 색상">{(index === 0 ? ['#1e634d', '#dce9cc', '#f5f7f1'] : ['#e68466', '#f7edda', '#49372e']).map(color => <span key={color} style={{ '--swatch': color } as CSSProperties} />)}</div><span>{index === 0 ? '빠르게 확인하는 데 집중해요.' : '취향을 고르는 경험을 담아요.'}</span></div>
    </section>)}</div>
    <footer className="review-footer"><p>디자인 검토용 시안 · 원재료는 예시 데이터예요.</p><p>버튼을 눌러 화면을 이동하고 기준을 수정할 수 있어요. 실제 분석·DB 저장은 연결하지 않았어요.</p><p>상단 토스 내비게이션은 배치를 확인하기 위한 예시이며, 출시 버전에는 SDK가 제공하는 UI를 사용해요.</p></footer>
  </main>
}
