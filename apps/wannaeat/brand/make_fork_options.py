#!/usr/bin/env python3
"""포크 아이콘 시안 · 한쪽만 굵은 글씨 시안 (2026-10-02, 사용자가 포크 시안을 골라 더 보기로 함)

  python brand/make_fork_options.py  →  brand/options/fork-*.svg  +  public/_brand-sheet2.html
"""
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / 'options'
OUT.mkdir(exist_ok=True)
G, DEEP, LIME, YELLOW, WHITE = '#1E634D', '#123F2E', '#B6E86A', '#FFD54A', '#FFFFFF'
FONT = "'Arial Black','Segoe UI Black',sans-serif"


def fork(x: float, y: float, color: str, scale: float = 1) -> str:
    """포크 — (x, y) 는 왼쪽 위. 기본 크기 122×404."""
    return f'''<g transform="translate({x} {y}) scale({scale})" fill="{color}">
    <rect x="0" y="0" width="26" height="140" rx="13"/><rect x="48" y="0" width="26" height="140" rx="13"/><rect x="96" y="0" width="26" height="140" rx="13"/>
    <path d="M0 120h122v20c0 40-24 60-42 66v170c0 16-12 28-19 28s-19-12-19-28V206c-18-6-42-26-42-66Z"/></g>'''


def check(cx: float, cy: float, r: float, ring: str, ink: str) -> str:
    s = r / 118
    return f'''<circle cx="{cx}" cy="{cy}" r="{r}" fill="{ring}"/>
  <path d="M{cx - 55 * s} {cy + 2 * s}l{40 * s} {40 * s} {75 * s} {-88 * s}" stroke="{ink}" stroke-width="{38 * s}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'''


ICONS = {
    'E1': ('포크 체크 · 진초록 (앞 시안)', f'<rect width="600" height="600" fill="{G}"/>{fork(150, 110, WHITE)}{check(400, 380, 118, LIME, G)}'),
    'E2': ('포크 체크 · 연두 바탕', f'<rect width="600" height="600" fill="{LIME}"/>{fork(150, 110, G)}{check(400, 380, 118, G, WHITE)}'),
    'E3': ('포크 체크 · 노랑 바탕', f'<rect width="600" height="600" fill="{YELLOW}"/>{fork(150, 110, G)}{check(400, 380, 118, G, WHITE)}'),
    'E4': ('포크 + EAT? 물음표', f'''<rect width="600" height="600" fill="{G}"/>{fork(130, 98, WHITE)}
  <text x="400" y="452" text-anchor="middle" font-family="{FONT}" font-size="330" fill="{LIME}">?</text>'''),
    'E5': ('포크 돋보기', f'''<rect width="600" height="600" fill="{G}"/>{fork(120, 98, WHITE)}
  <circle cx="380" cy="330" r="104" fill="{G}" stroke="{LIME}" stroke-width="32"/>
  <path d="m336 332 32 32 62-72" stroke="{WHITE}" stroke-width="32" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="m458 410 62 62" stroke="{LIME}" stroke-width="46" stroke-linecap="round"/>'''),
    'E6': ('가운데 큰 포크 + 체크 배지', f'''<rect width="600" height="600" fill="{G}"/>{fork(219, 70, WHITE, 1.2)}
  <circle cx="420" cy="430" r="104" fill="{G}"/>{check(420, 430, 88, YELLOW, G)}'''),
}

for key, (_, body) in ICONS.items():
    (OUT / f'fork-{key}.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">{body}\n</svg>\n', encoding='utf-8')

# 한쪽만 굵게 — 어느 쪽을 강조하느냐에 따라 읽히는 말이 달라진다.
WORDS = []
for family in ('Poppins', 'Montserrat'):
    WORDS.append((f'{family} · EAT 굵게', family, f'<span style="font-weight:500;color:#4f7a62">Wanna</span><span style="font-weight:900">EAT</span><i>?</i>'))
    WORDS.append((f'{family} · Wanna 굵게', family, f'<span style="font-weight:900">Wanna</span><span style="font-weight:500;color:#4f7a62">EAT</span><i>?</i>'))

cards = ''.join(f'''<figure><img src="/brand/options/fork-{key}.svg"><figcaption>{key}. {name}</figcaption>
  <div class="small"><img src="/brand/options/fork-{key}.svg"><img class="round" src="/brand/options/fork-{key}.svg"></div></figure>''' for key, (name, _) in ICONS.items())
marks = ''.join(f'''<div class="mark"><span class="n">{i + 1}. {label}</span>
  <span class="bar"><span class="w" style="font-family:'{family}',sans-serif;font-size:26px">{html}</span></span>
  <span class="bar phone"><img src="/brand/options/fork-E1.svg"><span class="w" style="font-family:'{family}',sans-serif;font-size:18px">{html}</span></span></div>''' for i, (label, family, html) in enumerate(WORDS))
sheet = f'''<!doctype html><html lang="ko"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;900&family=Poppins:wght@500;900&display=block" rel="stylesheet">
<style>body{{margin:0;padding:28px;background:#f3f5f0;font-family:'Segoe UI','Noto Sans KR',sans-serif;color:#253d32;width:1144px}}
h2{{margin:0 0 14px;font-size:20px}} .grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-bottom:30px}}
figure{{margin:0;background:#fff;border-radius:16px;padding:14px;border:1px solid #e0e7dc}} figure>img{{width:100%;display:block}}
figcaption{{margin:10px 0 8px;font-weight:700;font-size:15px}} .small{{display:flex;gap:12px;align-items:center}} .small img{{width:64px;height:64px}} .small img.round{{border-radius:16px;width:48px;height:48px}}
.mark{{display:flex;align-items:center;gap:14px;margin-bottom:12px}} .n{{width:190px;font-size:14px;font-weight:600}}
.bar{{flex:1;background:#fff;border-radius:12px;padding:14px 20px;display:flex;align-items:center;gap:10px}} .bar.phone{{flex:0 0 260px}} .bar.phone img{{width:28px;height:28px;border-radius:8px}}
.w{{color:#1E634D;letter-spacing:-.4px}} .w i{{font-style:normal;font-weight:900;color:#7CC242}}</style></head><body>
<h2>포크 아이콘 시안</h2><div class="grid">{cards}</div>
<h2>글씨 — 한쪽만 굵게 (왼쪽: 크게 · 오른쪽: 앱 상단 실제 크기)</h2>{marks}
</body></html>'''
(HERE.parent / 'public' / '_brand-sheet2.html').write_text(sheet, encoding='utf-8')
print('ok')

# 포크 돋보기에 노랑을 넣은 시안 (2026-10-02)
YELLOWS = {
    'Y1': ('돋보기 노랑', f'''<rect width="600" height="600" fill="{G}"/>{fork(120, 98, WHITE)}
  <circle cx="380" cy="330" r="104" fill="{G}" stroke="{YELLOW}" stroke-width="32"/>
  <path d="m336 332 32 32 62-72" stroke="{WHITE}" stroke-width="32" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="m458 410 62 62" stroke="{YELLOW}" stroke-width="46" stroke-linecap="round"/>'''),
    'Y2': ('돋보기 연두 + 체크 노랑', f'''<rect width="600" height="600" fill="{G}"/>{fork(120, 98, WHITE)}
  <circle cx="380" cy="330" r="104" fill="{G}" stroke="{LIME}" stroke-width="32"/>
  <path d="m336 332 32 32 62-72" stroke="{YELLOW}" stroke-width="34" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="m458 410 62 62" stroke="{LIME}" stroke-width="46" stroke-linecap="round"/>'''),
    'Y3': ('노랑 바탕', f'''<rect width="600" height="600" fill="{YELLOW}"/>{fork(120, 98, G)}
  <circle cx="380" cy="330" r="104" fill="{YELLOW}" stroke="{G}" stroke-width="32"/>
  <path d="m336 332 32 32 62-72" stroke="{G}" stroke-width="32" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="m458 410 62 62" stroke="{G}" stroke-width="46" stroke-linecap="round"/>'''),
}
for key, (_, body) in YELLOWS.items():
    (OUT / f'fork-{key}.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">{body}\n</svg>\n', encoding='utf-8')
cards = ''.join(f'''<figure><img src="/brand/options/fork-{key}.svg"><figcaption>{key}. {name}</figcaption>
  <div class="small"><img src="/brand/options/fork-{key}.svg"><img class="round" src="/brand/options/fork-{key}.svg"></div></figure>''' for key, (name, _) in YELLOWS.items())
(HERE.parent / 'public' / '_brand-sheet3.html').write_text(sheet.split('<h2>')[0] + f'<h2>포크 돋보기 + 노랑</h2><div class="grid">{cards}</div></body></html>', encoding='utf-8')
