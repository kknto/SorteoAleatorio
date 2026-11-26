import os
import tempfile

import pytest
from fastapi.testclient import TestClient

# Use an isolated temporary SQLite database for tests
_tmp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp_db.close()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp_db.name}"
os.environ["ADMIN_KEY"] = "test-admin-key"

from app.main import app  # noqa: E402
from app.raffle import generate_derangement, verify_assignments  # noqa: E402
from app.security import clear_failed_logins  # noqa: E402


@pytest.mark.parametrize("n", [2, 3, 4, 7, 14, 15, 16, 25])
def test_derangement_invariants_even_and_odd(n: int) -> None:
    ids = list(range(1, n + 1))
    for _ in range(20):
        mapping = generate_derangement(ids)
        assert len(mapping) == n
        assert verify_assignments(list(mapping.items()), ids)
        for giver, receiver in mapping.items():
            assert giver != receiver


def test_derangement_rejects_fewer_than_two() -> None:
    with pytest.raises(ValueError):
        generate_derangement([1])


def test_admin_login_rate_limit() -> None:
    clear_failed_logins("testclient")
    client = TestClient(app)
    for _ in range(5):
        res = client.post("/api/admin/login", json={"key": "wrong-key"})
        assert res.status_code == 401
    blocked = client.post("/api/admin/login", json={"key": "wrong-key"})
    assert blocked.status_code == 429
    clear_failed_logins("testclient")


def test_full_15_participant_flow_wishlist_hints_and_export() -> None:
    clear_failed_logins("testclient")
    client = TestClient(app)

    # 1. Health & Admin login
    assert client.get("/api/health").status_code == 200
    login_res = client.post("/api/admin/login", json={"key": "test-admin-key"})
    assert login_res.status_code == 200

    # 2. Create a new draw with budget/date/location
    create_res = client.post(
        "/api/admin/draws",
        json={
            "title": "Posada 2026",
            "budget": "$350 MXN",
            "event_date": "20 Dic, 7:00 PM",
            "event_location": "Casa de Mateo",
        },
    )
    assert create_res.status_code == 200
    draw_id = create_res.json()["id"]

    # 3. Seed 15 example participants (odd number)
    seed_res = client.post(f"/api/admin/participants/seed-example?draw_id={draw_id}")
    assert seed_res.status_code == 200
    assert seed_res.json()["total_participants"] == 15

    # 4. Regenerate token for one participant before draw
    first_p = seed_res.json()["participants"][0]
    old_token = first_p["token"]
    regen_res = client.post(f"/api/admin/participants/{first_p['id']}/regenerate-token")
    assert regen_res.status_code == 200
    new_token = next(
        p["token"] for p in regen_res.json()["participants"] if p["id"] == first_p["id"]
    )
    assert new_token != old_token
    assert client.get(f"/api/p/{old_token}").status_code == 404

    # 5. Execute draw
    exec_res = client.post(
        f"/api/admin/draw/execute?draw_id={draw_id}",
        json={"force": False},
    )
    assert exec_res.status_code == 200
    drawn = exec_res.json()
    assert drawn["status"] == "drawn"
    assert drawn["integrity_ok"] is True

    participants = drawn["participants"]
    by_id = {p["id"]: p for p in participants}
    giver = participants[0]
    receiver = by_id[giver["assigned_to_id"]]

    # 6. Receiver updates their wishlist with text, link, and image
    wl_res = client.put(
        f"/api/p/{receiver['token']}/wishlist",
        json={
            "wishlist": "Café en grano o taza térmica",
            "links": [{"title": "Taza en Amazon", "url": "https://example.com/taza"}],
            "images": ["data:image/jpeg;base64,/9j/4AAQSkZJRg=="],
        },
    )
    assert wl_res.status_code == 200

    bad_wl = client.put(
        f"/api/p/{receiver['token']}/wishlist",
        json={"wishlist": "", "links": [{"title": "XSS", "url": "javascript:alert(1)"}], "images": []},
    )
    assert bad_wl.status_code == 400

    # 7. Anti-prefetch: GET does not reveal or confirm
    pre_get = client.get(f"/api/p/{giver['token']}").json()
    assert pre_get["revealed"] is False
    assert pre_get["confirmed"] is False
    assert pre_get["assigned_to_name"] is None
    assert pre_get["budget"] == "$350 MXN"

    # 8. Giver reveals and confirms reading, sees receiver's wishlist, links & images
    assert client.post(f"/api/p/{giver['token']}/reveal").status_code == 200
    assert client.post(f"/api/p/{giver['token']}/confirm").status_code == 200
    post_get = client.get(f"/api/p/{giver['token']}").json()
    assert post_get["confirmed"] is True
    assert post_get["assigned_to_name"] == receiver["name"]
    assert post_get["assigned_to_wishlist"] == "Café en grano o taza térmica"
    assert len(post_get["assigned_to_links"]) == 1
    assert post_get["assigned_to_links"][0]["title"] == "Taza en Amazon"
    assert len(post_get["assigned_to_images"]) == 1

    # 9. Anonymous hints between giver and receiver
    hint_res = client.post(
        f"/api/p/{giver['token']}/messages",
        json={"target": "giftee", "content": "¿Te gusta el café oscuro o medio?"},
    )
    assert hint_res.status_code == 200

    receiver_view = client.get(f"/api/p/{receiver['token']}").json()
    assert len(receiver_view["from_santa_messages"]) == 1
    assert receiver_view["from_santa_messages"][0]["content"] == "¿Te gusta el café oscuro o medio?"

    reply_res = client.post(
        f"/api/p/{receiver['token']}/messages",
        json={"target": "santa", "content": "¡Tueste medio, por favor!"},
    )
    assert reply_res.status_code == 200

    giver_view = client.get(f"/api/p/{giver['token']}").json()
    assert len(giver_view["to_giftee_messages"]) == 2
    assert giver_view["to_giftee_messages"][1]["from_me"] is False

    # 10. CSV Export
    csv_res = client.get(f"/api/admin/draw/export?draw_id={draw_id}")
    assert csv_res.status_code == 200
    assert "text/csv" in csv_res.headers["content-type"]
    assert "Participante" in csv_res.text
    assert receiver["name"] in csv_res.text
