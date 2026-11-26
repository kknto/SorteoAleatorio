import csv
import io
import json
from pathlib import Path
import secrets
from typing import Literal, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, status
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import USING_DEFAULT_ADMIN_KEY
from app.database import Base, engine, ensure_schema_columns, get_db
from app.models import Draw, Participant, SecretMessage, utcnow
from app.raffle import generate_derangement, verify_assignments
from app.security import (
    COOKIE_NAME,
    check_login_rate_limit,
    clear_failed_logins,
    create_session_token,
    get_client_ip,
    is_admin_authenticated,
    record_failed_login,
    verify_admin_key,
)

STATIC_DIR = Path(__file__).resolve().parent / "static"

EXAMPLE_15_NAMES = [
    "Sofía Martínez",
    "Mateo López",
    "Valentina García",
    "Sebastián Rodríguez",
    "Camila Hernández",
    "Santiago Pérez",
    "Lucía Sánchez",
    "Diego Ramírez",
    "Mariana Torres",
    "Alejandro Flores",
    "Isabella Rivera",
    "Daniel Gómez",
    "Paula Díaz",
    "Nicolás Cruz",
    "Andrea Morales",
]

Base.metadata.create_all(bind=engine)
ensure_schema_columns()

app = FastAPI(title="SorteoAleatorio API", version="2.0.0")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# --- Schemas ---


class LoginRequest(BaseModel):
    key: str = Field(..., min_length=1)


class CreateDrawRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)
    budget: Optional[str] = Field(default=None, max_length=80)
    event_date: Optional[str] = Field(default=None, max_length=80)
    event_location: Optional[str] = Field(default=None, max_length=120)


class DrawUpdateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)
    budget: Optional[str] = Field(default=None, max_length=80)
    event_date: Optional[str] = Field(default=None, max_length=80)
    event_location: Optional[str] = Field(default=None, max_length=120)


class AddParticipantsRequest(BaseModel):
    names: list[str] = Field(..., min_length=1)


class ExecuteDrawRequest(BaseModel):
    force: bool = False


class WishlistLinkItem(BaseModel):
    title: str = Field(default="", max_length=80)
    url: str = Field(..., min_length=8, max_length=500)


class WishlistRequest(BaseModel):
    wishlist: str = Field(default="", max_length=600)
    links: list[WishlistLinkItem] = Field(default_factory=list, max_length=5)
    images: list[str] = Field(default_factory=list, max_length=3)


class SecretMessageRequest(BaseModel):
    target: Literal["giftee", "santa"]
    content: str = Field(..., min_length=1, max_length=400)


# --- Helpers ---


def require_admin(request: Request) -> None:
    if not is_admin_authenticated(request):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sesión de administrador requerida.",
        )


def get_draw_or_active(db: Session, draw_id: Optional[int] = None) -> Draw:
    if draw_id is not None:
        draw = db.execute(select(Draw).where(Draw.id == draw_id)).scalar_one_or_none()
        if draw is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sorteo no encontrado.")
        return draw

    draw = db.execute(select(Draw).order_by(Draw.id.desc())).scalars().first()
    if draw is None:
        draw = Draw(
            title="Intercambio de Regalos 2026",
            budget="$300 MXN",
            status="draft",
        )
        db.add(draw)
        db.commit()
        db.refresh(draw)
    return draw


def _serialize_draw(draw: Draw) -> dict:
    participants = sorted(draw.participants, key=lambda p: p.id)
    id_to_name = {p.id: p.name for p in participants}

    serialized_participants = []
    confirmed_count = 0
    revealed_count = 0

    for p in participants:
        if p.confirmed_at is not None:
            confirmed_count += 1
        if p.revealed_at is not None:
            revealed_count += 1

        serialized_participants.append(
            {
                "id": p.id,
                "name": p.name,
                "token": p.token,
                "wishlist": p.wishlist or "",
                "has_wishlist": bool(p.wishlist or (p.wishlist_links and p.wishlist_links != "[]") or (p.wishlist_images and p.wishlist_images != "[]")),
                "assigned_to_id": p.assigned_to_id,
                "assigned_to_name": id_to_name.get(p.assigned_to_id) if p.assigned_to_id else None,
                "revealed_at": p.revealed_at.isoformat() if p.revealed_at else None,
                "confirmed_at": p.confirmed_at.isoformat() if p.confirmed_at else None,
            }
        )

    integrity_ok = False
    if draw.status == "drawn" and len(participants) >= 2:
        pairs = [
            (p.id, p.assigned_to_id)
            for p in participants
            if p.assigned_to_id is not None
        ]
        integrity_ok = verify_assignments(pairs, [p.id for p in participants])

    return {
        "id": draw.id,
        "title": draw.title,
        "budget": draw.budget or "",
        "event_date": draw.event_date or "",
        "event_location": draw.event_location or "",
        "status": draw.status,
        "created_at": draw.created_at.isoformat() if draw.created_at else None,
        "drawn_at": draw.drawn_at.isoformat() if draw.drawn_at else None,
        "total_participants": len(participants),
        "revealed_count": revealed_count,
        "confirmed_count": confirmed_count,
        "integrity_ok": integrity_ok,
        "participants": serialized_participants,
    }


def _clean_optional(val: Optional[str]) -> Optional[str]:
    if val is None:
        return None
    stripped = val.strip()
    return stripped if stripped else None


def _parse_json_list(raw: Optional[str]) -> list:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, list) else []
    except json.JSONDecodeError:
        return []


def _is_valid_http_url(url: str) -> bool:
    lower = url.strip().lower()
    return lower.startswith("https://") or lower.startswith("http://")


def _is_valid_image_src(src: str) -> bool:
    stripped = src.strip()
    lower = stripped.lower()
    if lower.startswith("data:image/"):
        return len(stripped) <= 300_000
    return _is_valid_http_url(stripped) and len(stripped) <= 500


# --- Health & SPA Pages ---


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/")
@app.get("/admin")
@app.get("/p/{token}")
def serve_spa(token: Optional[str] = None) -> FileResponse:
    return FileResponse(str(STATIC_DIR / "index.html"))


# --- Admin Auth (with rate limiting) ---


@app.get("/api/admin/session")
def admin_session(request: Request) -> dict:
    return {
        "authenticated": is_admin_authenticated(request),
        "using_default_key": USING_DEFAULT_ADMIN_KEY,
    }


@app.post("/api/admin/login")
def admin_login(payload: LoginRequest, request: Request, response: Response) -> dict:
    client_ip = get_client_ip(request)
    check_login_rate_limit(client_ip)

    if not verify_admin_key(payload.key):
        record_failed_login(client_ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Clave de administrador incorrecta.",
        )

    clear_failed_logins(client_ip)
    token = create_session_token()
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * 24 * 7,
    )
    return {"authenticated": True}


@app.post("/api/admin/logout")
def admin_logout(response: Response) -> dict:
    response.delete_cookie(key=COOKIE_NAME)
    return {"authenticated": False}


# --- Admin Multiple Draws ---


@app.get("/api/admin/draws", dependencies=[Depends(require_admin)])
def list_draws(db: Session = Depends(get_db)) -> list[dict]:
    draws = db.execute(select(Draw).order_by(Draw.id.desc())).scalars().all()
    if not draws:
        draws = [get_draw_or_active(db)]
    return [
        {
            "id": d.id,
            "title": d.title,
            "status": d.status,
            "total_participants": len(d.participants),
        }
        for d in draws
    ]


@app.post("/api/admin/draws", dependencies=[Depends(require_admin)])
def create_draw(payload: CreateDrawRequest, db: Session = Depends(get_db)) -> dict:
    draw = Draw(
        title=payload.title.strip(),
        budget=_clean_optional(payload.budget),
        event_date=_clean_optional(payload.event_date),
        event_location=_clean_optional(payload.event_location),
        status="draft",
    )
    db.add(draw)
    db.commit()
    db.refresh(draw)
    return _serialize_draw(draw)


@app.get("/api/admin/draw", dependencies=[Depends(require_admin)])
def get_admin_draw(
    draw_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
) -> dict:
    draw = get_draw_or_active(db, draw_id)
    return _serialize_draw(draw)


@app.patch("/api/admin/draw", dependencies=[Depends(require_admin)])
def update_admin_draw(
    payload: DrawUpdateRequest,
    draw_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
) -> dict:
    draw = get_draw_or_active(db, draw_id)
    draw.title = payload.title.strip()
    draw.budget = _clean_optional(payload.budget)
    draw.event_date = _clean_optional(payload.event_date)
    draw.event_location = _clean_optional(payload.event_location)
    db.commit()
    db.refresh(draw)
    return _serialize_draw(draw)


@app.get("/api/admin/draw/export", dependencies=[Depends(require_admin)])
def export_draw_csv(
    request: Request,
    draw_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    draw = get_draw_or_active(db, draw_id)
    participants = sorted(draw.participants, key=lambda p: p.id)
    id_to_name = {p.id: p.name for p in participants}
    base_url = str(request.base_url).rstrip("/")

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "Participante",
            "Le regala a",
            "Estado",
            "Fecha revelacion",
            "Fecha confirmacion",
            "Lista de deseos",
            "Enlace unico",
        ]
    )
    for p in participants:
        status_label = (
            "Confirmado"
            if p.confirmed_at
            else "Abierto"
            if p.revealed_at
            else "Pendiente"
        )
        writer.writerow(
            [
                p.name,
                id_to_name.get(p.assigned_to_id, "") if p.assigned_to_id else "",
                status_label,
                p.revealed_at.isoformat() if p.revealed_at else "",
                p.confirmed_at.isoformat() if p.confirmed_at else "",
                p.wishlist or "",
                f"{base_url}/p/{p.token}",
            ]
        )

    output.seek(0)
    filename = f"sorteo-{draw.id}.csv"
    return StreamingResponse(
        iter([output.getvalue().encode("utf-8-sig")]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# --- Admin Participants & Draw Execution ---


@app.post("/api/admin/participants", dependencies=[Depends(require_admin)])
def add_participants(
    payload: AddParticipantsRequest,
    draw_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
) -> dict:
    draw = get_draw_or_active(db, draw_id)
    if draw.status == "drawn":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El sorteo ya fue ejecutado. Reinicia el sorteo antes de modificar los participantes.",
        )

    existing_names = {p.name.casefold() for p in draw.participants}
    added: list[str] = []
    skipped: list[str] = []

    for raw_name in payload.names:
        clean_name = " ".join(raw_name.strip().split())
        if not clean_name:
            continue
        if len(clean_name) > 80:
            clean_name = clean_name[:80]
        key = clean_name.casefold()
        if key in existing_names:
            skipped.append(clean_name)
            continue
        existing_names.add(key)
        participant = Participant(
            draw_id=draw.id,
            name=clean_name,
            token=secrets.token_urlsafe(18),
        )
        db.add(participant)
        added.append(clean_name)

    db.commit()
    db.refresh(draw)
    result = _serialize_draw(draw)
    result["added"] = added
    result["skipped"] = skipped
    return result


@app.post("/api/admin/participants/seed-example", dependencies=[Depends(require_admin)])
def seed_example_15(
    draw_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
) -> dict:
    draw = get_draw_or_active(db, draw_id)
    if draw.status == "drawn":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Reinicia el sorteo antes de cargar los 15 participantes de ejemplo.",
        )

    existing_names = {p.name.casefold() for p in draw.participants}
    added_count = 0
    for name in EXAMPLE_15_NAMES:
        if name.casefold() in existing_names:
            continue
        existing_names.add(name.casefold())
        db.add(
            Participant(
                draw_id=draw.id,
                name=name,
                token=secrets.token_urlsafe(18),
            )
        )
        added_count += 1

    db.commit()
    db.refresh(draw)
    result = _serialize_draw(draw)
    result["added_count"] = added_count
    return result


@app.post("/api/admin/participants/{participant_id}/regenerate-token", dependencies=[Depends(require_admin)])
def regenerate_participant_token(participant_id: int, db: Session = Depends(get_db)) -> dict:
    participant = db.execute(
        select(Participant).where(Participant.id == participant_id)
    ).scalar_one_or_none()
    if participant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Participante no encontrado.")

    participant.token = secrets.token_urlsafe(18)
    db.commit()
    db.refresh(participant)
    return _serialize_draw(participant.draw)


@app.delete("/api/admin/participants/{participant_id}", dependencies=[Depends(require_admin)])
def delete_participant(participant_id: int, db: Session = Depends(get_db)) -> dict:
    participant = db.execute(
        select(Participant).where(Participant.id == participant_id)
    ).scalar_one_or_none()

    if participant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Participante no encontrado.")

    draw = participant.draw
    if draw.status == "drawn":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Reinicia el sorteo antes de eliminar participantes.",
        )

    db.delete(participant)
    db.commit()
    db.refresh(draw)
    return _serialize_draw(draw)


@app.post("/api/admin/draw/execute", dependencies=[Depends(require_admin)])
def execute_draw(
    payload: ExecuteDrawRequest,
    draw_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
) -> dict:
    draw = get_draw_or_active(db, draw_id)
    participants = sorted(draw.participants, key=lambda p: p.id)

    if len(participants) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Se necesitan al menos 2 participantes para realizar el sorteo.",
        )

    has_confirmations = any(p.confirmed_at is not None for p in participants)
    if draw.status == "drawn" and has_confirmations and not payload.force:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existen confirmaciones de lectura. Confirma que deseas re-sortear (se reiniciarán las confirmaciones).",
        )

    ids = [p.id for p in participants]
    mapping = generate_derangement(ids)

    if not verify_assignments(list(mapping.items()), ids):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error interno al verificar la integridad del sorteo.",
        )

    db.execute(delete(SecretMessage).where(SecretMessage.draw_id == draw.id))

    for p in participants:
        p.assigned_to_id = mapping[p.id]
        p.revealed_at = None
        p.confirmed_at = None

    draw.status = "drawn"
    draw.drawn_at = utcnow()
    db.commit()
    db.refresh(draw)
    return _serialize_draw(draw)


@app.post("/api/admin/draw/reset", dependencies=[Depends(require_admin)])
def reset_draw(
    draw_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
) -> dict:
    draw = get_draw_or_active(db, draw_id)
    db.execute(delete(SecretMessage).where(SecretMessage.draw_id == draw.id))
    for p in draw.participants:
        p.assigned_to_id = None
        p.revealed_at = None
        p.confirmed_at = None

    draw.status = "draft"
    draw.drawn_at = None
    db.commit()
    db.refresh(draw)
    return _serialize_draw(draw)


# --- Public Participant Endpoints (Unique Token Only) ---


def _get_participant_by_token(db: Session, token: str) -> Participant:
    participant = db.execute(
        select(Participant).where(Participant.token == token)
    ).scalar_one_or_none()
    if participant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Enlace inválido o inexistente.")
    return participant


@app.get("/api/p/{token}")
def get_participant_view(token: str, db: Session = Depends(get_db)) -> dict:
    participant = _get_participant_by_token(db, token)
    draw = participant.draw

    assigned_name = None
    assigned_wishlist = None
    assigned_links: list[dict] = []
    assigned_images: list[str] = []
    to_giftee_messages: list[dict] = []
    from_santa_messages: list[dict] = []

    if draw.status == "drawn" and participant.revealed_at is not None and participant.assigned_to is not None:
        assigned_name = participant.assigned_to.name
        assigned_wishlist = participant.assigned_to.wishlist or ""
        assigned_links = _parse_json_list(participant.assigned_to.wishlist_links)
        assigned_images = _parse_json_list(participant.assigned_to.wishlist_images)

        giftee_msgs = db.execute(
            select(SecretMessage)
            .where(
                SecretMessage.draw_id == draw.id,
                SecretMessage.giver_id == participant.id,
                SecretMessage.receiver_id == participant.assigned_to_id,
            )
            .order_by(SecretMessage.id.asc())
        ).scalars().all()
        to_giftee_messages = [
            {
                "id": m.id,
                "from_me": m.sender_role == "giver",
                "content": m.content,
                "created_at": m.created_at.isoformat(),
            }
            for m in giftee_msgs
        ]

    if draw.status == "drawn":
        santa_msgs = db.execute(
            select(SecretMessage)
            .where(
                SecretMessage.draw_id == draw.id,
                SecretMessage.receiver_id == participant.id,
            )
            .order_by(SecretMessage.id.asc())
        ).scalars().all()
        from_santa_messages = [
            {
                "id": m.id,
                "from_me": m.sender_role == "receiver",
                "content": m.content,
                "created_at": m.created_at.isoformat(),
            }
            for m in santa_msgs
        ]

    return {
        "name": participant.name,
        "draw_title": draw.title,
        "budget": draw.budget or "",
        "event_date": draw.event_date or "",
        "event_location": draw.event_location or "",
        "draw_status": draw.status,
        "revealed": participant.revealed_at is not None,
        "revealed_at": participant.revealed_at.isoformat() if participant.revealed_at else None,
        "confirmed": participant.confirmed_at is not None,
        "confirmed_at": participant.confirmed_at.isoformat() if participant.confirmed_at else None,
        "wishlist": participant.wishlist or "",
        "wishlist_links": _parse_json_list(participant.wishlist_links),
        "wishlist_images": _parse_json_list(participant.wishlist_images),
        "assigned_to_name": assigned_name,
        "assigned_to_wishlist": assigned_wishlist,
        "assigned_to_links": assigned_links,
        "assigned_to_images": assigned_images,
        "to_giftee_messages": to_giftee_messages,
        "from_santa_messages": from_santa_messages,
    }


@app.post("/api/p/{token}/reveal")
def reveal_assignment(token: str, db: Session = Depends(get_db)) -> dict:
    participant = _get_participant_by_token(db, token)

    if participant.draw.status != "drawn" or participant.assigned_to is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El sorteo aún no ha sido ejecutado por el administrador.",
        )

    if participant.revealed_at is None:
        participant.revealed_at = utcnow()
        db.commit()
        db.refresh(participant)

    return {
        "revealed": True,
        "revealed_at": participant.revealed_at.isoformat(),
        "assigned_to_name": participant.assigned_to.name,
        "confirmed": participant.confirmed_at is not None,
        "confirmed_at": participant.confirmed_at.isoformat() if participant.confirmed_at else None,
    }


@app.post("/api/p/{token}/confirm")
def confirm_read(token: str, db: Session = Depends(get_db)) -> dict:
    participant = _get_participant_by_token(db, token)

    if participant.draw.status != "drawn" or participant.assigned_to is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El sorteo aún no ha sido ejecutado.",
        )

    now = utcnow()
    if participant.revealed_at is None:
        participant.revealed_at = now
    if participant.confirmed_at is None:
        participant.confirmed_at = now
        db.commit()
        db.refresh(participant)

    return {
        "confirmed": True,
        "confirmed_at": participant.confirmed_at.isoformat(),
        "assigned_to_name": participant.assigned_to.name,
    }


@app.put("/api/p/{token}/wishlist")
def update_wishlist(token: str, payload: WishlistRequest, db: Session = Depends(get_db)) -> dict:
    participant = _get_participant_by_token(db, token)

    clean_links = []
    for item in payload.links:
        url = item.url.strip()
        if not _is_valid_http_url(url):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Los enlaces deben comenzar con https:// o http://",
            )
        title = item.title.strip() or url
        clean_links.append({"title": title[:80], "url": url[:500]})

    clean_images = []
    for src in payload.images:
        img = src.strip()
        if not _is_valid_image_src(img):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Imagen inválida o demasiado pesada (usa URL https:// o imagen comprimida).",
            )
        clean_images.append(img)

    participant.wishlist = payload.wishlist.strip()
    participant.wishlist_links = json.dumps(clean_links, ensure_ascii=False)
    participant.wishlist_images = json.dumps(clean_images, ensure_ascii=False)
    db.commit()
    return {
        "wishlist": participant.wishlist,
        "links": clean_links,
        "images": clean_images,
    }


@app.post("/api/p/{token}/messages")
def send_secret_message(
    token: str,
    payload: SecretMessageRequest,
    db: Session = Depends(get_db),
) -> dict:
    participant = _get_participant_by_token(db, token)
    draw = participant.draw
    if draw.status != "drawn":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Los mensajes anónimos se habilitan cuando el sorteo está activo.",
        )

    clean_content = payload.content.strip()
    if not clean_content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El mensaje no puede estar vacío.")

    if payload.target == "giftee":
        if participant.revealed_at is None or participant.assigned_to_id is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Primero revela a tu amigo secreto antes de enviarle pistas.",
            )
        msg = SecretMessage(
            draw_id=draw.id,
            giver_id=participant.id,
            receiver_id=participant.assigned_to_id,
            sender_role="giver",
            content=clean_content,
        )
    else:
        santa = db.execute(
            select(Participant).where(
                Participant.draw_id == draw.id,
                Participant.assigned_to_id == participant.id,
            )
        ).scalar_one_or_none()
        if santa is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No se encontró tu amigo secreto.")
        msg = SecretMessage(
            draw_id=draw.id,
            giver_id=santa.id,
            receiver_id=participant.id,
            sender_role="receiver",
            content=clean_content,
        )

    db.add(msg)
    db.commit()
    db.refresh(msg)
    return {
        "id": msg.id,
        "content": msg.content,
        "created_at": msg.created_at.isoformat(),
    }
