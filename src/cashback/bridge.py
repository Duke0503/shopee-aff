"""Local bridge between the ledger and the browser helper extension.

Loopback only. The extension long-polls for a job, performs the browser
interaction inside the operator's own logged-in session, and posts the
result back.

Protocol (matches extension/background/peer.js):
    POST /register   {uuid, windowId}          extension announces itself
    POST /heartbeat  {uuid, windowId}          keep-alive every 30s
    GET  /job?instance=<uuid>                  long-poll, 200 with a job or 204
    POST /result/<id> {ok, value?, error?}     extension returns the outcome
    GET  /status                               operator-facing health check

Every request must carry X-Bridge-Token.

Micro-batching lives in queue.py: link requests are held until either the
oldest has waited out the window or the queue fills, so a burst of requests
collapses into a single browser pass.

This module knows nothing about Shopee. It ships {connector, action, params}
and takes back a value. What to click and where lives in the caller.
"""

from __future__ import annotations

import json
import queue
import sys
import threading
import uuid as uuid_lib
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

LONG_POLL_SECONDS = 25
DEFAULT_JOB_TIMEOUT_MS = 120_000


@dataclass
class Job:
    connector: str
    action: str
    params: dict
    timeout_ms: int = DEFAULT_JOB_TIMEOUT_MS
    id: str = field(default_factory=lambda: uuid_lib.uuid4().hex)

    def to_wire(self, hosts: list[str], url: str | None = None) -> dict:
        """Shape the extension expects.

        `_routing` tells find_tab which tab to pin for this connector.
        A job may carry its own, which is how work that has to happen on a
        different site (shopee.vn rather than the affiliate dashboard) gets
        its own pinned tab instead of hijacking this one.
        """
        params = dict(self.params)
        params.setdefault("_routing", {"hosts": hosts, "url": url})
        return {
            "id": self.id,
            "connector": self.connector,
            "action": self.action,
            "params": params,
            "timeout_ms": self.timeout_ms,
        }


class Bridge:
    """Job queue plus result rendezvous, shared by the HTTP handler."""

    def __init__(self, token: str, hosts: list[str], landing_url: str | None = None):
        self.token = token
        self.hosts = hosts
        self.landing_url = landing_url
        self._jobs: queue.Queue[Job] = queue.Queue()
        self._results: dict[str, queue.Queue] = {}
        self._lock = threading.Lock()
        self._instances: dict[str, datetime] = {}

    # -- operator side -------------------------------------------------

    def submit(self, job: Job, timeout: float | None = None) -> Any:
        """Queue a job and block until the extension answers.

        Raises RuntimeError on extension-side failure or timeout.
        """
        inbox: queue.Queue = queue.Queue(maxsize=1)
        with self._lock:
            self._results[job.id] = inbox
        self._jobs.put(job)

        wait = timeout if timeout is not None else (job.timeout_ms / 1000) + 10
        try:
            outcome = inbox.get(timeout=wait)
        except queue.Empty:
            raise RuntimeError(
                f"no result for {job.action} within {wait:.0f}s -- "
                "is the extension loaded and is Chrome open?"
            ) from None
        finally:
            with self._lock:
                self._results.pop(job.id, None)

        if not outcome.get("ok"):
            raise RuntimeError(outcome.get("error") or "unknown extension error")
        return outcome.get("value")

    def connected(self) -> bool:
        cutoff = datetime.now() - timedelta(seconds=90)
        with self._lock:
            return any(seen > cutoff for seen in self._instances.values())

    # -- extension side ------------------------------------------------

    def next_job(self, wait_seconds: int = LONG_POLL_SECONDS) -> Job | None:
        try:
            return self._jobs.get(timeout=wait_seconds)
        except queue.Empty:
            return None

    def deliver(self, job_id: str, outcome: dict) -> bool:
        with self._lock:
            inbox = self._results.get(job_id)
        if inbox is None:
            return False
        try:
            inbox.put_nowait(outcome)
        except queue.Full:
            return False
        return True

    def touch(self, instance_uuid: str) -> None:
        with self._lock:
            self._instances[instance_uuid] = datetime.now()

    def status(self) -> dict:
        cutoff = datetime.now() - timedelta(seconds=90)
        with self._lock:
            live = [u for u, seen in self._instances.items() if seen > cutoff]
        return {
            "ok": True,
            "connected": bool(live),
            "instances": live,
            "queued_jobs": self._jobs.qsize(),
        }


class _Handler(BaseHTTPRequestHandler):
    bridge: Bridge

    def log_message(self, fmt: str, *args) -> None:
        return

    def handle_error(self, request, client_address) -> None:
        """Swallow the noise of a client hanging up.

        The extension long-polls and abandons the socket on its own
        schedule. That is normal, but the default handler prints a full
        traceback for each one, which buries every real log line.
        """
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionResetError, ConnectionAbortedError,
                            BrokenPipeError)):
            return
        super().handle_error(request, client_address)

    def _authorised(self) -> bool:
        return self.headers.get("X-Bridge-Token", "") == self.bridge.token

    def _send(self, status: int, payload: dict | None = None) -> None:
        # 204 means No Content: sending a body with it is a protocol error
        # and some clients drop the connection over it.
        if status == 204:
            try:
                self.send_response(204)
                self.end_headers()
            except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
                pass
            return

        body = json.dumps(payload or {}).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            pass  # the client gave up mid-reply; nothing to do about it

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return {}

    def do_GET(self) -> None:
        if not self._authorised():
            return self._send(401, {"error": "bad token"})

        path = self.path.split("?", 1)[0].rstrip("/") or "/"

        if path == "/status":
            return self._send(200, self.bridge.status())

        if path == "/job":
            job = self.bridge.next_job()
            if job is None:
                return self._send(204)
            return self._send(
                200, job.to_wire(self.bridge.hosts, self.bridge.landing_url)
            )

        self._send(404, {"error": "not found"})

    def do_POST(self) -> None:
        if not self._authorised():
            return self._send(401, {"error": "bad token"})

        path = self.path.split("?", 1)[0].rstrip("/") or "/"
        payload = self._read_json()

        if path in ("/register", "/heartbeat"):
            instance = payload.get("uuid")
            if instance:
                self.bridge.touch(str(instance))
            return self._send(200, {"ok": True})

        if path.startswith("/result/"):
            job_id = path[len("/result/"):]
            delivered = self.bridge.deliver(job_id, payload)
            # An undelivered result is normal when the caller already timed
            # out; say so rather than failing the extension's post.
            return self._send(200, {"delivered": delivered})

        self._send(404, {"error": "not found"})


def serve(bridge: Bridge, port: int) -> None:
    handler = type("BridgeHandler", (_Handler,), {"bridge": bridge})
    # Loopback only. This must never be reachable from the network.
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    print(f"Bridge listening on http://127.0.0.1:{port}")
    print(f"Driving hosts: {', '.join(bridge.hosts)}")
    print("Loopback only. Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


def serve_in_background(bridge: Bridge, port: int) -> ThreadingHTTPServer:
    """Start the server on a daemon thread and return it, for scripted use."""
    handler = type("BridgeHandler", (_Handler,), {"bridge": bridge})
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
