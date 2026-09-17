#!/usr/bin/env python3
"""
CAS·INS 로 레이어 다시 잇기 — 이름 매칭을 대체한다

왜
  지금까지 모든 연결이 영문명 문자열 일치였다. 그래서 사고가 났다.
    자당 → Sucrose esters of fatty acids
  CAS 와 INS 는 표기가 달라도 같은 물질을 가리킨다. 이름을 안 봐도 된다.

어떻게
  한글 토큰 --(I1020/I2520 ENG_NM)--> JECFA 규격 --(CAS·INS)--> EFSA · FDA · EU
  JECFA 규격 Compendium 이 한글권과 국제 식별자 사이의 다리가 된다.

출력: data/prepared/identifier_map.csv
"""
import csv, io, os, re, sys

csv.field_size_limit(10**9)
PREP, RAW = "data/prepared", "data/raw"


def ne(s):
    return re.sub(r"[\s\-_,.()]", "", (s or "").strip().lower())


def norm_cas(s):
    s = (s or "").strip()
    m = re.search(r"\d{2,7}-\d{2}-\d", s)
    return m.group(0) if m else ""


def cas_valid(c):
    """CAS 체크디지트. 통과해도 물질이 같다는 증명은 아니지만, 실패하면 연결 키로 쓰지 않는다.
    JECFA 규격 530종 중 9건이 실패했다(예: Oxygen 7727-44-7, 실제 7782-44-7)."""
    m = re.fullmatch(r"(\d{2,7})-(\d{2})-(\d)", c or "")
    if not m:
        return False
    digits = (m.group(1) + m.group(2))[::-1]
    return int(m.group(3)) == sum(int(x) * (i + 1) for i, x in enumerate(digits)) % 10


def norm_ins(s):
    """INS·E번호에서 번호만 뗀다.
    3자리로 고정하면 E1519 가 151 이 되어 다른 물질에 붙는다. 4자리까지 본다."""
    s = (s or "").strip()
    m = re.search(r"\d{3,4}[a-z]?(?:\([ivx]+\))?", s, re.I)
    return m.group(0).lower() if m else ""


def load(p):
    p = os.path.join(PREP, p) if not p.startswith("data") else p
    if not os.path.exists(p):
        return []
    with io.open(p, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


# ── 다리: JECFA 규격 (영문명·이명 → CAS·INS) ─────────────
spec_by_name = {}
for r in load("jecfa_spec.csv"):
    names = [r["name"]] + re.split(r"[;,]", r.get("synonyms") or "")
    for n in names:
        k = ne(n)
        if k and r not in spec_by_name.setdefault(k, []):
            spec_by_name[k].append(r)
print(f"JECFA 규격 {len(spec_by_name):,}표제어 "
      f"(CAS {sum(1 for r in load('jecfa_spec.csv') if norm_cas(r['cas'])):,})")

# ── 목적지: CAS·INS 색인 ────────────────────────────────
efsa_cas = {}
for r in load("efsa_adi.csv"):
    c = norm_cas(r.get("cas"))
    if c and cas_valid(c) and c not in efsa_cas:
        efsa_cas[c] = r
fda_cas = {}
for r in load("fda_substances.csv"):
    c = norm_cas(r.get("cas"))
    if c and cas_valid(c) and c not in fda_cas:
        fda_cas[c] = r
# EU 는 INS 칸을 거의 비워두고 E번호로 식별한다. 그런데 둘은 같은 번호다
# (E 300 = INS 300). 번호만 떼어내면 이어진다.
eu_ins, eu_name = {}, {}
for r in load("eu_additives.csv"):
    i = norm_ins(r.get("ins_number")) or norm_ins(r.get("e_number"))
    if i and i not in eu_ins:
        eu_ins[i] = r
    k = ne(r.get("name"))
    if k and k not in eu_name:
        eu_name[k] = r
print(f"EFSA CAS {len(efsa_cas):,} · FDA CAS {len(fda_cas):,} · "
      f"EU INS {len(eu_ins):,} / 이름 {len(eu_name):,}")

# ── 우리 토큰 ──────────────────────────────────────────
out = []
stat = {"jecfa_spec": 0, "group_name": 0, "cas_invalid": 0, "cas": 0, "ins": 0, "efsa_by_cas": 0, "fda_by_cas": 0,
        "eu_by_ins": 0, "eu_by_name_only": 0}
for t in load("evidence_candidates.csv"):
    eng = t.get("영문명") or ""
    # 영문명 칸의 모든 이름이 가리키는 규격 항목을 모은다.
    # 서로 다른 물질이 둘 이상이면 묶음 이름이다(소르비탄지방산에스테르 → 5종).
    # 이때는 하나를 골라 식별자를 붙이지 않는다.
    found = []
    for part in re.split(r"[,;/]", eng):
        for r0 in spec_by_name.get(ne(part), []):
            if r0["name"] not in [x["name"] for x in found]:
                found.append(r0)
    scope = ("단일" if len(found) == 1 else
             f"묶음 이름(후보 {len(found)})" if found else "")
    sp = found[0] if len(found) == 1 else None
    raw_cas = norm_cas(sp.get("cas")) if sp else ""
    cas_ok = cas_valid(raw_cas)
    cas = raw_cas if cas_ok else ""
    ins = norm_ins(sp.get("ins")) if sp else ""
    if found:
        stat["jecfa_spec"] += 1
    if len(found) > 1:
        stat["group_name"] += 1
    if raw_cas and not cas_ok:
        stat["cas_invalid"] += 1
    if cas:
        stat["cas"] += 1
    if ins:
        stat["ins"] += 1

    e = efsa_cas.get(cas) if cas else None
    f = fda_cas.get(cas) if cas else None
    u = eu_ins.get(ins) if ins else None
    if e:
        stat["efsa_by_cas"] += 1
    if f:
        stat["fda_by_cas"] += 1
    if u:
        stat["eu_by_ins"] += 1
    elif t.get("E번호"):
        stat["eu_by_name_only"] += 1

    if found:
        out.append({
            "토큰": t["토큰"], "등장": t["등장"], "영문명": eng,
            "범위": scope,
            "JECFA 규격명": (sp or {}).get("name", "") or " ; ".join(x["name"] for x in found),
            "CAS": cas, "INS": ins,
            "CAS 검증": ("통과" if cas_ok else "체크디지트 실패 — 연결 안 함") if raw_cas else "",
            "EFSA(CAS 일치)": (e or {}).get("substance", ""),
            "FDA(CAS 일치)": (f or {}).get("substance", ""),
            "EU(INS 일치)": (u or {}).get("name", ""),
            "EU E번호": (u or {}).get("e_number", "") or t.get("E번호", ""),
        })

F = ["토큰", "등장", "영문명", "범위", "JECFA 규격명", "CAS", "INS", "CAS 검증",
     "EFSA(CAS 일치)", "FDA(CAS 일치)", "EU(INS 일치)", "EU E번호"]
dst = os.path.join(PREP, "identifier_map.csv")
with io.open(dst, "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=F)
    w.writeheader(); w.writerows(out)

if (sys.stdout.encoding or "").lower() not in ("utf-8", "utf8"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
print(f"\n식별자가 붙은 토큰 {len(out):,}종 → {dst}")
for k, v in stat.items():
    print(f"   {k:<18}{v:>6,}")
