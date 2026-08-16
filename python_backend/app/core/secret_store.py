import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

_LEGACY_DEFAULT_SECRET = "super-secret-key-change-me"


def _fernet_for(secret_key: str) -> Fernet:
    digest = hashlib.sha256(secret_key.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def _fernet() -> Fernet:
    return _fernet_for(settings.secret_key)


def encrypt_secret(value: str | None) -> str:
    if not value:
        return ""
    return _fernet().encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_secret(value: str | None) -> str:
    if not value:
        return ""
    try:
        return _fernet().decrypt(value.encode("utf-8")).decode("utf-8")
    except (InvalidToken, ValueError):
        # Preserve credentials encrypted by the legacy local default key while
        # all new writes use the generated deployment-specific key.
        try:
            return _fernet_for(_LEGACY_DEFAULT_SECRET).decrypt(value.encode("utf-8")).decode("utf-8")
        except (InvalidToken, ValueError):
            return ""
