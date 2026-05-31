from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from portfolio_core import send_briefing_email  # noqa: E402


if __name__ == "__main__":
    send_briefing_email()
    print("Sent briefing email")
