"""Secret settings stay encrypted, even when their row went missing (a restore)."""
from app.models.app_setting import AppSetting
from app.routers.backup import _SECRET_KEYS
from app.services import settings_service
from app.services.settings_service import SECRET_SETTINGS, decrypt_value, get_setting, set_setting


class FakeSession:
    """Just enough of AsyncSession for get_setting/set_setting."""
    def __init__(self, rows=()):
        self.rows = {r.key: r for r in rows}

    async def get(self, model, key):
        return self.rows.get(key)

    def add(self, row):
        self.rows[row.key] = row


async def test_missing_secret_row_is_recreated_encrypted():
    s = FakeSession()
    await set_setting("ai_api_key", "sk-live-123", s)
    row = s.rows["ai_api_key"]
    assert row.is_secret and row.group_name == "ai"
    assert "sk-live-123" not in row.value and decrypt_value(row.value) == "sk-live-123"
    assert await get_setting("ai_api_key", s) == "sk-live-123"


async def test_plaintext_secret_row_is_encrypted_on_next_write():
    s = FakeSession([AppSetting(key="gmail_refresh_token", value="old", is_secret=False, group_name="app")])
    await set_setting("gmail_refresh_token", "new-token", s)
    row = s.rows["gmail_refresh_token"]
    assert row.is_secret and decrypt_value(row.value) == "new-token"


async def test_ordinary_settings_stay_plain():
    s = FakeSession()
    await set_setting("timezone", "Europe/Brussels", s)
    assert not s.rows["timezone"].is_secret and s.rows["timezone"].value == "Europe/Brussels"


def test_backups_leave_out_every_secret():
    assert set(SECRET_SETTINGS) <= _SECRET_KEYS and "app_secret_key" in _SECRET_KEYS
    assert {"gmail_client_secret", "gmail_refresh_token", "ai_api_key", "jwt_secret"} <= set(SECRET_SETTINGS)
