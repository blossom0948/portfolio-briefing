from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from portfolio_core import apply_due_plan_purchases  # noqa: E402


if __name__ == "__main__":
    result = apply_due_plan_purchases()
    print(json.dumps(result, ensure_ascii=False, indent=2))
