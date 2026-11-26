from collections import defaultdict, deque
import hashlib
import hmac
import secrets
import time
from fastapi import HTTPException, Request, status

from app.config import ADMIN_KEY, SESSION_SECRET

COOKIE_NAME = "sorteo_admin_session"

# Simple in-memory rate limiter for failed admin login attempts
_FAILED_ATTEMPTS: dict[str, deque[float]] = defaultdict(deque)
MAX_LOGIN_ATTEMPTS = 5
WINDOW_SECONDS = 300


def _sign(value: str) -> str:
    sig = hmac.new(SESSION_SECRET.encode("utf-8"), value.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{value}.{sig}"


def create_session_token() -> str:
    return _sign("admin")


def verify_session_token(token: str | None) -> bool:
    if not token or "." not in token:
        return False
    value, _ = token.rsplit(".", 1)
    expected = _sign(value)
    return hmac.compare_digest(token, expected) and value == "admin"


def verify_admin_key(candidate: str) -> bool:
    return secrets.compare_digest(candidate.encode("utf-8"), ADMIN_KEY.encode("utf-8"))


def is_admin_authenticated(request: Request) -> bool:
    token = request.cookies.get(COOKIE_NAME)
    return verify_session_token(token)


def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def check_login_rate_limit(client_ip: str) -> None:
    now = time.monotonic()
    attempts = _FAILED_ATTEMPTS[client_ip]
    while attempts and now - attempts[0] > WINDOW_SECONDS:
        attempts.popleft()
    if len(attempts) >= MAX_LOGIN_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiados intentos fallidos. Espera 5 minutos antes de volver a intentar.",
        )


def record_failed_login(client_ip: str) -> None:
    _FAILED_ATTEMPTS[client_ip].append(time.monotonic())


def clear_failed_logins(client_ip: str) -> None:
    _FAILED_ATTEMPTS.pop(client_ip, None)
