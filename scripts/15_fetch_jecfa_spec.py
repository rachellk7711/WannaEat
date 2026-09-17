#!/usr/bin/env python3
"""
JECFA 규격 Compendium — 물질 식별 자료 (CAS · INS · 이명)

왜 필요한가
  이번 작업의 사고는 전부 이름 매칭에서 났다.
    자당 → 자당지방산에스테르 · 메밀가루 → 밀 · 돼지사골 → 쇠고기
  CAS 와 INS 는 이름이 달라도 같은 물질을 가리킨다. 식별 축이 생긴다.
  또 INS 는 Codex GSFA 의 열쇠이기도 하다.

경로
  목록  /jecfa-additives/browse-alphabetically/jsonlist/en/   530종
  상세  /jecfa-additives/detail/en/c/<id>/                    CAS·INS·이명

출력: data/prepared/jecfa_spec.csv
"""
import csv, io, json, os, re, ssl, sys, time, urllib.request

RAW, PREP = "data/raw/jecfa/spec", "data/prepared"
BASE = "https://www.fao.org/"
CAFILE = "/mingw64/etc/ssl/certs/ca-bundle.crt"
PAUSE = 0.3


def txt(h):
    h = re.sub(r"<script.*?</script>|<style.*?</style>", "", h, flags=re.S)
    h = re.sub(r"<[^>]+>", " ", h)
    return re.sub(r"\s+", " ", h).replace("&nbsp;", " ").strip()


def field(t, label, nexts):
    """'라벨 값 다음라벨' 형태에서 값만 떼어낸다."""
    i = t.find(label)
    if i < 0:
        return ""
    seg = t[i + len(label):]
    cut = len(seg)
    for n in nexts:
        j = seg.find(n)
        if 0 <= j < cut:
            cut = j
    return seg[:cut].strip(" :·&;")


LABELS = ["Synonym(s)", "Specification", "CAS number", "Codex GSFA Online",
          "INS number", "Contact", "Functional Class"]


def main():
    ctx = ssl.create_default_context(cafile=CAFILE if os.path.exists(CAFILE) else None)

    with io.open(os.path.join(RAW, "list.json"), encoding="utf-8") as f:
        items = json.load(f)
    targets = []
    for x in items:
        m = re.search(r"href='([^']+)'[^>]*>([^<]+)</a>", x["additive_name"])
        if m:
            targets.append((m.group(2).strip(), m.group(1)))
    print(f"대상 {len(targets):,}종")

    dst = os.path.join(PREP, "jecfa_spec.csv")
    done, out = set(), []
    if os.path.exists(dst):
        with io.open(dst, encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f):
                done.add(r["url"]); out.append(r)
        print(f"  이어받음 {len(out):,}건")

    F = ["name", "synonyms", "cas", "ins", "spec_monograph", "url"]
    n = 0
    for name, path in targets:
        url = BASE + path.lstrip("/")
        if url in done:
            continue
        n += 1
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=40, context=ctx) as r:
                t = txt(r.read().decode("utf-8", "replace"))
        except Exception as e:
            print(f"\n  !! {name}: {e}")
            time.sleep(2)
            continue
        out.append({
            "name": name,
            "synonyms": field(t, "Synonym(s)", LABELS[1:]),
            "cas": field(t, "CAS number", ["Codex", "INS number", "Contact"]),
            "ins": field(t, "INS number", ["Contact", "For questions"]),
            "spec_monograph": field(t, "Specification", ["CAS number", "Codex", "INS"]),
            "url": url,
        })
        if n % 25 == 0:
            with io.open(dst, "w", encoding="utf-8", newline="") as f:
                w = csv.DictWriter(f, fieldnames=F); w.writeheader(); w.writerows(out)
            print(f"\r  {n:,}/{len(targets):,}", end="", flush=True)
        time.sleep(PAUSE)

    with io.open(dst, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=F); w.writeheader(); w.writerows(out)
    cas = sum(1 for r in out if r["cas"])
    ins = sum(1 for r in out if r["ins"])
    print(f"\r  {len(out):,}종 → {dst} · CAS {cas:,} · INS {ins:,}")


if __name__ == "__main__":
    if (sys.stdout.encoding or "").lower() not in ("utf-8", "utf8"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
