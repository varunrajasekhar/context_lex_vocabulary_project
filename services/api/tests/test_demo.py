from app.main import PreferencesPatch, StatusUpdate, stable_sort_key, as_word
from pydantic import ValidationError
import pytest


def test_deterministic_word_order():
    assert stable_sort_key("2026-10-10", "word-1") == stable_sort_key("2026-10-10", "word-1")
    assert stable_sort_key("2026-10-10", "word-1") != stable_sort_key("2026-10-11", "word-1")


@pytest.mark.parametrize("goal", [3, 5, 10, 15])
def test_valid_daily_goals(goal):
    assert PreferencesPatch(daily_goal=goal).daily_goal == goal


@pytest.mark.parametrize("goal", [0, 7, 100])
def test_invalid_daily_goals(goal):
    with pytest.raises(ValidationError):
        PreferencesPatch(daily_goal=goal)


def test_timezone_validation():
    with pytest.raises(ValidationError):
        PreferencesPatch(timezone="Mars/Olympus_Mons")


def test_status_validation():
    assert StatusUpdate(status="known").status == "known"
    with pytest.raises(ValidationError):
        StatusUpdate(status="mastered")


def test_word_public_shape():
    word = as_word({
        "_id": "a", "headword": "adapt", "level": "B1",
        "part_of_speech": "verb", "definition": "To adjust.",
        "example": "We adapt quickly.", "synonyms": ["adjust"]
    })
    assert word["id"] == "a"
    assert "_id" not in word
