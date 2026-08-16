import os
import secrets
from functools import lru_cache
from pathlib import Path
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _runtime_secret_key() -> str:
    configured = os.getenv("SECRET_KEY", "").strip()
    if configured:
        return configured

    key_file = Path(os.getenv("AIMS_SECRET_KEY_FILE", Path(__file__).resolve().parents[2] / ".aims_secret_key"))
    try:
        if key_file.exists():
            value = key_file.read_text(encoding="utf-8").strip()
            if len(value) >= 32:
                return value
        key_file.write_text(secrets.token_urlsafe(48), encoding="utf-8")
        try:
            key_file.chmod(0o600)
        except OSError:
            pass
        return key_file.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError("Set SECRET_KEY or provide a writable AIMS_SECRET_KEY_FILE path") from exc


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "AIMS API"
    host: str = "0.0.0.0"
    port: int = 8001
    reload: bool = False
    database_url: str = Field(default_factory=lambda: os.getenv("DATABASE_URL", "sqlite:///./aims.db"))
    secret_key: str = Field(default_factory=_runtime_secret_key)
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 8
    # The frontend derives the API host from the current browser hostname.
    # Keep local deployments portable; production deployments can restrict this with CORS_ORIGINS.
    cors_origins: str = Field(default_factory=lambda: os.getenv("AIMS_CORS_ORIGINS", os.getenv("CORS_ORIGINS", "http://127.0.0.1:4173,http://localhost:4173,http://127.0.0.1:5173,http://localhost:5173")))
    schema_mode: str = Field(default_factory=lambda: os.getenv("AIMS_SCHEMA_MODE", "auto"))

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def use_schema_migrations(self) -> bool:
        return self.schema_mode.strip().lower() == "migrations"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
