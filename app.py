from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from apscheduler.schedulers.background import BackgroundScheduler
from flask import Flask, jsonify, render_template, request

import portfolio_core as core


app = Flask(__name__)


@app.before_request
def require_pin():
    app_pin = core.os.environ.get("APP_PIN")
    if not app_pin or not request.path.startswith("/api/"):
        return None
    if request.headers.get("X-App-Pin") == app_pin:
        return None
    return jsonify({"error": "PIN required"}), 401


def scheduled_send() -> None:
    try:
        core.send_briefing_email()
        print(f"[{datetime.now()}] Sent scheduled briefing")
    except Exception as exc:
        print(f"[{datetime.now()}] Scheduled briefing failed: {exc}")


def start_scheduler() -> None:
    portfolio = core.load_portfolio()
    settings = portfolio.get("settings", {})
    hour, minute = (settings.get("send_time") or "07:00").split(":")
    scheduler = BackgroundScheduler(timezone=settings.get("timezone") or "Asia/Seoul")
    scheduler.add_job(scheduled_send, "cron", hour=int(hour), minute=int(minute), id="daily_portfolio_email")
    scheduler.start()


@app.route("/")
def index():
    return render_template("index.html")


@app.get("/api/portfolio")
def portfolio():
    return jsonify(core.load_portfolio())


@app.put("/api/settings")
def update_settings():
    return jsonify(core.update_settings(request.json or {}))


@app.get("/api/snapshot")
def snapshot():
    return jsonify(core.get_portfolio_snapshot())


@app.route("/api/config", methods=["GET", "POST"])
def config_alias():
    if request.method == "GET":
        return jsonify(core.load_portfolio())
    portfolio = request.json or {}
    core.save_portfolio(portfolio)
    return jsonify({"ok": True})


@app.get("/api/news")
def news():
    return jsonify(core.get_news())


@app.get("/api/discover")
def discover():
    category = request.args.get("category", "us")
    query = request.args.get("q", "")
    limit = int(request.args.get("limit", "12") or 12)
    return jsonify(core.discover_assets(category, query, limit))


@app.get("/api/history")
def history():
    symbol = request.args.get("symbol", "QQQM")
    market = request.args.get("market", "US")
    period = request.args.get("period") or request.args.get("range") or "6mo"
    return jsonify(core.get_price_history(symbol, market, period))


@app.get("/api/briefing")
def briefing():
    return jsonify({"text": core.build_briefing_text()})


@app.post("/api/ai")
def ai():
    question = (request.json or {}).get("question", "")
    return jsonify({"answer": core.ask_ai(question)})


@app.post("/api/capture")
def capture():
    payload = request.json or {}
    image = str(payload.get("image") or "")
    if "," in image and image.startswith("data:"):
        image = image.split(",", 1)[1]
    return jsonify(core.analyze_capture_image(image, str(payload.get("mimeType") or "image/png")))


@app.post("/api/holdings")
def add_holding():
    portfolio = core.load_portfolio()
    item = core.normalize_holding({**(request.json or {}), "id": uuid4().hex})
    portfolio.setdefault("holdings", []).append(item)
    core.save_portfolio(portfolio)
    return jsonify(item), 201


@app.put("/api/holdings/<item_id>")
def update_holding(item_id: str):
    portfolio = core.load_portfolio()
    holdings = portfolio.setdefault("holdings", [])
    for index, item in enumerate(holdings):
        if item.get("id") == item_id:
            holdings[index] = core.normalize_holding({**item, **(request.json or {}), "id": item_id})
            core.save_portfolio(portfolio)
            return jsonify(holdings[index])
    return jsonify({"error": "holding not found"}), 404


@app.delete("/api/holdings/<item_id>")
def delete_holding(item_id: str):
    portfolio = core.load_portfolio()
    holdings = portfolio.setdefault("holdings", [])
    portfolio["holdings"] = [item for item in holdings if item.get("id") != item_id]
    core.save_portfolio(portfolio)
    return jsonify({"ok": True})


@app.post("/api/holdings/<item_id>/transactions")
def add_transaction(item_id: str):
    try:
        return jsonify(core.apply_transaction(item_id, request.json or {}))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except KeyError:
        return jsonify({"error": "holding not found"}), 404


@app.put("/api/holdings/<item_id>/plan")
def update_plan(item_id: str):
    try:
        return jsonify(core.update_plan(item_id, request.json or {}))
    except KeyError:
        return jsonify({"error": "holding not found"}), 404


@app.post("/api/send-test")
def send_test():
    core.send_briefing_email()
    return jsonify({"ok": True, "message": "브리핑 메일을 발송했습니다."})


if __name__ == "__main__":
    core.load_env()
    if core.os.environ.get("ENABLE_APP_SCHEDULER", "false").lower() == "true":
        start_scheduler()
    app.run(host=core.os.environ.get("APP_HOST", "0.0.0.0"), port=int(core.os.environ.get("APP_PORT", "5050")), debug=False)
