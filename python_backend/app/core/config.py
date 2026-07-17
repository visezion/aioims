import os
from functools import lru_cache
from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "AIMS API"
    host: str = "127.0.0.1"
    port: int = 8001
    reload: bool = False
    database_url: str = Field(default_factory=lambda: os.getenv("DATABASE_URL", "sqlite:///./aims.db"))
    secret_key: str = Field(default_factory=lambda: os.getenv("SECRET_KEY", "super-secret-key-change-me"))
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 8

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
