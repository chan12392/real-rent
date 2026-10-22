import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.chat import router as chat_router
from app.api.health import router as health_router
from app.api.listings import router as listings_router


def create_app() -> FastAPI:
    application = FastAPI(title="REAL RENT API", version="0.1.0")
    origins = os.getenv(
        "CORS_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173"
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[origin.strip() for origin in origins.split(",") if origin.strip()],
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    application.include_router(health_router, prefix="/api")
    application.include_router(listings_router, prefix="/api")
    application.include_router(chat_router, prefix="/api")
    return application


app = create_app()
