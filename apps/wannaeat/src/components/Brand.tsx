import type { ReactNode } from 'react'

type IconName = 'arrow' | 'back' | 'camera' | 'image' | 'plus' | 'check' | 'close' | 'sliders' | 'search' | 'leaf' | 'spark' | 'more'

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
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

export function BrandMark({ className = '' }: { className?: string }) {
  return <span className={`brand-symbol ${className}`} aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M8 16c0-5 3-9 8-9s8 4 8 9-3 10-8 10S8 21 8 16Z" fill="currentColor" /><path d="m12 16 3 3 6-7" stroke="var(--mark-ink, white)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /><path d="M16 7c0-3 3-4 6-3-1 3-3 4-6 3Z" fill="currentColor" /></svg></span>
}

export function LabelArt({ coral = false }: { coral?: boolean }) {
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
