import concurrent.futures as cf
import io
import json
import math
import sys
import time
from datetime import datetime
from typing import Any, Dict, Iterable, List, Tuple
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import pandas as pd

SSE_URL = "https://query.sse.com.cn/sseQuery/commonQuery.do"
SZSE_URL = "https://www.szse.cn/api/report/ShowReport"
TENCENT_URL = "https://qt.gtimg.cn/q="

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        if isinstance(value, float) and math.isnan(value):
            return default
        text = str(value).strip()
        if not text or text in {"-", "--", "nan", "None"}:
            return default
        return float(text.replace(",", ""))
    except Exception:
        return default


def safe_int(value: Any, default: int = 0) -> int:
    return int(round(safe_float(value, default)))


def iso_date(value: Any) -> str:
    text = str(value or "").strip()
    if not text or text == "-" or text.lower() == "nan":
        return ""
    digits = "".join(ch for ch in text if ch.isdigit())
    if len(digits) >= 8:
        return f"{digits[:4]}-{digits[4:6]}-{digits[6:8]}"
    return text


def fetch_text(url: str, headers: Dict[str, str] | None = None, timeout: int = 20) -> str:
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            req = Request(url, headers=headers or {})
            with urlopen(req, timeout=timeout) as resp:
                data = resp.read()
                charset = resp.headers.get_content_charset() or "utf-8"
                try:
                    return data.decode(charset, "ignore")
                except Exception:
                    return data.decode("utf-8", "ignore")
        except Exception as error:
            last_error = error
            if attempt < 2:
                time.sleep(0.6 * (attempt + 1))
    raise last_error or RuntimeError("fetch failed")


def fetch_bytes(url: str, headers: Dict[str, str] | None = None, timeout: int = 20) -> bytes:
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            req = Request(url, headers=headers or {})
            with urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except Exception as error:
            last_error = error
            if attempt < 2:
                time.sleep(0.6 * (attempt + 1))
    raise last_error or RuntimeError("fetch failed")


def fetch_json(url: str, headers: Dict[str, str] | None = None, timeout: int = 20) -> Any:
    return json.loads(fetch_text(url, headers=headers, timeout=timeout))


def fetch_sse_list() -> List[Dict[str, Any]]:
    params = {
        "STOCK_TYPE": "1",
        "REG_PROVINCE": "",
        "CSRC_CODE": "",
        "STOCK_CODE": "",
        "sqlId": "COMMON_SSE_CP_GPJCTPZ_GPLB_GP_L",
        "COMPANY_STATUS": "2,4,5,7,8",
        "type": "inParams",
        "isPagination": "true",
        "pageHelp.cacheSize": "1",
        "pageHelp.beginPage": "1",
        "pageHelp.pageSize": "10000",
        "pageHelp.pageNo": "1",
        "pageHelp.endPage": "1",
    }
    url = SSE_URL + "?" + urlencode(params)
    headers = {
        "Host": "query.sse.com.cn",
        "Pragma": "no-cache",
        "Referer": "https://www.sse.com.cn/assortment/stock/list/share/",
        "User-Agent": "Mozilla/5.0",
    }
    data = fetch_json(url, headers=headers, timeout=25)
    rows = data.get("pageHelp", {}).get("data", [])
    items: List[Dict[str, Any]] = []
    for row in rows:
        code = str(row.get("A_STOCK_CODE") or row.get("COMPANY_CODE") or "").zfill(6)
        if not code or code == "000000":
            continue
        items.append(
            {
                "code": code,
                "name": str(row.get("SEC_NAME_CN") or row.get("SEC_NAME_FULL") or "").strip(),
                "board": "主板",
                "market": "主板",
                "sector": str(row.get("CSRC_CODE_DESC") or "未分类").strip(),
                "province": str(row.get("AREA_NAME_DESC") or "未知").strip(),
                "city": "",
                "company": str(row.get("FULL_NAME") or row.get("COMPANY_ABBR") or "").strip(),
                "listDate": iso_date(row.get("LIST_DATE")),
                "floatShares": 0.0,
                "totalShares": 0.0,
                "source": "SSE",
            }
        )
    return items


def fetch_szse_list() -> List[Dict[str, Any]]:
    params = {
        "SHOWTYPE": "xlsx",
        "CATALOGID": "1110",
        "TABKEY": "tab1",
        "random": "0.1",
    }
    url = SZSE_URL + "?" + urlencode(params)
    content = fetch_bytes(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=25)
    df = pd.read_excel(io.BytesIO(content))
    items: List[Dict[str, Any]] = []
    for _, row in df.iterrows():
        board = str(row.get("板块") or "").strip() or "主板"
        if board not in {"主板", "创业板"}:
            continue
        code = str(row.get("A股代码") or "").strip()
        if not code or code.lower() == "nan":
            continue
        code = code.split(".")[0].zfill(6)
        name = str(row.get("A股简称") or "").strip()
        if not name:
            continue
        total_shares = safe_float(row.get("A股总股本"))
        float_shares = safe_float(row.get("A股流通股本"))
        items.append(
            {
                "code": code,
                "name": name,
                "board": board,
                "market": board,
                "sector": str(row.get("所属行业") or "未分类").strip(),
                "province": str(row.get("省    份") or "").strip() or "未知",
                "city": str(row.get("城     市") or "").strip(),
                "company": str(row.get("公司全称") or "").strip() or name,
                "listDate": iso_date(row.get("A股上市日期")),
                "floatShares": float_shares,
                "totalShares": total_shares,
                "source": "SZSE",
            }
        )
    return items


def batch(items: List[str], size: int) -> Iterable[List[str]]:
    for index in range(0, len(items), size):
        yield items[index : index + size]


def fetch_tencent_quotes(symbols: List[str]) -> Dict[str, Dict[str, Any]]:
    def worker(symbol_group: List[str]) -> Dict[str, Dict[str, Any]]:
        if not symbol_group:
            return {}
        url = TENCENT_URL + ",".join(symbol_group)
        text = fetch_text(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=25)
        out: Dict[str, Dict[str, Any]] = {}
        for line in text.splitlines():
            if "=" not in line:
                continue
            left, right = line.split("=", 1)
            symbol = left.replace("v_", "").strip()
            if not symbol:
                continue
            raw = right.strip().strip(";").strip('"')
            parts = raw.split("~")
            if len(parts) < 6:
                continue
            code = parts[2].strip()
            if not code:
                continue
            prev_close = safe_float(parts[4])
            price = safe_float(parts[3])
            high = safe_float(parts[33]) if len(parts) > 33 else 0.0
            low = safe_float(parts[34]) if len(parts) > 34 else 0.0
            amount = safe_float(parts[37]) * 10000.0 if len(parts) > 37 else 0.0
            turnover = safe_float(parts[49]) if len(parts) > 49 else 0.0
            out[code] = {
                "symbol": symbol,
                "code": code,
                "name": parts[1].strip(),
                "price": price,
                "prevClose": prev_close,
                "open": safe_float(parts[5]),
                "volume": safe_float(parts[6]),
                "amount": amount,
                "changeAbs": safe_float(parts[31]) if len(parts) > 31 else price - prev_close,
                "changePct": safe_float(parts[32]) if len(parts) > 32 else 0.0,
                "high": high,
                "low": low,
                "turnover": turnover,
                "pe": safe_float(parts[39]) if len(parts) > 39 else 0.0,
            }
        return out

    symbols = list(dict.fromkeys(symbols))
    quotes: Dict[str, Dict[str, Any]] = {}
    with cf.ThreadPoolExecutor(max_workers=6) as pool:
        for chunk_quotes in pool.map(worker, batch(symbols, 360)):
            quotes.update(chunk_quotes)
    return quotes


def percentile_rank(sorted_values: List[float], value: float) -> float:
    if not sorted_values:
        return 0.5
    low = 0
    high = len(sorted_values)
    while low < high:
        mid = (low + high) // 2
        if sorted_values[mid] <= value:
            low = mid + 1
        else:
            high = mid
    return low / len(sorted_values)


def rank_from_score(score: int) -> str:
    if score >= 88:
        return "重点关注"
    if score >= 80:
        return "可观察"
    if score >= 72:
        return "观察中"
    return "暂不介入"


def strategy_from_record(record: Dict[str, Any], score: int) -> str:
    change_pct = record["changePct"]
    amplitude = record["amplitude"]
    if score >= 90 and change_pct >= 3 and amplitude <= 10:
        return "强势趋势"
    if score >= 84 and change_pct >= 0:
        return "回踩观察"
    if score >= 78:
        return "低吸观察"
    if score >= 72:
        return "等待确认"
    return "观望"


def build_buy_zone(record: Dict[str, Any], strategy: str) -> Tuple[float, float]:
    price = record["price"]
    if price <= 0:
        return 0.0, 0.0
    vol_adjust = clamp(record["amplitude"] / 800.0, 0.008, 0.03)
    board_adjust = 0.012 if record["board"] == "创业板" else 0.0
    strategy_map = {
        "强势趋势": (0.018 + vol_adjust + board_adjust, 0.006 + vol_adjust / 2),
        "回踩观察": (0.032 + vol_adjust + board_adjust, 0.014 + vol_adjust / 2),
        "低吸观察": (0.050 + vol_adjust + board_adjust, 0.022 + vol_adjust / 2),
        "等待确认": (0.068 + vol_adjust + board_adjust, 0.032 + vol_adjust / 2),
        "观望": (0.085 + vol_adjust + board_adjust, 0.045 + vol_adjust / 2),
    }
    low_gap, high_gap = strategy_map.get(strategy, strategy_map["观望"])
    low = price * (1 - low_gap)
    high = price * (1 - high_gap)
    return min(low, high), max(low, high)


def build_trigger(record: Dict[str, Any], strategy: str) -> str:
    if strategy == "强势趋势":
        return "放量站稳后再考虑"
    if strategy == "回踩观察":
        return "回踩支撑后缩量企稳"
    if strategy == "低吸观察":
        return "等回落到观察区间"
    if strategy == "等待确认":
        return "等趋势重新站稳后再看"
    if record["changePct"] < 0:
        return "等止跌并重新放量"
    return "等待确认信号出现"


def build_position_pct(strategy: str, risk: str) -> int:
    base = {
        "强势趋势": 25,
        "回踩观察": 20,
        "低吸观察": 15,
        "等待确认": 10,
        "观望": 0,
    }.get(strategy, 10)
    if risk == "高":
        return max(0, base - 8)
    if risk == "中":
        return max(0, base - 3)
    return base


def build_confidence(score: int, strategy: str) -> str:
    if score >= 92:
        return "高"
    if score >= 86:
        return "较高" if strategy != "观望" else "中"
    if score >= 78:
        return "中"
    return "偏低"


def build_risk(record: Dict[str, Any]) -> str:
    amount = record["amount"]
    if amount < 150000000:
        return "高" if record["board"] == "创业板" else "中"
    if record["amplitude"] >= 12:
        return "高" if record["board"] == "创业板" else "中"
    if record["changePct"] >= 5:
        return "中"
    if record["changePct"] >= 2:
        return "中" if record["board"] == "创业板" else "低"
    if record["changePct"] >= 0:
        return "中" if record["board"] == "创业板" else "低"
    return "中" if record["board"] == "创业板" else "低"


def build_logic(record: Dict[str, Any], sector_rank: int, hot_label: str, strategy: str) -> List[str]:
    parts = []
    parts.append(f"{record['sector']}这一类最近热度{hot_label}，可以多留意。")
    parts.append(
        f"{record['board']}股票一般更适合{'看成长机会' if record['board'] == '创业板' else '看稳一点的机会'}。"
    )
    amount_yi = record["amount"] / 100000000.0
    parts.append(f"最新成交额约{amount_yi:.2f}亿元，买卖方便度{'还不错' if amount_yi >= 10 else '一般'}.")
    parts.append(f"现在更偏向{strategy}这种看法。")
    if sector_rank <= 2:
        parts.append("这个方向排得比较前，可以放进重点观察名单。")
    return parts


def build_company_intro(record: Dict[str, Any]) -> str:
    company = (record.get("company") or record.get("name") or "这家公司").strip()
    sector = (record.get("sector") or "未分类").strip()
    themes = record.get("themes") or []
    theme_text = "、".join(themes) if themes else ""

    if "AI" in themes and "机器人" in themes:
        core = "AI和机器人相关业务"
    elif "AI" in themes:
        core = "AI相关业务"
    elif "机器人" in themes:
        core = "机器人相关业务"
    elif "信息技术" in sector or "软件" in sector:
        core = "信息技术和软件相关业务"
    elif "医药" in sector or "卫生" in sector:
        core = "医药健康相关业务"
    elif "新能源" in sector:
        core = "新能源相关业务"
    elif "金融" in sector:
        core = "金融服务相关业务"
    else:
        core = f"{sector}相关业务"

    if theme_text:
        return f"{company}主要做{core}，同时也带有{theme_text}方向。"
    return f"{company}主要做{core}。"


def build_risk_notes(record: Dict[str, Any]) -> List[str]:
    notes = []
    if record["board"] == "创业板":
        notes.append("创业板起伏通常更大，不要一下子买太多。")
    if record["changePct"] < 0:
        notes.append("短期有点弱，最好先等等。")
    if record["amount"] < 200000000:
        notes.append("成交额不算高，追的时候要留心买卖是否顺畅。")
    if not notes:
        notes.append("建议分批看，不要一次冲太满。")
    return notes


def derive_themes(record: Dict[str, Any]) -> List[str]:
    text = " ".join(
        str(part or "")
        for part in [record.get("sector"), record.get("company"), record.get("name")]
    )
    text_lower = text.lower()
    themes: List[str] = []

    ai_keywords = [
        "信息技术",
        "软件",
        "计算机",
        "通信",
        "电子",
        "半导体",
        "芯片",
        "智能",
        "云",
        "数据",
        "算法",
        "AI",
        "人工智能",
    ]
    robot_keywords = [
        "机器人",
        "自动化",
        "工业自动化",
        "智能制造",
        "工业母机",
        "机械",
        "装备",
        "机床",
        "传感器",
        "伺服",
    ]

    if any(keyword.lower() in text_lower for keyword in ai_keywords):
        themes.append("AI")
    if any(keyword.lower() in text_lower for keyword in robot_keywords):
        themes.append("机器人")
    return themes


def sector_hot_label(rank: int) -> str:
    if rank < 0:
        return "中性"
    if rank <= 2:
        return "较高"
    if rank <= 5:
        return "一般"
    return "偏低"


def build_indices(quotes: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    mapping = [
        ("sh000001", "上证指数"),
        ("sz399001", "深证成指"),
        ("sz399006", "创业板指"),
    ]
    out = []
    for symbol, name in mapping:
        q = quotes.get(symbol.replace("sh", "").replace("sz", ""), {})
        point = q.get("price", 0.0)
        prev = q.get("prevClose", 0.0)
        change_pct = q.get("changePct", 0.0)
        if not change_pct and prev:
            change_pct = (point - prev) / prev * 100
        out.append(
            {
                "code": symbol,
                "name": name,
                "point": point,
                "changePct": change_pct,
                "changeAbs": q.get("changeAbs", point - prev),
                "open": q.get("open", 0.0),
                "high": q.get("high", 0.0),
                "low": q.get("low", 0.0),
                "amount": q.get("amount", 0.0),
            }
        )
    return out


def build_universe() -> Dict[str, Any]:
    with cf.ThreadPoolExecutor(max_workers=2) as pool:
        sse_future = pool.submit(fetch_sse_list)
        szse_future = pool.submit(fetch_szse_list)
        sse_rows = sse_future.result()
        szse_rows = szse_future.result()

    records = [*sse_rows, *szse_rows]
    symbols = [
        ("sh" if row["code"].startswith("6") else "sz") + row["code"]
        for row in records
    ]
    symbols.extend(["sh000001", "sz399001", "sz399006"])
    quotes = fetch_tencent_quotes(symbols)
    index_quotes = {k: v for k, v in quotes.items() if k in {"000001", "399001", "399006"}}

    base_records: List[Dict[str, Any]] = []
    for row in records:
        symbol = ("sh" if row["code"].startswith("6") else "sz") + row["code"]
        q = quotes.get(row["code"], {})
        price = q.get("price", 0.0)
        prev_close = q.get("prevClose", 0.0)
        change_pct = q.get("changePct", 0.0)
        if not change_pct and prev_close:
            change_pct = (price - prev_close) / prev_close * 100
        high = q.get("high", 0.0)
        low = q.get("low", 0.0)
        amplitude = ((high - low) / prev_close * 100) if prev_close else 0.0
        amount = q.get("amount", 0.0)
        turnover = q.get("turnover", 0.0)
        base_records.append(
            {
                **row,
                "symbol": symbol,
                "price": price,
                "prevClose": prev_close,
                "changePct": change_pct,
                "changeAbs": q.get("changeAbs", price - prev_close),
                "open": q.get("open", 0.0),
                "high": high,
                "low": low,
                "amplitude": amplitude,
                "volume": q.get("volume", 0.0),
                "amount": amount,
                "turnover": turnover,
                "marketCap": row.get("floatShares", 0.0) * price if row.get("floatShares") else 0.0,
            }
        )
    for record in base_records:
        record["themes"] = derive_themes(record)
        record["intro"] = build_company_intro(record)

    stats = {
        "changePctAsc": sorted(item["changePct"] for item in base_records),
        "amountAsc": sorted(item["amount"] for item in base_records),
        "turnoverAsc": sorted(item["turnover"] for item in base_records),
        "amplitudeAsc": sorted(item["amplitude"] for item in base_records),
    }

    sector_stats: Dict[str, Dict[str, float]] = {}
    for record in base_records:
        sector = record["sector"] or "未分类"
        current = sector_stats.setdefault(
            sector,
            {"sector": sector, "count": 0, "gainSum": 0.0, "amountSum": 0.0},
        )
        current["count"] += 1
        current["gainSum"] += record["changePct"]
        current["amountSum"] += record["amount"]

    sectors = []
    for item in sector_stats.values():
        count = item["count"] or 1
        avg_change = item["gainSum"] / count
        amount_score = math.log10(item["amountSum"] / 100000000.0 + 1.0)
        hot_score = avg_change * 4.0 + math.log2(count + 1.0) + amount_score
        sectors.append(
            {
                "sector": item["sector"],
                "count": item["count"],
                "avgChange": avg_change,
                "amountSum": item["amountSum"],
                "hotScore": hot_score,
            }
        )

    sectors.sort(key=lambda item: item["hotScore"], reverse=True)
    sector_rank = {item["sector"]: index for index, item in enumerate(sectors)}
    theme_set = sorted({theme for record in base_records for theme in record.get("themes", [])})

    enriched: List[Dict[str, Any]] = []
    for record in base_records:
        rank = sector_rank.get(record["sector"], -1)
        score = int(
            round(
                clamp(
                    34
                    + clamp(percentile_rank(stats["changePctAsc"], record["changePct"]) * 34 + record["changePct"] * 0.9, 0, 36)
                    + clamp(percentile_rank(stats["amountAsc"], record["amount"]) * 18 + percentile_rank(stats["turnoverAsc"], record["turnover"]) * 8, 0, 26)
                    + clamp((1 - percentile_rank(stats["amplitudeAsc"], record["amplitude"])) * 14, 0, 14)
                    + (3 if record["board"] == "创业板" and record["changePct"] > 1 else 1 if record["board"] == "创业板" else 4)
                    + (0 if rank < 0 else clamp(8 - rank * 1.35, 1, 8))
                    - (4 if record["amount"] < 200000000 else 0)
                    - (6 if record["changePct"] < 0 else 0)
                    - (4 if record["amplitude"] > 12 else 0),
                    0,
                    100,
                )
            )
        )
        strategy = strategy_from_record(record, score)
        risk = build_risk(record)
        buy_low, buy_high = build_buy_zone(record, strategy)
        enriched.append(
            {
                **record,
                "score": score,
                "rank": rank_from_score(score),
                "risk": risk,
                "strategy": strategy,
                "buyZone": [round(buy_low, 2), round(buy_high, 2)],
                "trigger": build_trigger(record, strategy),
                "confidence": build_confidence(score, strategy),
                "positionPct": build_position_pct(strategy, risk),
                "support": round(buy_low, 2),
                "resistance": round(buy_high, 2),
                "logic": build_logic(record, rank, sector_hot_label(rank), strategy),
                "intro": record["intro"],
                "riskNotes": build_risk_notes(record),
                "sectorRank": rank,
                "hotLabel": sector_hot_label(rank),
            }
        )

    enriched.sort(key=lambda item: item["score"], reverse=True)

    up_count = sum(1 for item in enriched if item["changePct"] > 0)
    down_count = sum(1 for item in enriched if item["changePct"] < 0)
    flat_count = len(enriched) - up_count - down_count
    avg_change = sum(item["changePct"] for item in enriched) / len(enriched) if enriched else 0.0
    if avg_change >= 2:
        mood = "偏强"
    elif avg_change >= 0.5:
        mood = "温和偏强"
    elif avg_change >= -0.5:
        mood = "震荡"
    else:
        mood = "偏弱"

    indices = build_indices(index_quotes)

    summary = {
        "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "total": len(enriched),
        "upCount": up_count,
        "downCount": down_count,
        "flatCount": flat_count,
        "avgChange": round(avg_change, 2),
        "mood": mood,
        "indices": indices,
        "hotSectors": sectors[:8],
        "sectorOptions": [item["sector"] for item in sectors[:12] if item["sector"]] + theme_set,
        "topCount": sum(1 for item in enriched if item["score"] >= 80),
    }

    return {"summary": summary, "stocks": enriched}


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "universe"
    if cmd == "universe":
        payload = build_universe()
        print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        return

    raise SystemExit(f"Unknown command: {cmd}")


if __name__ == "__main__":
    main()
