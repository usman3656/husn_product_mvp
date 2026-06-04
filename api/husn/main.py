from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from husn.core.config import get_settings
from husn.core.logging import configure_logging, log
from husn.routers import (
    agent,
    artifacts,
    auth_google,
    auth_jira,
    auth_microsoft,
    auth_slack,
    chat,
    claims,
    connections,
    findings,
    google_admin,
    graph,
    health,
    jira_admin,
    microsoft_admin,
    slack_admin,
    slack_feed,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(settings.log_level, settings.log_format)
    log.info("husn.api.startup", env=settings.env)
    yield
    log.info("husn.api.shutdown")


app = FastAPI(title="husn.io API", version="0.0.1", lifespan=lifespan)

# CORS origins come from CORS_ALLOWED_ORIGINS (comma-separated). Default covers
# local-dev; prod sets https://app.husn.io,https://husn.io.
_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origins_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth_jira.router)
app.include_router(jira_admin.router)
app.include_router(auth_slack.router)
app.include_router(slack_admin.router)
app.include_router(slack_feed.router)
app.include_router(auth_google.router)
app.include_router(google_admin.router)
app.include_router(auth_microsoft.router)
app.include_router(microsoft_admin.router)
app.include_router(connections.router)
app.include_router(artifacts.router)
app.include_router(graph.router)
app.include_router(claims.router)
app.include_router(findings.router)
app.include_router(agent.router)
app.include_router(chat.router)
