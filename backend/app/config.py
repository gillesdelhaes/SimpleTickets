from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    app_secret_key: str = "dev-secret-change-in-production"
    app_base_url: str = "http://localhost:3000"

    # Database
    database_url: str = "postgresql+asyncpg://postgres:postgres@db:5432/simplytickets"

    # Google OIDC
    google_client_id: str = ""
    google_client_secret: str = ""
    google_workspace_domain: str = ""

    # Slack
    slack_bot_token: str = ""
    slack_signing_secret: str = ""
    slack_app_token: str = ""
    slack_trigger_emoji: str = "ticket"
    # Comma-separated channel IDs to monitor for emoji reactions.
    # Empty string = monitor ALL channels.
    slack_monitored_channels: str = ""

    # Email (SMTP)
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_tls: bool = True
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "support@company.com"

    # Storage
    storage_local_path: str = "/data/attachments"
    attachment_max_size_mb: int = 10

    # Vertex AI (Phase 3)
    google_cloud_project: str = ""
    google_application_credentials: str = ""
    gemini_model: str = "gemini-1.5-pro"


settings = Settings()
