"""Convert Slack emoji shortcodes (``:white_check_mark:``) to Unicode.

Slack stores message text with ``:shortcode:`` tokens instead of the literal
emoji. Left untouched they leak into Artifact bodies, claim values, drift
evidence snippets, and finding summaries — so the UI shows the bare text
``:white_check_mark: complete`` where the user expects ``✅ complete``.

We convert in two places: at normalize time (clean storage going forward) and
at serve time on the read paths that surface stored text (clean data already in
the table). Unknown shortcodes are left verbatim — better a literal token than
a dropped word.

Only the common Slack shortcodes that actually show up in work chatter are
mapped; this is intentionally small, not the full Unicode set.
"""

from __future__ import annotations

import re

# Common Slack shortcodes seen in delivery/status chatter. Aliases included
# (``heavy_check_mark`` and ``white_check_mark`` both → ✅) since Slack treats
# several names as the same glyph.
_EMOJI: dict[str, str] = {
    "white_check_mark": "✅",
    "heavy_check_mark": "✔️",
    "ballot_box_with_check": "☑️",
    "x": "❌",
    "negative_squared_cross_mark": "❎",
    "heavy_multiplication_x": "✖️",
    "warning": "⚠️",
    "rotating_light": "🚨",
    "no_entry": "⛔",
    "no_entry_sign": "🚫",
    "fire": "🔥",
    "tada": "🎉",
    "rocket": "🚀",
    "eyes": "👀",
    "thumbsup": "👍",
    "+1": "👍",
    "thumbsdown": "👎",
    "-1": "👎",
    "pray": "🙏",
    "raised_hands": "🙌",
    "ok_hand": "👌",
    "wave": "👋",
    "point_right": "👉",
    "white_circle": "⚪",
    "red_circle": "🔴",
    "large_blue_circle": "🔵",
    "green_circle": "🟢",
    "yellow_circle": "🟡",
    "orange_circle": "🟠",
    "hourglass": "⌛",
    "hourglass_flowing_sand": "⏳",
    "clock": "🕐",
    "calendar": "📅",
    "date": "📆",
    "memo": "📝",
    "pushpin": "📌",
    "round_pushpin": "📍",
    "bulb": "💡",
    "lock": "🔒",
    "unlock": "🔓",
    "key": "🔑",
    "chart_with_upwards_trend": "📈",
    "chart_with_downwards_trend": "📉",
    "construction": "🚧",
    "checkered_flag": "🏁",
    "100": "💯",
    "heavy_exclamation_mark": "❗",
    "exclamation": "❗",
    "question": "❓",
    "bell": "🔔",
    "sparkles": "✨",
    "star": "⭐",
    "zap": "⚡",
    "boom": "💥",
    "muscle": "💪",
    "clap": "👏",
    "smile": "🙂",
    "slightly_smiling_face": "🙂",
    "grin": "😁",
    "sweat_smile": "😅",
    "thinking_face": "🤔",
    "cry": "😢",
    "disappointed": "😞",
    "tada_face": "🥳",
    "partying_face": "🥳",
}

# Matches ``:shortcode:``. The first char allows ``+``/``-`` so the ``:+1:`` /
# ``:-1:`` aliases match; the body may carry an optional ``::skin-tone-N``
# suffix Slack appends, consumed here so ``:wave::skin-tone-3:`` → 👋. Times and
# ratios like ``12:30`` / ``12:30:45`` only ever match a bare ``:30:`` token,
# which isn't in the map and is returned verbatim — so they're never mangled.
_SHORTCODE_RE = re.compile(
    r":([a-z0-9+\-][a-z0-9_+\-]*)(?:::skin-tone-\d)?:", re.IGNORECASE
)


def demojize_slack(text: str | None) -> str | None:
    """Replace known Slack ``:shortcode:`` tokens with their Unicode emoji.

    Returns the input unchanged (including ``None``) when there's nothing to do.
    Unknown shortcodes are preserved verbatim.
    """
    if not text or ":" not in text:
        return text

    def _sub(m: re.Match[str]) -> str:
        name = m.group(1).lower()
        return _EMOJI.get(name, m.group(0))

    return _SHORTCODE_RE.sub(_sub, text)
