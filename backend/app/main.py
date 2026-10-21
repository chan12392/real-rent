from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.comparison import router as comparison_router
from app.api.health import router as health_router
from app.core.config import get_cors_origins


def create_app() -> FastAPI:
    application = FastAPI(title="REAL RENT API", version="0.1.0")
    application.add_middleware(
        CORSMiddleware,
        allow_origins=get_cors_origins(),
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    application.include_router(health_router, prefix="/api")
    application.include_router(comparison_router, prefix="/api")
    return application


app = create_app()
