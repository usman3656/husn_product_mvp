from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from husn.core.config import get_settings
from husn.core.logging import configure_logging, log
from husn.routers import (
    artifacts,
    auth_jira,
    auth_slack,
    claims,
    findings,
    graph,
    health,
    jira_admin,
    slack_admin,
    slack_feed,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(settings.log_level)
    log.info("husn.api.startup", env=settings.env)
    yield
    log.info("husn.api.shutdown")


app = FastAPI(title="husn.io API", version="0.0.1", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
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
app.include_router(artifacts.router)
app.include_router(graph.router)
app.include_router(claims.router)
app.include_router(findings.router)
