import os


def get_cors_origins() -> list[str]:
    origins = os.getenv(
        "CORS_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173"
    )
    return [origin.strip() for origin in origins.split(",") if origin.strip()]
