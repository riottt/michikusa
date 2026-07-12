from __future__ import annotations

import asyncio
from urllib.parse import quote

import httpx

from ..config import get_settings
from ..models import CalendarCommitRequest, CalendarCommitResponse, CalendarEventDraft


async def _ensure_calendar(client: httpx.AsyncClient, access_token: str, calendar_id: str | None) -> str:
    if calendar_id:
        return calendar_id
    settings = get_settings()
    response = await client.post(
        f"{settings.calendar_api_base}/calendars",
        headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
        json={"summary": "MICHIKUSA", "description": "AIが組み立てた道草タイムライン", "timeZone": "Asia/Tokyo"},
    )
    response.raise_for_status()
    return response.json()["id"]


def _event_body(event: CalendarEventDraft) -> dict:
    body = {
        "summary": event.summary,
        "description": event.description,
        "start": {"dateTime": event.start.isoformat(), "timeZone": "Asia/Tokyo"},
        "end": {"dateTime": event.end.isoformat(), "timeZone": "Asia/Tokyo"},
        "extendedProperties": {
            "private": {
                "michikusaEventId": event.id,
                "michikusaKind": event.kind,
            }
        },
    }
    if event.location:
        body["location"] = event.location
    if event.color_id:
        body["colorId"] = event.color_id
    return body


async def commit_calendar(request: CalendarCommitRequest) -> CalendarCommitResponse:
    if request.demo or request.access_token.startswith("demo-"):
        await asyncio.sleep(0.22)
        calendar_id = request.calendar_id or "demo-michikusa-calendar"
        ids = [f"demo-event-{index + 1}" for index, _ in enumerate(request.plan.calendar_events)]
        return CalendarCommitResponse(
            calendar_id=calendar_id,
            calendar_summary="MICHIKUSA",
            event_ids=ids,
            html_links=[],
            created=len(ids),
            updated=0,
            demo=True,
        )

    timeout = httpx.Timeout(15.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        calendar_id = await _ensure_calendar(client, request.access_token, request.calendar_id)
        event_ids: list[str] = []
        html_links: list[str] = []
        created = 0
        updated = 0
        for index, event in enumerate(request.plan.calendar_events):
            body = _event_body(event)
            headers = {"Authorization": f"Bearer {request.access_token}", "Content-Type": "application/json"}
            if index < len(request.existing_event_ids) and request.existing_event_ids[index]:
                event_id = request.existing_event_ids[index]
                response = await client.put(
                    f"{get_settings().calendar_api_base}/calendars/{quote(calendar_id, safe='')}/events/{quote(event_id, safe='')}",
                    headers=headers,
                    json=body,
                )
                updated += 1
            else:
                response = await client.post(
                    f"{get_settings().calendar_api_base}/calendars/{quote(calendar_id, safe='')}/events",
                    headers=headers,
                    json=body,
                )
                created += 1
            response.raise_for_status()
            payload = response.json()
            event_ids.append(payload["id"])
            if payload.get("htmlLink"):
                html_links.append(payload["htmlLink"])

    return CalendarCommitResponse(
        calendar_id=calendar_id,
        calendar_summary="MICHIKUSA",
        event_ids=event_ids,
        html_links=html_links,
        created=created,
        updated=updated,
        demo=False,
    )
