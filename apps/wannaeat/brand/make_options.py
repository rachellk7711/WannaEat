#!/usr/bin/env python3
"""앱 아이콘 · 글씨(워드마크) 시안을 만든다.

  python brand/make_options.py   →  brand/options/*.svg  +  public/_brand-sheet.html (비교 화면)

아이콘은 토스 콘솔 규격(600×600, 각진 모서리, 배경을 꽉 채움)에 맞춘다.
"""
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / 'options'
OUT.mkdir(exist_ok=True)

G, DEEP, LIME, YELLOW, CREAM, WHITE = '#1E634D', '#123F2E', '#B6E86A', '#FFD54A', '#F8F4E6', '#FFFFFF'
FONT = "'Arial Black','Segoe UI Black',sans-serif"

ICONS = {
    # 지금 쓰는 것 — 앱 상단의 열매 마크를 키운 것
    '0-now': ('지금 (열매)', f'''
  <rect width="600" height="600" fill="{G}"/>
  <path d="M150 319c0-94 56-169 150-169s150 75 150 169-56 178-150 178-150-84-150-178Z" fill="{WHITE}"/>
  <path d="m225 319 56 56 113-131" stroke="{G}" stroke-width="49" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="M300 150c0-56 56-79 116-60-19 56-56 79-116 60Z" fill="#9FD07F"/>'''),
    # 라벨을 돋보기로 — "원재료 라벨을 읽어준다"
    'A-magnifier': ('라벨 돋보기', f'''
  <rect width="600" height="600" fill="{G}"/>
  <g transform="rotate(-8 250 290)">
    <rect x="118" y="120" width="250" height="330" rx="26" fill="{CREAM}"/>
    <rect x="150" y="160" width="150" height="22" rx="11" fill="{G}" opacity=".85"/>
    <rect x="150" y="212" width="186" height="16" rx="8" fill="{G}" opacity=".35"/>
    <rect x="150" y="246" width="160" height="16" rx="8" fill="{G}" opacity=".35"/>
    <rect x="150" y="280" width="176" height="16" rx="8" fill="{G}" opacity=".35"/>
  </g>
  <circle cx="368" cy="352" r="112" fill="{G}" stroke="{WHITE}" stroke-width="34"/>
  <path d="m318 352 36 36 70-82" stroke="{LIME}" stroke-width="36" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="m452 438 70 70" stroke="{WHITE}" stroke-width="50" stroke-linecap="round"/>'''),
    # 이름 그대로 — W 와 물음표
    'B-monogram': ('W? 글자', f'''
  <rect width="600" height="600" fill="{G}"/>
  <text x="300" y="402" text-anchor="middle" font-family="{FONT}" font-size="300" letter-spacing="-12"><tspan fill="{WHITE}">W</tspan><tspan fill="{LIME}">?</tspan></text>'''),
    # 사진으로 읽는다 — 스캔 틀 안의 체크
    'C-scan': ('스캔 체크', f'''
  <rect width="600" height="600" fill="{G}"/>
  <g stroke="{WHITE}" stroke-width="34" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M120 215v-62q0-33 33-33h62"/><path d="M385 120h62q33 0 33 33v62"/>
    <path d="M480 385v62q0 33-33 33h-62"/><path d="M215 480h-62q-33 0-33-33v-62"/>
  </g>
  <path d="m205 305 70 70 130-150" stroke="{LIME}" stroke-width="56" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'''),
    # 먹을래? — 말풍선 물음표, 밝은 바탕으로 눈에 띄게
    'D-bubble': ('먹을래? 말풍선', f'''
  <rect width="600" height="600" fill="{LIME}"/>
  <path d="M120 270c0-90 80-150 180-150s180 60 180 150-80 150-180 150c-22 0-43-3-62-9l-86 47 22-78c-34-27-54-65-54-110Z" fill="{G}"/>
  <text x="300" y="352" text-anchor="middle" font-family="{FONT}" font-size="210" fill="{WHITE}">?</text>
  <path d="M352 136c4-46 50-66 98-50-14 46-52 64-98 50Z" fill="{DEEP}"/>'''),
    # 먹을 것 + 확인 — 포크와 체크
    'E-fork': ('포크 체크', f'''
  <rect width="600" height="600" fill="{G}"/>
  <g fill="{WHITE}">
    <rect x="150" y="110" width="26" height="140" rx="13"/><rect x="198" y="110" width="26" height="140" rx="13"/><rect x="246" y="110" width="26" height="140" rx="13"/>
    <path d="M150 230h122v20c0 40-24 60-42 66v170c0 16-12 28-19 28s-19-12-19-28V316c-18-6-42-26-42-66Z"/>
  </g>
  <circle cx="400" cy="380" r="118" fill="{LIME}"/>
  <path d="m345 382 40 40 75-88" stroke="{G}" stroke-width="38" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'''),
    # 원재료 태그 — 노란 바탕으로 가장 눈에 띄게
    'F-tag': ('원재료 태그', f'''
  <rect width="600" height="600" fill="{YELLOW}"/>
  <path d="M150 160q0-30 30-30h190l110 110q21 21 0 42L330 482q-21 21-42 0L150 344Z" fill="{G}"/>
  <circle cx="225" cy="205" r="26" fill="{YELLOW}"/>
  <path d="m235 320 52 52 98-112" stroke="{WHITE}" stroke-width="44" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'''),
}

WORDMARKS = [
    ('Poppins 900', "'Poppins'", 900),
    ('Montserrat 900', "'Montserrat'", 900),
    ('Nunito 900 (둥근)', "'Nunito'", 900),
    ('Black Han Sans (한글 폰트)', "'Black Han Sans'", 400),
]

for key, (_, body) in ICONS.items():
    (OUT / f'icon-{key}.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">{body}\n</svg>\n', encoding='utf-8')

cards = ''.join(f'''<figure><img src="/brand/options/icon-{key}.svg"><figcaption>{key[0]}. {name}</figcaption>
  <div class="small"><img src="/brand/options/icon-{key}.svg"><img class="round" src="/brand/options/icon-{key}.svg"></div></figure>'''
                for key, (name, _) in ICONS.items())
marks = ''.join(f'''<div class="mark"><span class="n">{i + 1}. {label}</span>
  <span class="bar"><span class="w" style="font-family:{family},sans-serif;font-weight:{weight}">WannaEAT<i>?</i></span></span></div>'''
                for i, (label, family, weight) in enumerate(WORDMARKS))
sheet = f'''<!doctype html><html lang="ko"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Montserrat:wght@900&family=Nunito:wght@900&family=Poppins:wght@900&display=block" rel="stylesheet">
<style>body{{margin:0;padding:28px;background:#f3f5f0;font-family:'Segoe UI','Noto Sans KR',sans-serif;color:#253d32;width:1144px}}
h2{{margin:0 0 14px;font-size:20px}} .grid{{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-bottom:30px}}
figure{{margin:0;background:#fff;border-radius:16px;padding:14px;border:1px solid #e0e7dc}} figure>img{{width:100%;display:block}}
figcaption{{margin:10px 0 8px;font-weight:700;font-size:15px}} .small{{display:flex;gap:12px;align-items:center}} .small img{{width:64px;height:64px}} .small img.round{{border-radius:16px;width:48px;height:48px}}
.mark{{display:flex;align-items:center;gap:18px;margin-bottom:12px}} .n{{width:230px;font-size:14px;font-weight:600}}
.bar{{flex:1;background:#fff;border-bottom:1px solid #e5e9e1;border-radius:12px;padding:14px 22px;display:flex;align-items:center;gap:10px}}
.w{{font-size:24px;color:#1E634D;letter-spacing:-.5px}} .w i{{font-style:normal;color:#7CC242}}</style></head><body>
<h2>앱 아이콘 시안 (600×600 · 아래 작은 것은 실제 크기 느낌)</h2><div class="grid">{cards}</div>
<h2>좌측 상단 글씨 시안 (폰에서도 똑같이 보이게 글꼴 파일을 앱에 넣는 방식)</h2>{marks}
</body></html>'''
(HERE.parent / 'public' / '_brand-sheet.html').write_text(sheet, encoding='utf-8')
print('icons', len(ICONS), 'wordmarks', len(WORDMARKS))
