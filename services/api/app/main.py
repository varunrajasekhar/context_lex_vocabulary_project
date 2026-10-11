"""ContextLex demo API. One shared, unauthenticated demo profile (not production auth)."""
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
import hashlib
import json
import os
import re

from fastapi import FastAPI, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator
from pymongo import AsyncMongoClient, ASCENDING, DESCENDING
from pymongo.errors import DuplicateKeyError

DEMO_USER = "demo-user"
LEVELS = ("A1", "A2", "B1")
GOALS = (3, 5, 10, 15)


def local_now(preferences: dict) -> datetime:
    return datetime.now(ZoneInfo(preferences.get("timezone", "UTC")))


def as_word(doc: dict) -> dict:
    return {
        "id": doc["_id"], "headword": doc["headword"], "level": doc["level"],
        "part_of_speech": doc["part_of_speech"], "definition": doc["definition"],
        "example": doc["example"], "synonyms": doc.get("synonyms", []),
    }


def seeded_words() -> list:
    data_file = Path(__file__).resolve().parents[3] / "data" / "seed_words.json"
    with data_file.open(encoding="utf-8") as handle:
        return json.load(handle)


async def prepare_database(db):
    await db.words.create_index([("level", ASCENDING), ("headword", ASCENDING)])
    await db.plans.create_index([("user_id", ASCENDING), ("date_local", ASCENDING)], unique=True)
    await db.progress.create_index(
        [("user_id", ASCENDING), ("date_local", ASCENDING), ("word_id", ASCENDING)],
        unique=True,
    )
    # Seed-only: never overwrite edits made to existing vocabulary.
    for word in seeded_words():
        doc = dict(word)
        doc["_id"] = doc.pop("id")
        await db.words.update_one({"_id": doc["_id"]}, {"$setOnInsert": doc}, upsert=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    uri = os.getenv("MONGODB_URI", "mongodb://127.0.0.1:27017")
    name = os.getenv("MONGODB_DB", "contextlex")
    client = AsyncMongoClient(uri, serverSelectionTimeoutMS=4000)
    await client.admin.command("ping")
    app.state.db = client[name]
    await prepare_database(app.state.db)
    try:
        yield
    finally:
        await client.close()


app = FastAPI(title="ContextLex Demo API", version="0.1.0", lifespan=lifespan)


def database(request: Request):
    return request.app.state.db


class PreferencesPatch(BaseModel):
    level: str | None = None
    daily_goal: int | None = None
    timezone: str | None = None
    reminder_enabled: bool | None = None
    reminder_hour: int | None = Field(default=None, ge=0, le=23)

    @field_validator("level")
    @classmethod
    def valid_level(cls, value):
        if value is not None and value not in LEVELS:
            raise ValueError("Supported levels: A1, A2, B1")
        return value

    @field_validator("daily_goal")
    @classmethod
    def valid_goal(cls, value):
        if value is not None and value not in GOALS:
            raise ValueError("Daily goal must be 3, 5, 10, or 15")
        return value

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value):
        if value is not None:
            try:
                ZoneInfo(value)
            except (ZoneInfoNotFoundError, ValueError):
                raise ValueError("Use a valid IANA timezone") from None
        return value


class StatusUpdate(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def valid_status(cls, value):
        if value not in ("known", "needs_practice"):
            raise ValueError("Choose known or needs_practice")
        return value


async def get_preferences(db) -> dict:
    defaults = {
        "_id": DEMO_USER, "level": "B1", "daily_goal": 5, "timezone": "UTC",
        "reminder_enabled": True, "reminder_hour": 9, "reminder_ack_date": None,
    }
    await db.preferences.update_one({"_id": DEMO_USER}, {"$setOnInsert": defaults}, upsert=True)
    return await db.preferences.find_one({"_id": DEMO_USER})


def public_preferences(pref):
    return {key: value for key, value in pref.items() if key != "_id"}


def stable_sort_key(day: str, word_id: str) -> str:
    return hashlib.sha256((day + ":" + word_id).encode()).hexdigest()


async def get_today(db):
    pref = await get_preferences(db)
    day = local_now(pref).date().isoformat()
    plan_id = DEMO_USER + ":" + day
    plan = await db.plans.find_one({"_id": plan_id})
    if plan is None:
        all_words = await db.words.find({"level": pref["level"]}).to_list(length=500)
        if not all_words:
            raise HTTPException(503, "No vocabulary available at this level")
        past = await db.plans.find({"user_id": DEMO_USER}, {"word_ids": 1}).to_list(length=5000)
        previously_assigned = {wid for p in past for wid in p["word_ids"]}
        ordered = sorted(all_words, key=lambda w: stable_sort_key(day, w["_id"]))
        new = [w["_id"] for w in ordered if w["_id"] not in previously_assigned]
        review = [w["_id"] for w in ordered if w["_id"] in previously_assigned]
        selected = (new + review)[:pref["daily_goal"]]
        candidate = {
            "_id": plan_id, "user_id": DEMO_USER, "date_local": day,
            "level": pref["level"], "goal_count": pref["daily_goal"],
            "word_ids": selected,
        }
        try:
            await db.plans.update_one({"_id": plan_id}, {"$setOnInsert": candidate}, upsert=True)
        except DuplicateKeyError:
            pass  # Another simultaneous request created today's plan.
        plan = await db.plans.find_one({"_id": plan_id})
    words = await db.words.find({"_id": {"$in": plan["word_ids"]}}).to_list(length=100)
    by_id = {w["_id"]: w for w in words}
    events = await db.progress.find(
        {"user_id": DEMO_USER, "date_local": day}
    ).to_list(length=100)
    statuses = {event["word_id"]: event["status"] for event in events}
    word_list = [{**as_word(by_id[wid]), "status": statuses.get(wid)}
                 for wid in plan["word_ids"] if wid in by_id]
    studied = sum(1 for w in word_list if w["status"] is not None)
    return {
        "date": day, "level": plan["level"], "goal": plan["goal_count"],
        "studied": studied, "completed": bool(word_list) and studied == len(word_list),
        "words": word_list,
    }


@app.get("/api/v1/health")
async def health():
    return {"status": "ok", "service": "contextlex-api"}


@app.get("/api/v1/preferences")
async def read_preferences(request: Request):
    return public_preferences(await get_preferences(database(request)))


@app.patch("/api/v1/preferences")
async def change_preferences(update: PreferencesPatch, request: Request):
    db = database(request)
    await get_preferences(db)
    changes = update.model_dump(exclude_none=True)
    if changes:
        await db.preferences.update_one({"_id": DEMO_USER}, {"$set": changes})
    return public_preferences(await get_preferences(db))


@app.get("/api/v1/words")
async def list_words(request: Request, q: str = Query(default="", max_length=80),
                     level: str = Query(default="all")):
    if level != "all" and level not in LEVELS:
        raise HTTPException(422, "Unsupported vocabulary level")
    query = {} if level == "all" else {"level": level}
    if q.strip():
        query["headword"] = {"$regex": re.escape(q.strip()), "$options": "i"}
    words = await database(request).words.find(query).sort("headword", 1).to_list(length=100)
    return {"items": [as_word(w) for w in words]}


@app.get("/api/v1/learning/today")
async def todays_words(request: Request):
    return await get_today(database(request))


@app.put("/api/v1/learning/words/{word_id}/status")
async def mark_word(word_id: str, update: StatusUpdate, request: Request):
    db = database(request)
    current = await get_today(db)
    if word_id not in {word["id"] for word in current["words"]}:
        raise HTTPException(404, "This word is not assigned today")
    day = current["date"]
    timestamp = datetime.now(timezone.utc)
    record_id = DEMO_USER + ":" + day + ":" + word_id
    await db.progress.update_one(
        {"_id": record_id},
        {"$set": {
            "user_id": DEMO_USER, "date_local": day, "word_id": word_id,
            "status": update.status, "updated_at": timestamp,
        }},
        upsert=True,
    )
    return await get_today(db)


@app.get("/api/v1/progress/summary")
async def progress_summary(request: Request):
    db = database(request)
    pref = await get_preferences(db)
    today = local_now(pref).date()
    studied_ids = await db.progress.distinct("word_id", {"user_id": DEMO_USER})
    plans = await db.plans.find({"user_id": DEMO_USER}).to_list(length=5000)
    events = await db.progress.find({"user_id": DEMO_USER}).to_list(length=10000)
    counts = {}
    for event in events:
        counts[event["date_local"]] = counts.get(event["date_local"], 0) + 1
    completed = {
        plan["date_local"] for plan in plans
        if plan["word_ids"] and counts.get(plan["date_local"], 0) >= len(plan["word_ids"])
    }
    streak = 0
    cursor = today if today.isoformat() in completed else today - timedelta(days=1)
    while cursor.isoformat() in completed:
        streak += 1
        cursor -= timedelta(days=1)
    return {
        "total_unique_words_studied": len(studied_ids),
        "total_card_reviews": len(events),
        "days_completed": len(completed),
        "streak": streak,
    }


@app.get("/api/v1/progress/words")
async def progress_words(request: Request):
    db = database(request)
    events = await db.progress.find({"user_id": DEMO_USER}).sort(
        "updated_at", DESCENDING
    ).to_list(length=100)
    ids = list({event["word_id"] for event in events})
    docs = await db.words.find({"_id": {"$in": ids}}).to_list(length=100)
    by_id = {word["_id"]: word for word in docs}
    return {"items": [
        {"word": as_word(by_id[event["word_id"]]), "status": event["status"],
         "date": event["date_local"]}
        for event in events if event["word_id"] in by_id
    ]}


@app.get("/api/v1/reminders/due")
async def reminder_due(request: Request):
    db = database(request)
    pref = await get_preferences(db)
    now = local_now(pref)
    current = await get_today(db)
    due = (
        pref["reminder_enabled"] and now.hour >= pref["reminder_hour"]
        and pref.get("reminder_ack_date") != now.date().isoformat()
        and not current["completed"]
    )
    return {"due": due, "remaining": len(current["words"]) - current["studied"]}


@app.post("/api/v1/reminders/ack")
async def acknowledge_reminder(request: Request):
    db = database(request)
    pref = await get_preferences(db)
    day = local_now(pref).date().isoformat()
    await db.preferences.update_one(
        {"_id": DEMO_USER}, {"$set": {"reminder_ack_date": day}}
    )
    return {"acknowledged": True, "date": day}
