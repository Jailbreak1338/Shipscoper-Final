"""Lightweight Flask API for triggering the scraper pipeline via webhook."""

import os
import threading
import traceback
import uuid
from datetime import datetime

from flask import Flask, jsonify, request

app = Flask(__name__)

WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "")

# Simple in-memory state for the last run
_last_run = {"status": "idle", "started_at": None, "finished_at": None, "summary": None, "error": None}
_lock = threading.Lock()
_test_email_jobs = {}


def _run_test_email(job_id: str, to_email: str):
    """Send test email in background to avoid HTTP worker timeouts."""
    with _lock:
        _test_email_jobs[job_id] = {
            "status": "running",
            "to_email": to_email,
            "started_at": datetime.utcnow().isoformat(),
            "finished_at": None,
            "error": None,
        }

    try:
        from scraper.email_sender import send_test_notification

        send_test_notification(to_email)
        with _lock:
            _test_email_jobs[job_id]["status"] = "sent"
            _test_email_jobs[job_id]["finished_at"] = datetime.utcnow().isoformat()
            _test_email_jobs[job_id]["error"] = None
        print(f"[test-email] Sent test email to {to_email} (job={job_id})")
    except Exception:
        err = traceback.format_exc()
        with _lock:
            _test_email_jobs[job_id]["status"] = "failed"
            _test_email_jobs[job_id]["finished_at"] = datetime.utcnow().isoformat()
            _test_email_jobs[job_id]["error"] = err
        print(f"[test-email] Failed for {to_email} (job={job_id})\n{err}")


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

    job_id = str(uuid.uuid4())
    thread = threading.Thread(target=_run_test_email, args=(job_id, to_email), daemon=True)
    thread.start()
    return jsonify({"ok": True, "queued": True, "to_email": to_email, "job_id": job_id}), 202


@app.route("/webhook/test-email-status/<job_id>", methods=["GET"])
def test_email_status(job_id: str):
    """Get async test-email job status. Requires X-Webhook-Secret header."""
    secret = request.headers.get("X-Webhook-Secret", "")
    if not WEBHOOK_SECRET or secret != WEBHOOK_SECRET:
        return jsonify({"error": "Unauthorized"}), 401

    with _lock:
        job = _test_email_jobs.get(job_id)
        if not job:
            return jsonify({"error": "Job not found"}), 404
        return jsonify(job), 200


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8080"))
    app.run(host="0.0.0.0", port=port)
