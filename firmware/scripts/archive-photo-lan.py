#!/usr/bin/env python3
"""Read-only photo status from CoreS3's authenticated local HTTP /status.

An RFC1918 address is mandatory so the Archive bearer token is never sent
to an arbitrary public endpoint. No URLs/tokens are printed or logged.
"""
from __future__ import annotations

import argparse
import ipaddress
import json
import os
from pathlib import Path
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener, ProxyHandler, HTTPRedirectHandler


SAFE_FIELDS = ("phase", "startedAt", "finishedAt", "elapsedMs",
               "active", "saved", "analysisStatus", "errorStage", "errorType",
               "width", "height", "frameBytes", "jpegBytes")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        raise ValueError("HTTP redirect prohibited for device bearer token")


def safe_device_ip(raw: str) -> str:
    ip = ipaddress.IPv4Address(raw)
    if not ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast:
        raise ValueError("Device IP must be an RFC1918 private IPv4 address")
    if not any(ip in ipaddress.IPv4Network(block) for block in
               ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")):
        raise ValueError("Device IP must be RFC1918")
    return str(ip)


def filtered_photo(status: dict) -> dict:
    if not isinstance(status, dict) or not isinstance(status.get("photo"), dict):
        raise ValueError("CoreS3 /status did not provide a photo diagnostic object")
    photo = status["photo"]
    return {key: photo[key] for key in SAFE_FIELDS
            if key in photo and (photo[key] is None or isinstance(photo[key], (str, int, float, bool)))}


def fetch_photo(ip: str, token: str) -> dict:
    url = f"http://{safe_device_ip(ip)}:8082/status"
    opener = build_opener(ProxyHandler({}), NoRedirect())
    request = Request(url, headers={"Authorization": "Bearer " + token,
                                    "Accept": "application/json"}, method="GET")
    with opener.open(request, timeout=5) as response:
        if response.status != 200:
            raise ValueError("Unexpected HTTP status")
        raw = response.read(65537)
    if len(raw) > 65536:
        raise ValueError("Status response too large")
    return filtered_photo(json.loads(raw))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ip", required=True, help="CoreS3 private LAN IP shown near QR")
    parser.add_argument("--config", type=Path, required=True, help="Local private Archive manifest")
    parser.add_argument("--output", type=Path, required=True, help="Unique private output filename")
    args = parser.parse_args(argv)
    try:
        safe_device_ip(args.ip)
        conf = json.loads(args.config.read_text(encoding="utf-8"))
        token = conf.get("config", {}).get("archiveToken")
        if not isinstance(token, str) or len(token) < 16:
            raise ValueError("Archive token missing")
        photo = fetch_photo(args.ip, token)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(str(args.output), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump({"statuses": {"/photo/status": photo}, "errors": []},
                      handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        print("[CHECK] STEP=PHOTO_LAN /status: photo phase=" +
              str(photo.get("phase"))[:32] + " saved=" + str(photo.get("saved")))
        print("[INFO] STEP=PHOTO_LAN 診断保存=" + str(args.output))
        return 0
    except (ValueError, OSError, HTTPError, URLError, TimeoutError,
            json.JSONDecodeError) as exc:
        print("[WARN] STEP=PHOTO_LAN 状態を取得できません: " + type(exc).__name__,
              file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
