#!/usr/bin/env python3
"""从「阿里巴巴国际站-全站产品类目表.xlsx」生成 data/alibabaFullTaxonomy.nodes.json

用法:
  PYTHONPATH=.tmp_pydeps python3 scripts/buildAlibabaTaxonomyFromExcel.py /path/to/类目表.xlsx
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path


def slug(s: str) -> str:
    s = (s or "").lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_")[:56] or "other"


def extract_id(url: str | None) -> str | None:
    if not url:
        return None
    m = re.search(r"_(\d+)\.html?$", str(url).strip(), re.I)
    return m.group(1) if m else None


OLD_TOY_L1 = {
    "100001718": "Stuffed Animals & Plush Toys",
    "1501": "Baby Supplies & Products",
    "201345511": "Baby Care",
    "201449901": "Novelty & Gag Toys",
    "201761601": "Designer Toys & Blind Boxes",
    "100001714": "Educational Toys",
    "100001719": "Outdoor Toys & Structures",
    "127660035": "Children's Clothing",
    "201944705": "Pregnancy & Maternity",
    "202241004": "Anime & Game&Cards",
    "201946307": "Baby Furniture and Bedding",
    "201945205": "Diapering",
    "100001715": "Classic Toys",
    "100001698": "Baby & Toddler Toys",
    "201459117": "Blocks & Model Building Toys",
    "100001716": "Dress Up & Pretend Play",
    "100001717": "Toy Vehicle",
    "201607003": "Baby Clothing",
    "201777404": "Remote Control Toys",
    "201606103": "Toddler Clothing",
    "201457731": "Puzzle & Games",
    "201331508": "Kids Shoes",
}


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    xlsx = Path(sys.argv[1])
    if not xlsx.exists():
        print("missing", xlsx)
        return 1

    try:
        import openpyxl
    except ImportError:
        print("需要 openpyxl：pip install --target .tmp_pydeps openpyxl")
        return 1

    wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = list(ws.iter_rows(values_only=True))
    wb.close()
    data = rows[1:]

    roots: dict = {}
    l1s: dict = {}
    l2s: list = []
    cur_root = cur_l1 = None
    missing_url = 0

    for r in data:
        if not r or all(x is None or str(x).strip() == "" for x in r):
            continue
        cells = (list(r) + [None] * 7)[:7]
        r0, r1, r2, r3, r4, r5, r6 = cells
        if r0 and str(r0).strip():
            cur_root = (str(r0).strip(), str(r1 or "").strip())
        if r2 and str(r2).strip():
            cur_l1 = (str(r2).strip(), str(r3 or "").strip())
        if not cur_root or not cur_l1:
            continue
        l2en = str(r4 or "").strip()
        l2zh = str(r5 or "").strip()
        url = str(r6 or "").strip() if r6 else ""
        if not l2en and not l2zh:
            continue
        root_en, root_zh = cur_root
        l1_en, l1_zh = cur_l1
        root_id = f"root__{slug(root_en)}"
        l1_id = f"l1__{slug(root_en)}__{slug(l1_en)}"
        pid = extract_id(url)
        if pid:
            l2_id = pid
        else:
            missing_url += 1
            l2_id = f"l2__{slug(root_en)}__{slug(l1_en)}__{slug(l2en or l2zh)}"
        if root_id not in roots:
            roots[root_id] = {
                "id": root_id,
                "level": 0,
                "nameEn": root_en,
                "nameZh": root_zh or root_en,
            }
        if l1_id not in l1s:
            l1s[l1_id] = {
                "id": l1_id,
                "level": 1,
                "nameEn": l1_en,
                "nameZh": l1_zh or l1_en,
                "parentId": root_id,
            }
        l2s.append(
            {
                "id": l2_id,
                "level": 2,
                "nameEn": l2en or l2zh,
                "nameZh": l2zh or l2en,
                "parentId": l1_id,
                "rootId": root_id,
                "url": url or None,
                "platformId": pid,
            }
        )

    seen = set()
    for n in l2s:
        if n.get("platformId"):
            if n["id"] in seen:
                n["id"] = f"{n['platformId']}__{slug(n['nameEn'])}"
            else:
                seen.add(n["id"])

    nodes = []
    for r in roots.values():
        nodes.append(
            {
                "id": r["id"],
                "level": 0,
                "nameEn": r["nameEn"],
                "nameZh": r["nameZh"],
                "parentId": None,
                "aliases": [r["nameEn"], r["nameZh"]],
            }
        )
    for l1 in l1s.values():
        nodes.append(
            {
                "id": l1["id"],
                "level": 1,
                "nameEn": l1["nameEn"],
                "nameZh": l1["nameZh"],
                "parentId": l1["parentId"],
                "aliases": [l1["nameEn"], l1["nameZh"]],
            }
        )
    for n in l2s:
        aliases = [n["nameEn"], n["nameZh"]]
        if n.get("platformId"):
            aliases.append(n["platformId"])
        nodes.append(
            {
                "id": n["id"],
                "level": 2,
                "nameEn": n["nameEn"],
                "nameZh": n["nameZh"],
                "parentId": n["parentId"],
                "rootId": n.get("rootId"),
                "url": n.get("url"),
                "aliases": aliases,
            }
        )

    by_en = {n["nameEn"].lower(): n for n in nodes if n["level"] == 1}
    legacy = {}
    for oid, name in OLD_TOY_L1.items():
        hit = by_en.get(name.lower())
        if hit:
            legacy[oid] = hit["id"]
            if oid not in hit["aliases"]:
                hit["aliases"].append(oid)

    out = {
        "version": "alibaba-full-regen",
        "stats": {
            "roots": len(roots),
            "l1": len(l1s),
            "l2": len(l2s),
            "missingUrl": missing_url,
        },
        "nodes": nodes,
        "legacyL1IdMap": legacy,
        "toyRootId": "root__parents_kids_and_toys",
    }
    dest = Path(__file__).resolve().parents[1] / "data" / "alibabaFullTaxonomy.nodes.json"
    dest.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("wrote", dest, "stats", out["stats"], "legacy", len(legacy))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
