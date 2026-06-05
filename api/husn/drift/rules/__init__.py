"""Drift rule registry.

The evaluator iterates `ALL_RULES`. Adding a new rule = drop a module here
and append its `rule` to `ALL_RULES`. The evaluator stays untouched.
"""

from husn.drift.rules.base import DriftRule
from husn.drift.rules.r_date_1 import rule as r_date_1
from husn.drift.rules.r_owner_1 import rule as r_owner_1
from husn.drift.rules.r_status_1 import rule as r_status_1

ALL_RULES: list[DriftRule] = [r_date_1, r_owner_1, r_status_1]

__all__ = ["ALL_RULES", "DriftRule"]
