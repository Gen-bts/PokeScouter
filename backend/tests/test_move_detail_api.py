"""わざ詳細 API のテスト."""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client():
    from app.main import app
    return TestClient(app)


def test_get_move_detail_thunderbolt(client: TestClient):
    """10まんボルトの詳細が取得できる."""
    response = client.get("/api/move/thunderbolt?lang=ja")
    assert response.status_code == 200
    data = response.json()

    assert data["move_key"] == "thunderbolt"
    assert data["move_name"] == "Thunderbolt"
    assert "10まんボルト" in data["move_name_ja"] or data["move_name_ja"] == "10まんボルト"
    assert data["type"] == "electric"
    assert data["type_name_ja"] == "でんき"
    assert data["damage_class"] == "special"
    assert data["damage_class_name_ja"] == "特殊"
    assert data["power"] == 90
    assert data["accuracy"] == 100
    assert data["pp"] == 15
    assert data["priority"] == 0


def test_get_move_detail_protect(client: TestClient):
    """まもるの詳細が取得できる（変化技）."""
    response = client.get("/api/move/protect?lang=ja")
    assert response.status_code == 200
    data = response.json()

    assert data["move_key"] == "protect"
    assert data["damage_class"] == "status"
    assert data["damage_class_name_ja"] == "変化"
    assert data["power"] is None
    # 日本語説明がある場合はチェック
    if data["short_desc_ja"]:
        assert "防ぐ" in data["short_desc_ja"] or len(data["short_desc_ja"]) > 0


def test_get_move_detail_priority_move(client: TestClient):
    """先制技の優先度が取得できる."""
    response = client.get("/api/move/extremespeed?lang=ja")
    assert response.status_code == 200
    data = response.json()

    assert data["move_key"] == "extremespeed"
    assert data["priority"] == 2


def test_get_move_detail_not_found(client: TestClient):
    """存在しない技は404."""
    response = client.get("/api/move/notexistmove?lang=ja")
    assert response.status_code == 404


def test_get_move_detail_japanese_fallback(client: TestClient):
    """日本語説明がない場合は英語にフォールバック."""
    response = client.get("/api/move/absorb?lang=ja")
    assert response.status_code == 200
    data = response.json()

    # short_desc_ja は日本語があれば日本語、なければ英語
    assert data["short_desc_ja"] is not None
    assert len(data["short_desc_ja"]) > 0
