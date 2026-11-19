#!/usr/bin/env python3
"""Proof-Shot evidence verifier.

Checks that a Proof-Shot PNG matches its JSON sidecar and was not modified after capture.
Single file, Python standard library only (3.10+).

    proofshot_verify.py EVIDENCE.png [EVIDENCE.json]
    proofshot_verify.py --dir Downloads/Proof-Shot/
    proofshot_verify.py --json --strict evidence.png

Exit codes: 0 = PASS (or WARN without --strict), 1 = FAIL, 2 = usage / unreadable input.

Scope: this detects modification of either file and inconsistencies between them. It does NOT
prove authenticity: whoever holds both files can forge a new consistent pair (hashes are not
signed). See SECURITY.md.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
import sys
import zlib
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

__version__ = "1.1.0"

SUPPORTED_SCHEMAS = ("1.0", "1.1")
WATERMARK_LINES = 6  # lines drawn by lib/capture.js watermarkLines()

# Hard limits for untrusted input (decompression bombs, huge files).
MAX_JSON_BYTES = 1 * 1024 * 1024
MAX_PNG_BYTES = 256 * 1024 * 1024
MAX_DIMENSION = 32_768
MAX_PIXELS = 160_000_000

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
HEX64 = re.compile(r"^[0-9a-f]{64}$")
UUID4 = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
# <HHMMSS>[_<case>]_<id8>[ (n)].png   (" (n)" comes from Chrome's conflictAction: 'uniquify')
FILE_NAME = re.compile(r"^(?P<time>\d{6})(?:_(?P<case>.+))?_(?P<id8>[0-9a-f]{8})(?: \(\d+\))?$")

PASS, WARN, FAIL, SKIP = "PASS", "WARN", "FAIL", "SKIP"
SEVERITY = {PASS: 0, SKIP: 0, WARN: 1, FAIL: 2}


class VerifierError(Exception):
    """Input cannot be processed at all (missing file, not a PNG, limits exceeded)."""


@dataclass
class Check:
    name: str
    status: str
    detail: str


@dataclass
class Report:
    image: str
    metadata: str | None
    evidence_id: str | None = None
    checks: list[Check] = field(default_factory=list)
    expected_watermark: list[str] = field(default_factory=list)

    def add(self, name: str, status: str, detail: str) -> None:
        self.checks.append(Check(name, status, detail))

    @property
    def status(self) -> str:
        worst = max((SEVERITY[c.status] for c in self.checks), default=0)
        return {0: PASS, 1: WARN, 2: FAIL}[worst]


# --- Layout mirrored from lib/watermark.js ----------------------------------------------------

def js_round(x: float) -> int:
    """JavaScript Math.round (half rounds up), unlike Python's banker's rounding."""
    return int(x + 0.5) if x >= 0 else -int(-x + 0.5)


def band_height(width: int, line_count: int = WATERMARK_LINES) -> int:
    """Height of the watermark band. Must match bandLayout() in lib/watermark.js."""
    font_size = max(12, min(28, js_round(width / 100)))
    line_height = js_round(font_size * 1.45)
    padding = js_round(font_size * 0.9)
    accent = max(2, js_round(font_size / 5))
    return accent + padding * 2 + line_height * line_count


# --- PNG parsing ------------------------------------------------------------------------------

@dataclass
class Png:
    width: int
    height: int
    bit_depth: int
    color_type: int
    interlace: int
    idat: bytes
    trailing_bytes: int


def parse_png(data: bytes) -> Png:
    if not data.startswith(PNG_SIGNATURE):
        raise VerifierError("not a PNG file (bad signature)")
    pos = len(PNG_SIGNATURE)
    ihdr = None
    idat = []
    seen_iend = False
    while pos + 8 <= len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        ctype = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        crc_bytes = data[pos + 8 + length:pos + 12 + length]
        if len(body) != length or len(crc_bytes) != 4:
            raise VerifierError(f"truncated chunk {ctype!r}")
        if zlib.crc32(ctype + body) != struct.unpack(">I", crc_bytes)[0]:
            raise VerifierError(f"CRC mismatch in chunk {ctype.decode('latin-1')}")
        pos += 12 + length
        if ihdr is None:
            if ctype != b"IHDR" or length != 13:
                raise VerifierError("first chunk is not a valid IHDR")
            ihdr = struct.unpack(">IIBBBBB", body)
        elif ctype == b"IDAT":
            idat.append(body)
        elif ctype == b"IEND":
            seen_iend = True
            break
    if ihdr is None or not seen_iend:
        raise VerifierError("PNG has no IHDR or IEND chunk")
    width, height, bit_depth, color_type, _comp, _filter, interlace = ihdr
    if not (0 < width <= MAX_DIMENSION and 0 < height <= MAX_DIMENSION) or width * height > MAX_PIXELS:
        raise VerifierError(f"PNG dimensions out of bounds: {width}x{height}")
    return Png(width, height, bit_depth, color_type, interlace, b"".join(idat), len(data) - pos)


def _paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    return b if pb <= pc else c


def _unfilter_row(ftype: int, row: bytearray, prev: bytes | bytearray, bpp: int) -> None:
    n = len(row)
    if ftype == 0:
        return
    if ftype == 1:
        for i in range(bpp, n):
            row[i] = (row[i] + row[i - bpp]) & 0xFF
    elif ftype == 2:
        for i in range(n):
            row[i] = (row[i] + prev[i]) & 0xFF
    elif ftype == 3:
        for i in range(n):
            left = row[i - bpp] if i >= bpp else 0
            row[i] = (row[i] + ((left + prev[i]) >> 1)) & 0xFF
    elif ftype == 4:
        for i in range(bpp):
            row[i] = (row[i] + prev[i]) & 0xFF
        for i in range(bpp, n):  # _paeth() inlined: this loop dominates decode time
            a, b, c = row[i - bpp], prev[i], prev[i - bpp]
            pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
            row[i] = (row[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 0xFF
    else:
        raise VerifierError(f"invalid PNG filter type {ftype}")


def rgba_rows(png: Png, rows: int) -> bytes:
    """Decodes the first `rows` rows as 8-bit RGBA (the layout of canvas getImageData)."""
    if png.bit_depth != 8 or png.color_type not in (2, 6) or png.interlace != 0:
        raise VerifierError(
            f"unsupported PNG layout (bit depth {png.bit_depth}, color type {png.color_type}, "
            f"interlace {png.interlace}); expected 8-bit RGB/RGBA, non-interlaced")
    bpp = 4 if png.color_type == 6 else 3
    stride = png.width * bpp
    needed = rows * (stride + 1)
    raw = zlib.decompressobj().decompress(png.idat, needed)  # bounded: no decompression bomb
    if len(raw) < needed:
        raise VerifierError("PNG image data is truncated")

    out = bytearray()
    prev = bytes(stride)
    for y in range(rows):
        start = y * (stride + 1)
        row = bytearray(raw[start + 1:start + 1 + stride])
        _unfilter_row(raw[start], row, prev, bpp)
        if bpp == 4:
            out += row
        else:
            rgba = bytearray(b"\xff") * (png.width * 4)
            rgba[0::4], rgba[1::4], rgba[2::4] = row[0::3], row[1::3], row[2::3]
            out += rgba
        prev = row
    return bytes(out)


# --- Checks -----------------------------------------------------------------------------------

def _get(obj: dict, path: str):
    for key in path.split("."):
        if not isinstance(obj, dict) or key not in obj:
            return None
        obj = obj[key]
    return obj


def _parse_iso(value) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def check_schema(report: Report, ev: dict) -> None:
    version = ev.get("schema_version")
    if version not in SUPPORTED_SCHEMAS:
        report.add("schema", FAIL, f"unsupported schema_version {version!r} (supported: {', '.join(SUPPORTED_SCHEMAS)})")
        return
    required = ["evidence_id", "session", "captured_at_utc", "captured_at_local", "timezone",
                "integrity.algorithm", "integrity.sha256_original", "integrity.sha256_final"]
    if version != "1.0":
        required += ["integrity.sha256_pixels", "capture.width", "capture.height"]
    missing = [k for k in required if _get(ev, k) is None]
    problems = [f"missing {k}" for k in missing]
    if _get(ev, "integrity.algorithm") not in (None, "SHA-256"):
        problems.append(f"unexpected algorithm {_get(ev, 'integrity.algorithm')!r}")
    for key in ("sha256_original", "sha256_pixels", "sha256_final"):
        value = _get(ev, f"integrity.{key}")
        if value is not None and not (isinstance(value, str) and HEX64.match(value)):
            problems.append(f"integrity.{key} is not a SHA-256 hex digest")
    if ev.get("evidence_id") is not None and not (isinstance(ev["evidence_id"], str) and UUID4.match(ev["evidence_id"])):
        problems.append("evidence_id is not a UUID v4")
    if problems:
        report.add("schema", FAIL, "; ".join(problems))
    else:
        report.add("schema", PASS, f"schema {version}, all required fields present")


def check_file_hash(report: Report, ev: dict, data: bytes) -> bool:
    expected = _get(ev, "integrity.sha256_final")
    actual = hashlib.sha256(data).hexdigest()
    if not isinstance(expected, str):
        report.add("sha256_final", FAIL, "no sha256_final in metadata")
        return False
    if actual == expected.lower():
        report.add("sha256_final", PASS, f"file hash matches ({actual})")
        return True
    report.add("sha256_final", FAIL, f"file hash {actual} != sha256_final {expected}")
    return False


def check_png(report: Report, png: Png) -> None:
    if png.trailing_bytes:
        report.add("png_structure", WARN, f"{png.trailing_bytes} byte(s) of data after IEND")
    else:
        report.add("png_structure", PASS, f"valid PNG {png.width}x{png.height}, all chunk CRCs OK")


def check_dimensions(report: Report, ev: dict, png: Png) -> int | None:
    """Returns the capture height if it can be established."""
    band = band_height(png.width)
    width, height = _get(ev, "capture.width"), _get(ev, "capture.height")
    if width is None or height is None:  # schema 1.0: only the band can be checked
        capture_h = png.height - band
        if capture_h <= 0:
            report.add("dimensions", FAIL, f"image is shorter than the expected watermark band ({band}px)")
            return None
        report.add("dimensions", SKIP, f"schema 1.0 has no capture size; inferred {png.width}x{capture_h} + {band}px band")
        return capture_h
    if not (isinstance(width, int) and isinstance(height, int)):
        report.add("dimensions", FAIL, "capture.width/height are not integers")
        return None
    expected = (width, height + band_height(width))
    if (png.width, png.height) == expected:
        report.add("dimensions", PASS, f"{width}x{height} capture + {band}px watermark band")
        return height
    report.add("dimensions", FAIL,
               f"image is {png.width}x{png.height}, expected {expected[0]}x{expected[1]} "
               f"({width}x{height} capture + band): cropped, resized or band altered")
    return None


def check_pixels(report: Report, ev: dict, png: Png, capture_h: int | None, file_ok: bool, enabled: bool) -> None:
    expected = _get(ev, "integrity.sha256_pixels")
    if expected is None:
        report.add("sha256_pixels", SKIP, "not present (schema 1.0)")
        return
    if not enabled:
        report.add("sha256_pixels", SKIP, "disabled with --no-pixels")
        return
    if capture_h is None:
        report.add("sha256_pixels", FAIL, "cannot locate the capture area (dimension check failed)")
        return
    try:
        actual = hashlib.sha256(rgba_rows(png, capture_h)).hexdigest()
    except VerifierError as err:
        report.add("sha256_pixels", FAIL, str(err))
        return
    if actual != str(expected).lower():
        report.add("sha256_pixels", FAIL, f"captured-area pixels {actual} != sha256_pixels {expected}: content was modified")
    elif file_ok:
        report.add("sha256_pixels", PASS, "captured-area pixels match")
    else:
        report.add("sha256_pixels", WARN,
                   "captured-area pixels match although the file hash does not: the PNG was re-encoded "
                   "or the watermark band changed; screenshot content is intact")


def check_times(report: Report, ev: dict) -> datetime | None:
    utc, local = _parse_iso(ev.get("captured_at_utc")), _parse_iso(ev.get("captured_at_local"))
    if utc is None or local is None or local.tzinfo is None:
        report.add("timestamps", FAIL, "captured_at_utc / captured_at_local are not valid ISO 8601 timestamps")
        return None
    if abs(utc - local) > timedelta(milliseconds=1):
        report.add("timestamps", FAIL, f"UTC {utc.isoformat()} and local {local.isoformat()} are different instants")
        return None
    tz_name = ev.get("timezone")
    try:
        from zoneinfo import ZoneInfo

        zone_offset = utc.astimezone(ZoneInfo(str(tz_name))).utcoffset()
    except Exception:  # noqa: BLE001 - unknown zone or no tzdata on this system
        report.add("timestamps", WARN, f"UTC and local agree; cannot resolve timezone {tz_name!r} on this system")
        return local
    if zone_offset != local.utcoffset():
        report.add("timestamps", FAIL, f"offset {local.strftime('%z')} does not match timezone {tz_name} at that instant")
        return None
    report.add("timestamps", PASS, f"{utc.isoformat()} = {local.isoformat()} ({tz_name})")
    return local


def check_naming(report: Report, ev: dict, image: Path, metadata: Path, local: datetime | None) -> None:
    problems, notes = [], []
    if image.stem != metadata.stem:
        notes.append(f"PNG and JSON names differ ({image.name} / {metadata.name})")
    recorded = _get(ev, "files.image")
    if isinstance(recorded, str) and Path(recorded).name != image.name:
        notes.append(f"file was renamed (recorded as {Path(recorded).name})")
    match = FILE_NAME.match(image.stem)
    evidence_id = str(ev.get("evidence_id") or "")
    if match:
        if match["id8"] != evidence_id[:8]:
            problems.append(f"file name id {match['id8']} != evidence_id {evidence_id[:8]}")
        if local is not None and match["time"] != local.strftime("%H%M%S"):
            problems.append(f"file name time {match['time']} != captured_at_local {local.strftime('%H%M%S')}")
        if local is not None and re.fullmatch(r"\d{4}-\d{2}-\d{2}", image.parent.name) \
                and image.parent.name != local.strftime("%Y-%m-%d"):
            problems.append(f"folder date {image.parent.name} != capture date {local.strftime('%Y-%m-%d')}")
    else:
        notes.append("file name does not follow the Proof-Shot pattern")
    if problems:
        report.add("naming", FAIL, "; ".join(problems))
    elif notes:
        report.add("naming", WARN, "; ".join(notes))
    else:
        report.add("naming", PASS, "file name, folder date and evidence id are consistent")


def expected_watermark(ev: dict) -> list[str]:
    """Watermark text rebuilt from the JSON, for a visual comparison with the image band."""
    local = _parse_iso(ev.get("captured_at_local"))
    if local is not None:
        offset = local.strftime("%z")
        local_display = f"{local:%Y-%m-%d %H:%M:%S} UTC{offset[:3]}:{offset[3:]}"
    else:
        local_display = "?"
    name = str(_get(ev, "environment.extension") or "Proof-Shot").rsplit(" ", 1)[0]
    dash = lambda v: "-" if v is None else v  # noqa: E731
    return [
        f"{name.upper()}  ·  ID {ev.get('evidence_id')}",
        f"Session: {ev.get('session')}  |  Case: {dash(ev.get('case_id'))}  |  Auditor: {dash(ev.get('auditor'))}",
        f"Local: {local_display} ({ev.get('timezone')})  |  UTC: {ev.get('captured_at_utc')}",
        f"URL: {_get(ev, 'page.url_redacted')}",
        f"IP: {_get(ev, 'network.public_ip')}  |  {_get(ev, 'environment.browser')}  |  {_get(ev, 'environment.os')}",
        f"SHA-256 (original): {_get(ev, 'integrity.sha256_original')}",
    ]


# --- Driver -----------------------------------------------------------------------------------

def _read_limited(path: Path, limit: int) -> bytes:
    if not path.is_file():
        raise VerifierError(f"file not found: {path}")
    if path.stat().st_size > limit:
        raise VerifierError(f"{path.name} exceeds the {limit // (1024 * 1024)} MiB limit")
    return path.read_bytes()


def verify(image: Path, metadata: Path | None = None, check_pixel_hash: bool = True) -> Report:
    metadata = metadata or image.with_suffix(".json")
    report = Report(str(image), str(metadata))
    try:
        ev = json.loads(_read_limited(metadata, MAX_JSON_BYTES).decode("utf-8"))
        if not isinstance(ev, dict):
            raise ValueError("top-level value is not an object")
    except VerifierError as err:
        report.add("metadata", FAIL, str(err))
        return report
    except (ValueError, UnicodeDecodeError) as err:
        report.add("metadata", FAIL, f"invalid JSON sidecar: {err}")
        return report
    report.evidence_id = ev.get("evidence_id") if isinstance(ev.get("evidence_id"), str) else None

    check_schema(report, ev)
    try:
        data = _read_limited(image, MAX_PNG_BYTES)
        file_ok = check_file_hash(report, ev, data)
        png = parse_png(data)
        check_png(report, png)
        capture_h = check_dimensions(report, ev, png)
        check_pixels(report, ev, png, capture_h, file_ok, check_pixel_hash)
    except VerifierError as err:
        report.add("png_structure", FAIL, str(err))
    local = check_times(report, ev)
    check_naming(report, ev, image, metadata, local)
    report.expected_watermark = expected_watermark(ev)
    return report


def collect(paths: list[str], directory: str | None) -> list[tuple[Path, Path | None]]:
    if directory:
        root = Path(directory)
        if not root.is_dir():
            raise VerifierError(f"not a directory: {root}")
        return [(png, None) for png in sorted(root.rglob("*.png")) if png.with_suffix(".json").is_file()]
    if not paths:
        raise VerifierError("give an evidence PNG or --dir")
    first = Path(paths[0])
    if len(paths) == 2:
        a, b = first, Path(paths[1])
        return [(a, b) if a.suffix.lower() == ".png" else (b, a)]
    if len(paths) > 2:
        raise VerifierError("give one PNG (+ optional JSON), or use --dir")
    if first.suffix.lower() == ".json":
        return [(first.with_suffix(".png"), first)]
    return [(first, None)]


COLORS = {PASS: "\033[32m", WARN: "\033[33m", FAIL: "\033[31m", SKIP: "\033[2m"}


def print_report(report: Report, color: bool) -> None:
    paint = (lambda s: f"{COLORS[s]}{s}\033[0m") if color else (lambda s: s)
    print(f"{paint(report.status)}  {report.image}")
    if report.evidence_id:
        print(f"      evidence {report.evidence_id}")
    for c in report.checks:
        print(f"  [{paint(c.status)}] {c.name:<14} {c.detail}")
    if report.expected_watermark:
        print("  Expected watermark text (compare with the band at the bottom of the image):")
        for line in report.expected_watermark:
            print(f"    {line}")
    print()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Verify that a Proof-Shot PNG matches its JSON sidecar and was not modified.",
        epilog="Detects modification and inconsistency, not forgery of a complete PNG + JSON pair.")
    parser.add_argument("paths", nargs="*", help="evidence PNG, optionally followed by its JSON sidecar")
    parser.add_argument("--dir", help="verify every PNG with a JSON sidecar under this folder (recursive)")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument("--strict", action="store_true", help="treat warnings as failures (exit 1)")
    parser.add_argument("--no-pixels", action="store_true", help="skip the (slower) pixel hash check")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    args = parser.parse_args(argv)

    try:
        targets = collect(args.paths, args.dir)
    except VerifierError as err:
        parser.print_usage(sys.stderr)
        print(f"error: {err}", file=sys.stderr)
        return 2
    if not targets:
        print("error: no evidence found", file=sys.stderr)
        return 2

    reports = [verify(img, meta, not args.no_pixels) for img, meta in targets]
    if args.json:
        out = [{**asdict(r), "status": r.status} for r in reports]
        json.dump(out[0] if len(out) == 1 and not args.dir else out, sys.stdout, indent=2)
        print()
    else:
        color = sys.stdout.isatty()
        for r in reports:
            print_report(r, color)
        if len(reports) > 1:
            counts = {s: sum(r.status == s for r in reports) for s in (PASS, WARN, FAIL)}
            print(f"{len(reports)} evidence file(s): {counts[PASS]} pass, {counts[WARN]} warn, {counts[FAIL]} fail")

    worst = max(SEVERITY[r.status] for r in reports)
    return 1 if worst == 2 or (worst == 1 and args.strict) else 0


if __name__ == "__main__":
    sys.exit(main())
