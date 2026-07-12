from __future__ import annotations

import json
import re
from collections.abc import AsyncGenerator
from typing import Literal

from google.adk.models import BaseLlm, LlmRequest, LlmResponse
from google.genai import types


def _system_text(request: LlmRequest) -> str:
    instruction = request.config.system_instruction
    if instruction is None:
        return ""
    if isinstance(instruction, str):
        return instruction
    parts = getattr(instruction, "parts", None) or []
    return "".join(part.text or "" for part in parts)


def _extract_json(text: str, marker: str) -> dict:
    match = re.search(rf"{re.escape(marker)}<<(.*?)>>{re.escape(marker)}", text, re.DOTALL)
    if not match:
        return {}
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return {}


ACTIVITY_LIBRARY = {
    "book_store": ("ここで一冊", "表紙だけで気になる本を選び、10分だけ読んでください。", "timer", 10, 20, "green", "book"),
    "library": ("10分だけ読む", "棚を一つだけ眺め、気になったページを10分だけ読んでください。", "timer", 10, 20, "green", "book"),
    "park": ("静かな場所を探す", "一番落ち着くベンチを見つけ、保存していた記事を一つ読んでください。", "timer", 10, 15, "green", "leaf"),
    "garden": ("緑の中で止まる", "一番好きな緑を一つ選び、少しだけ眺めてください。", "tap", 8, 15, "green", "leaf"),
    "cafe": ("普段と違う一杯", "いつも選ばない飲み物を一つ選び、窓の外を見ながら休んでください。", "tap", 18, 25, "orange", "coffee"),
    "bakery": ("名前で選ぶ", "見た目ではなく、名前だけで気になったものを一つ選んでください。", "photo", 12, 20, "orange", "coffee"),
    "river": ("一曲だけ聴く", "水辺で立ち止まり、好きな曲を一曲だけ聴いてください。", "timer", 5, 10, "purple", "music"),
    "street": ("色を一つ残す", "この通りで一番気になった色を写真に残してください。", "photo", 8, 20, "pink", "camera"),
    "shopping": ("看板を一枚", "一番古そうな看板を見つけて写真に残してください。", "photo", 10, 20, "pink", "camera"),
    "art_gallery": ("一色だけ覚える", "作品を一つ選び、一番印象に残った色を覚えて帰ってください。", "tap", 20, 25, "purple", "sparkles"),
    "museum": ("知らなかった一つ", "初めて知ったことを一つだけ見つけてください。", "tap", 20, 25, "purple", "sparkles"),
    "shrine": ("静かな場所へ", "境内で一番音の少ない場所を見つけてください。", "tap", 8, 15, "green", "walk"),
    "station": ("知らない出口から", "普段使わない出口を選び、最初に気になった方向へ5分歩いてください。", "arrival", 8, 15, "purple", "walk"),
    "viewpoint": ("街を一枚にする", "今いる街を一枚の写真に収めてください。", "photo", 8, 20, "pink", "camera"),
}


class DemoMichikusaModel(BaseLlm):
    role: Literal["creative", "memory"]

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        text = _system_text(llm_request)
        if self.role == "creative":
            route = _extract_json(text, "ROUTE_JSON")
            activities = []
            for stop in route.get("stops", []):
                category = ((stop.get("place") or {}).get("category")) or "street"
                title, instruction, completion_type, duration, luck, color, icon = ACTIVITY_LIBRARY.get(
                    category, ACTIVITY_LIBRARY["street"]
                )
                activities.append(
                    {
                        "stop_id": stop.get("id", "stop"),
                        "short_label": title,
                        "title": title,
                        "instruction": instruction,
                        "completion_type": completion_type,
                        "duration_minutes": duration,
                        "luck": luck,
                        "color": color,
                        "icon": icon,
                    }
                )
            categories = [((stop.get("place") or {}).get("category")) for stop in route.get("stops", [])]
            route_title = "読む、歩く、少し寄る。" if any(c in {"book_store", "library"} for c in categories) else "今日は、道の方に決めてもらう。"
            payload = {
                "route_title": route_title,
                "route_subtitle": "行き先は考えなくていい。次のピンだけ追ってください。",
                "activities": activities,
            }
        else:
            plan = _extract_json(text, "PLAN_JSON")
            hour = int(plan.get("local_hour", 14))
            categories = plan.get("categories", [])
            if "book_store" in categories or "library" in categories:
                call_sign = "予定なき読書巡回員"
                theme = "本と休憩をつなぐ道草"
            elif hour >= 17:
                call_sign = "夕方から動き出す者"
                theme = "帰る前の小さな寄り道"
            elif plan.get("mode") == "departure":
                call_sign = "家を出た無目的旅人"
                theme = "生活圏を少し越える道草"
            else:
                call_sign = "路地裏を信じる者"
                theme = "知らない道を一つ選ぶ道草"
            payload = {
                "call_sign": call_sign,
                "theme": theme,
                "share_title": "TODAY'S MICHIKUSA",
            }

        yield LlmResponse(
            content=types.Content(role="model", parts=[types.Part(text=json.dumps(payload, ensure_ascii=False))]),
            partial=False,
        )
