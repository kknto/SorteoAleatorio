from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import DATABASE_URL

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def ensure_schema_columns() -> None:
    """Add new columns safely if upgrading an existing local SQLite/Postgres DB."""
    inspector = inspect(engine)
    migrations = {
        "draws": {
            "budget": "VARCHAR(80)",
            "event_date": "VARCHAR(80)",
            "event_location": "VARCHAR(120)",
        },
        "participants": {
            "wishlist": "TEXT",
        },
    }
    with engine.begin() as conn:
        for table_name, columns in migrations.items():
            if not inspector.has_table(table_name):
                continue
            existing = {col["name"] for col in inspector.get_columns(table_name)}
            for col_name, col_type in columns.items():
                if col_name not in existing:
                    conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {col_name} {col_type}"))


def get_db() -> Generator[Session, None, None]:
    """Yield a SQLAlchemy session per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
