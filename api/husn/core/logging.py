import logging

import structlog


def configure_logging(level: str = "info", fmt: str = "json") -> None:
    """Configure structlog.

    fmt="json"  → JSONRenderer (production / aggregator-friendly).
    fmt="kv"    → ConsoleRenderer key-value pretty output for local dev.
    Any other value falls back to JSON to fail safe in prod.
    """
    logging.basicConfig(level=level.upper(), format="%(message)s")
    if fmt == "kv":
        renderer = structlog.dev.ConsoleRenderer(colors=False)
    else:
        renderer = structlog.processors.JSONRenderer()
    structlog.configure(
        processors=[
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(getattr(logging, level.upper())),
    )


log = structlog.get_logger("husn")
