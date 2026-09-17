#!/usr/bin/env python3
"""
성분 사전 2단계 — 공공 마스터 대조 + 파생어 규칙

입력
  data/prepared/products.csv          우리 제품 DB (원재료 토큰의 출처)
  data/raw/I2520_rawmtrl_code.csv     식품원재료코드 43,612
  data/raw/I1020_rawmtrl_info.csv     식품원재료 정보 24,875

출력
  data/prepared/ingredient_tokens.csv  토큰별 매칭 결과 (사람 검수용)
  콘솔: 커버리지 측정 (등장 기준 / 제품 완전 판독 기준)

매칭 순서
  1) 정확 일치   토큰 == 마스터 대표명·이명
  2) 파생어      토큰이 '마스터명 + 접미사' 형태  (신양벚나무열매분말 → 신양벚나무열매)
  3) 접미사 제거 후 일치
  나머지는 status=unmatched → 3단계 LLM 분류 대상
"""
import csv, io, os, re, sys
from collections import Counter

csv.field_size_limit(10**9)
PREP, RAW = "data/prepared", "data/raw"

SUFFIX = ["분말","가루","농축액","농축분말","추출물","추출액","엑기스","시럽","액상","액","즙",
          "오일","기름","유","가공품","조제품","혼합제제","제제","페이스트","퓨레","슬라이스",
          "다이스","동결건조","건조","정제","크림","소스","시즈닝","향료","향","색소","전분",
          "분리물","단백","박","씨앗","씨","잎","뿌리","껍질","열매","줄기","꽃","분"]


# 끝에 붙은 숫자 중 물질을 구분하는 번호는 지우면 안 된다.
#   비타민B2·B12·D3 가 모두 '비타민b' 로 합쳐져 비타민b → Riboflavin 오연결이 났다.
#   폴리소르베이트 20·60·65·80 은 서로 다른 첨가물이다.
# 지워도 되는 것은 함량(10%, 0.5)과 제품 변형 번호(식염1, 물엿3)뿐이다.
KEEP_NUM_BASE = ("폴리소르베이트",)


def strip_trailing_num(s):
    m = re.search(r"\d+(\.\d+)?%?$", s)
    if not m:
        return s
    num, head = m.group(0), s[:m.start()]
    if num.endswith("%") or "." in num:
        return head
    if head and re.match(r"[A-Za-z]", head[-1]):
        return s
    if head.endswith(KEEP_NUM_BASE):
        return s
    return head


def norm(s):
    s = (s or "").split("(")[0]
    s = re.sub(r"[\s·ㆍ・/\-‐‑–—_]", "", s)
    s = strip_trailing_num(s)
    s = s.replace(".", "")
    return s.strip().lower()


def split_top(s):
    out, depth, cur = [], 0, []
    for ch in s:
        if ch in "([{": depth += 1
        elif ch in ")]}": depth = max(0, depth - 1)
        if ch == "," and depth == 0:
            out.append("".join(cur).strip()); cur = []
        else:
            cur.append(ch)
    if cur: out.append("".join(cur).strip())
    return [x for x in out if x]


# ── 1. 공공 마스터 적재 ──────────────────────────────────
master = {}   # 정규화명 → (표준 표기, 분류, 출처)

def add(name, cls, src):
    n = norm(name)
    # 한 글자 재료도 넣는다 (쌀·무·배·파·김·소·닭·밀·팥 …)
    # 단 파생어 매칭에서는 2글자 이상만 기반어로 쓴다 — '무'가 '무화과'에 걸리면 안 된다
    if not n or n in master:
        return
    master[n] = (name.strip(), cls or "", src)

def split_names(v):
    """이명 칸을 나눈다. 괄호 안의 쉼표에서는 나누지 않는다.
    '폴리(옥시-1,2-에탄다이일)' 이 '폴리(옥시-1' 로 잘려 사전에 들어간 조각이 12,065개 있었다."""
    out, depth, cur = [], 0, []
    for ch in v or "":
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth = max(0, depth - 1)
        if ch in ",;/" and depth == 0:
            out.append("".join(cur)); cur = []
        else:
            cur.append(ch)
    out.append("".join(cur))
    return [x.strip() for x in out if x.strip()]


def load_master(fn, name_cols, cls_col, src):
    path = os.path.join(RAW, fn)
    if not os.path.exists(path):
        print(f"!! {path} 없음 — 건너뜀"); return 0
    n = 0
    with io.open(path, encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            cls = row.get(cls_col, "") if cls_col else "첨가물"
            for c in name_cols:
                v = row.get(c) or ""
                for part in split_names(v):             # 이명은 여러 개가 한 칸에 있다
                    add(part, cls, src); n += 1
    return n

load_master("I2520_rawmtrl_code.csv", ["RPRSNT_RAWMTRL_NM", "RAWMTRL_NCKNM"], "RAWMTRL_MLSFC_NM", "I2520")
load_master("I1020_rawmtrl_info.csv", ["RPRSNT_RAWMTRL_NM", "RAWMTRL_NCKNM"], "MLSFC_NM", "I1020")
# 식품첨가물공전 — 국내 지정 첨가물 664품목. 원재료 마스터에 없는 층을 메운다
load_master("I0950_additive_std.csv", ["PC_KOR_NM"], None, "I0950")
print(f"공공 마스터 표제어 {len(master):,}개")

# ── 2. 우리 토큰 집계 ────────────────────────────────────
cnt, prods = Counter(), []
with io.open(os.path.join(PREP, "products.csv"), encoding="utf-8", newline="") as f:
    for row in csv.DictReader(f):
        ts = [norm(t) for t in split_top(row["rawmtrl_nm"])]
        ts = [t for t in ts if t]
        cnt.update(ts); prods.append(set(ts))
occ = sum(cnt.values())
print(f"우리 토큰 {len(cnt):,}종 · 등장 {occ:,} · 제품 {len(prods):,}")

# ── 3. 매칭 ─────────────────────────────────────────────
result = {}   # 토큰 → (status, 표준명, 분류, 출처)

for t in cnt:
    if t in master:
        std, cls, src = master[t]
        result[t] = ("exact", std, cls, src); continue
    hit = None
    for k in range(len(t) - 1, 1, -1):                   # 파생어: 앞부분이 마스터 (2글자 이상만)
        if t[:k] in master:
            std, cls, src = master[t[:k]]
            hit = ("derived", std, cls, src); break
    if not hit:
        for s in SUFFIX:                                  # 접미사 제거 후 일치
            if t.endswith(s) and norm(t[:-len(s)]) in master:
                std, cls, src = master[norm(t[:-len(s)])]
                hit = ("suffix", std, cls, src); break
    result[t] = hit or ("unmatched", "", "", "")

# ── 4. 측정 ─────────────────────────────────────────────
by_status = Counter(v[0] for v in result.values())
occ_by_status = Counter()
for t, c in cnt.items():
    occ_by_status[result[t][0]] += c

print("\n매칭 결과")
for s in ("exact", "derived", "suffix", "unmatched"):
    print(f"  {s:<10} {by_status[s]:>7,}종 ({by_status[s]/len(cnt):>5.1%})   "
          f"등장 {occ_by_status[s]:>10,} ({occ_by_status[s]/occ:>6.2%})")

known = {t for t, v in result.items() if v[0] != "unmatched"}
full = sum(1 for s in prods if s <= known)
print(f"\n제품 완전 판독: {full:,}/{len(prods):,} = {full/len(prods):.2%}")

# ── 5. 검수용 출력 ──────────────────────────────────────
out = os.path.join(PREP, "ingredient_tokens.csv")
with io.open(out, "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f)
    w.writerow(["token", "occurrences", "status", "std_name", "class", "source"])
    for t, c in cnt.most_common():
        st, std, cls, src = result[t]
        w.writerow([t, c, st, std, cls, src])
print(f"→ {out} ({os.path.getsize(out)/1048576:.1f} MB)")

rest = [(t, c) for t, c in cnt.most_common() if result[t][0] == "unmatched"]
print(f"\n미매칭 상위 20 (3단계 LLM 분류 대상 {len(rest):,}종):")
for t, c in rest[:20]:
    print(f"   {c:>8,}  {t}")
