import os
import secrets


def _normalize_database_url(raw_url: str) -> str:
    """Normalize PostgreSQL URLs from Render/Heroku to SQLAlchemy psycopg3 format."""
    if raw_url.startswith("postgres://"):
        return raw_url.replace("postgres://", "postgresql+psycopg://", 1)
    if raw_url.startswith("postgresql://") and "+psycopg" not in raw_url:
        return raw_url.replace("postgresql://", "postgresql+psycopg://", 1)
    return raw_url


DATABASE_URL: str = _normalize_database_url(
    os.getenv("DATABASE_URL", "sqlite:///./sorteo.db")
)

ADMIN_KEY: str = os.getenv("ADMIN_KEY", "admin123")
USING_DEFAULT_ADMIN_KEY: bool = "ADMIN_KEY" not in os.environ

SESSION_SECRET: str = os.getenv(
    "SESSION_SECRET",
    f"dev-secret-{ADMIN_KEY}" if USING_DEFAULT_ADMIN_KEY else secrets.token_hex(32),
)
