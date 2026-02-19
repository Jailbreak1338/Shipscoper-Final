"""Lightweight Flask API for triggering the scraper pipeline via webhook."""

import os
import threading
import traceback
from datetime import datetime

from flask import Flask, jsonify, request

app = Flask(__name__)

WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "")

# Simple in-memory state for the last run
_last_run = {"status": "idle", "started_at": None, "finished_at": None, "summary": None, "error": None}
_lock = threading.Lock()


def _run_test_email(to_email: str):
    """Send test email in background to avoid HTTP worker timeouts."""
    try:
        from scraper.email_sender import send_test_notification

        send_test_notification(to_email)
        print(f"[test-email] Sent test email to {to_email}")
    except Exception:
        print(f"[test-email] Failed for {to_email}\n{traceback.format_exc()}")


def _run_pipeline():
    """Run the full scraper pipeline in a background thread."""
    global _last_run
    try:
        from orchestrator.pipeline import run_full

        summary = run_full()

        with _lock:
            _last_run["status"] = "completed"
            _last_run["finished_at"] = datetime.utcnow().isoformat()
            _last_run["summary"] = summary
            _last_run["error"] = None

    except Exception as e:
        with _lock:
            _last_run["status"] = "failed"
            _last_run["finished_at"] = datetime.utcnow().isoformat()
            _last_run["error"] = traceback.format_exc()

        print(f"Pipeline failed: {e}")


@app.route("/webhook/run-scraper", methods=["POST"])
def trigger_scraper():
    """Trigger the scraper pipeline. Requires X-Webhook-Secret header."""
    secret = request.headers.get("X-Webhook-Secret", "")
    if not WEBHOOK_SECRET or secret != WEBHOOK_SECRET:
        return jsonify({"error": "Unauthorized"}), 401

    with _lock:
        if _last_run["status"] == "running":
            return jsonify({
                "error": "Pipeline already running",
                "started_at": _last_run["started_at"],
            }), 409

        _last_run["status"] = "running"
        _last_run["started_at"] = datetime.utcnow().isoformat()
        _last_run["finished_at"] = None
        _last_run["summary"] = None
        _last_run["error"] = None

    thread = threading.Thread(target=_run_pipeline, daemon=True)
    thread.start()

    return jsonify({
        "message": "Pipeline started",
        "started_at": _last_run["started_at"],
    }), 202


@app.route("/status", methods=["GET"])
def status():
    """Return the current pipeline status."""
    with _lock:
        return jsonify(_last_run)


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint for Railway."""
    return jsonify({"ok": True, "timestamp": datetime.utcnow().isoformat()})


@app.route("/webhook/test-email", methods=["POST"])
def trigger_test_email():
    """Send a test email. Requires X-Webhook-Secret header."""
    secret = request.headers.get("X-Webhook-Secret", "")
    if not WEBHOOK_SECRET or secret != WEBHOOK_SECRET:
        return jsonify({"error": "Unauthorized"}), 401

    payload = request.get_json(silent=True) or {}
    to_email = str(payload.get("to_email", "")).strip()
    if not to_email:
        return jsonify({"error": "Missing to_email"}), 400

    thread = threading.Thread(target=_run_test_email, args=(to_email,), daemon=True)
    thread.start()
    return jsonify({"ok": True, "queued": True, "to_email": to_email}), 202


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8080"))
    app.run(host="0.0.0.0", port=port)
