"""Unit tests for proof-shot-verify.py (stdlib unittest, synthetic evidence built on the fly).

Run: python3 -m unittest discover -s verifier/tests
"""

from __future__ import annotations

import contextlib
import hashlib
import io
import json
import random
import struct
import sys
import tempfile
import unittest
import zlib
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

# The CLI file name has hyphens (proof-shot-verify.py), so it is loaded by path, not imported.
_spec = spec_from_file_location("proof_shot_verify", Path(__file__).resolve().parents[1] / "proof-shot-verify.py")
v = module_from_spec(_spec)
sys.modules[_spec.name] = v  # dataclasses resolve annotations through sys.modules
_spec.loader.exec_module(v)

EVIDENCE_ID = "0d39b9de-f625-4e87-99d8-2b3d447811a6"


def chunk(ctype: bytes, body: bytes) -> bytes:
    return struct.pack(">I", len(body)) + ctype + body + struct.pack(">I", zlib.crc32(ctype + body))


def encode_png(width: int, height: int, rgba: bytes, color_type: int = 6, filters=(0,)) -> bytes:
    """Minimal PNG encoder. Applies the given filter types round-robin (only 0 and 2 are encoded
    natively; others are emitted as raw bytes with filter 0 since decoding is what we test)."""
    bpp = 4 if color_type == 6 else 3
    raw = bytearray()
    prev = bytes(width * bpp)
    for y in range(height):
        row = rgba[y * width * 4:(y + 1) * width * 4]
        if color_type == 2:
            row = b"".join(row[i:i + 3] for i in range(0, len(row), 4))
        ftype = filters[y % len(filters)]
        if ftype == 2:
            raw += b"\x02" + bytes((a - b) & 0xFF for a, b in zip(row, prev))
        elif ftype == 1:
            raw += b"\x01" + bytes((row[i] - (row[i - bpp] if i >= bpp else 0)) & 0xFF for i in range(len(row)))
        elif ftype == 4:
            out = bytearray()
            for i in range(len(row)):
                a = row[i - bpp] if i >= bpp else 0
                c = prev[i - bpp] if i >= bpp else 0
                out.append((row[i] - v._paeth(a, prev[i], c)) & 0xFF)
            raw += b"\x04" + out
        elif ftype == 3:
            out = bytearray()
            for i in range(len(row)):
                a = row[i - bpp] if i >= bpp else 0
                out.append((row[i] - ((a + prev[i]) >> 1)) & 0xFF)
            raw += b"\x03" + out
        else:
            raw += b"\x00" + row
        prev = row
    ihdr = struct.pack(">IIBBBBB", width, height, 8, color_type, 0, 0, 0)
    return v.PNG_SIGNATURE + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw))) + chunk(b"IEND", b"")


def make_pixels(width: int, height: int, seed: int = 1) -> bytes:
    rnd = random.Random(seed)
    return bytes(b for _ in range(width * height) for b in (rnd.randrange(256), rnd.randrange(256), rnd.randrange(256), 255))


class Evidence:
    """A PNG + JSON pair laid out like the extension writes it."""

    def __init__(self, root: Path, width: int = 40, height: int = 30, schema: str = "1.1", **png_kwargs):
        self.width, self.height = width, height
        self.capture = make_pixels(width, height)
        band_h = v.band_height(width)
        self.full = self.capture + bytes([17, 20, 24, 255]) * (width * band_h)
        png = encode_png(width, height + band_h, self.full, **png_kwargs)
        folder = root / "Proof-Shot" / "SOC2" / "2026-11-18"
        folder.mkdir(parents=True)
        self.png = folder / f"234214_SEC-1234_{EVIDENCE_ID[:8]}.png"
        self.json = self.png.with_suffix(".json")
        self.png.write_bytes(png)
        self.meta = {
            "schema_version": schema,
            "evidence_id": EVIDENCE_ID,
            "session": "SOC2",
            "case_id": "SEC-1234",
            "auditor": "Auditor",
            "captured_at_utc": "2026-11-19T04:42:14.650Z",
            "captured_at_local": "2026-11-18T23:42:14.650-05:00",
            "timezone": "America/Bogota",
            "page": {"url": "https://x.example/a?t=1", "url_redacted": "https://x.example/a", "title": "t"},
            "network": {"public_ip": "203.0.113.42"},
            "environment": {"browser": "Chrome 151", "os": "Linux", "extension": "Proof-Shot 1.1.0"},
            "capture": {"mode": "visible", "format": "png", "width": width, "height": height},
            "integrity": {
                "algorithm": "SHA-256",
                "sha256_original": "a" * 64,
                "sha256_pixels": hashlib.sha256(self.capture).hexdigest(),
                "sha256_final": hashlib.sha256(png).hexdigest(),
            },
            "files": {"image": f"Proof-Shot/SOC2/2026-11-18/{self.png.name}", "metadata": "x.json"},
        }
        if schema == "1.0":
            del self.meta["capture"]["width"], self.meta["capture"]["height"], self.meta["integrity"]["sha256_pixels"]
        self.save()

    def save(self) -> None:
        self.json.write_text(json.dumps(self.meta))

    def rewrite_png(self, rgba: bytes, height: int | None = None, update_hash: bool = False) -> None:
        png = encode_png(self.width, height or (len(rgba) // (self.width * 4)), rgba)
        self.png.write_bytes(png)
        if update_hash:
            self.meta["integrity"]["sha256_final"] = hashlib.sha256(png).hexdigest()
            self.save()


def statuses(report: v.Report) -> dict[str, str]:
    return {c.name: c.status for c in report.checks}


class VerifyTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_untouched_evidence_passes(self):
        ev = Evidence(self.root)
        report = v.verify(ev.png)
        self.assertEqual(report.status, v.PASS, report.checks)
        self.assertEqual(report.evidence_id, EVIDENCE_ID)

    def test_all_png_filters_and_rgb_decode_identically(self):
        for color_type in (6, 2):
            with self.subTest(color_type=color_type):
                sub = self.root / f"ct{color_type}"
                ev = Evidence(sub, width=33, height=21, color_type=color_type, filters=(0, 1, 2, 3, 4))
                self.assertEqual(v.verify(ev.png).status, v.PASS, v.verify(ev.png).checks)

    def test_edited_screenshot_pixel_fails(self):
        ev = Evidence(self.root)
        tampered = bytearray(ev.full)
        tampered[100] ^= 0xFF
        ev.rewrite_png(bytes(tampered))
        s = statuses(v.verify(ev.png))
        self.assertEqual((s["sha256_final"], s["sha256_pixels"]), (v.FAIL, v.FAIL))

    def test_forged_pair_without_pixel_hash_update_fails(self):
        """Attacker edits the image and updates sha256_final, but forgets sha256_pixels."""
        ev = Evidence(self.root)
        tampered = bytearray(ev.full)
        tampered[0] = (tampered[0] + 1) % 256
        ev.rewrite_png(bytes(tampered), update_hash=True)
        s = statuses(v.verify(ev.png))
        self.assertEqual(s["sha256_final"], v.PASS)
        self.assertEqual(s["sha256_pixels"], v.FAIL)

    def test_reencoded_png_warns_but_content_intact(self):
        ev = Evidence(self.root)
        ev.png.write_bytes(encode_png(ev.width, len(ev.full) // (ev.width * 4), ev.full, filters=(2,)))
        report = v.verify(ev.png)
        s = statuses(report)
        self.assertEqual((s["sha256_final"], s["sha256_pixels"]), (v.FAIL, v.WARN))
        self.assertEqual(report.status, v.FAIL)

    def test_cropped_band_fails_dimensions(self):
        ev = Evidence(self.root)
        ev.rewrite_png(ev.full[:ev.width * 4 * (ev.height + 3)])
        self.assertEqual(statuses(v.verify(ev.png))["dimensions"], v.FAIL)

    def test_edited_json_metadata_is_detected_when_inconsistent(self):
        ev = Evidence(self.root)
        ev.meta["captured_at_local"] = "2026-11-18T22:42:14.650-05:00"
        ev.save()
        s = statuses(v.verify(ev.png))
        self.assertEqual(s["timestamps"], v.FAIL)

    def test_wrong_timezone_offset_fails(self):
        ev = Evidence(self.root)
        ev.meta["captured_at_local"] = "2026-11-19T00:42:14.650-04:00"
        ev.save()
        self.assertEqual(statuses(v.verify(ev.png))["timestamps"], v.FAIL)

    def test_evidence_id_swap_fails_naming(self):
        ev = Evidence(self.root)
        ev.meta["evidence_id"] = "11111111-f625-4e87-99d8-2b3d447811a6"
        ev.save()
        self.assertEqual(statuses(v.verify(ev.png))["naming"], v.FAIL)

    def test_renamed_file_warns(self):
        ev = Evidence(self.root)
        new_png = ev.png.with_name("evidence.png")
        ev.png.rename(new_png)
        report = v.verify(new_png, ev.json)
        self.assertEqual(statuses(report)["naming"], v.WARN)
        self.assertEqual(report.status, v.WARN)

    def test_schema_10_still_verifies_file_hash(self):
        ev = Evidence(self.root, schema="1.0")
        s = statuses(v.verify(ev.png))
        self.assertEqual(s["sha256_final"], v.PASS)
        self.assertEqual(s["sha256_pixels"], v.SKIP)
        self.assertEqual(s["dimensions"], v.SKIP)

    def test_unknown_schema_fails(self):
        ev = Evidence(self.root)
        ev.meta["schema_version"] = "9.0"
        ev.save()
        self.assertEqual(statuses(v.verify(ev.png))["schema"], v.FAIL)

    def test_corrupted_chunk_crc_fails(self):
        ev = Evidence(self.root)
        data = bytearray(ev.png.read_bytes())
        data[40] ^= 0x01  # inside IDAT
        ev.png.write_bytes(bytes(data))
        s = statuses(v.verify(ev.png))
        self.assertEqual(s["png_structure"], v.FAIL)

    def test_trailing_data_after_iend_warns(self):
        ev = Evidence(self.root)
        ev.png.write_bytes(ev.png.read_bytes() + b"hidden payload")
        s = statuses(v.verify(ev.png))
        self.assertEqual((s["sha256_final"], s["png_structure"]), (v.FAIL, v.WARN))

    def test_invalid_json_and_missing_sidecar(self):
        ev = Evidence(self.root)
        ev.json.write_text("{not json")
        self.assertEqual(statuses(v.verify(ev.png))["metadata"], v.FAIL)
        ev.json.unlink()
        self.assertEqual(statuses(v.verify(ev.png))["metadata"], v.FAIL)

    def test_not_a_png(self):
        ev = Evidence(self.root)
        ev.png.write_bytes(b"GIF89a....")
        self.assertEqual(statuses(v.verify(ev.png))["png_structure"], v.FAIL)

    def test_decompression_bomb_is_bounded(self):
        """Huge IDAT behind small declared dimensions: decoder must read only what it needs."""
        ihdr = struct.pack(">IIBBBBB", 2, 2, 8, 6, 0, 0, 0)
        bomb = zlib.compress(b"\x00" * (50 * 1024 * 1024))
        png = v.parse_png(v.PNG_SIGNATURE + chunk(b"IHDR", ihdr) + chunk(b"IDAT", bomb) + chunk(b"IEND", b""))
        self.assertEqual(len(v.rgba_rows(png, 2)), 16)

    def test_oversized_dimensions_rejected(self):
        ihdr = struct.pack(">IIBBBBB", 100_000, 100_000, 8, 6, 0, 0, 0)
        with self.assertRaises(v.VerifierError):
            v.parse_png(v.PNG_SIGNATURE + chunk(b"IHDR", ihdr) + chunk(b"IEND", b""))


class LayoutTests(unittest.TestCase):
    def test_js_round_half_up(self):
        self.assertEqual([v.js_round(x) for x in (0.5, 1.5, 2.5, 12.45)], [1, 2, 3, 12])

    def test_band_height_matches_known_captures(self):
        # 1280px wide E2E capture: 854 - 713 = 141 (observed in headless Chrome).
        self.assertEqual(v.band_height(1280), 141)
        self.assertEqual(v.band_height(400), 126)  # font clamped to 12px: 2 + 2*11 + 6*17


class CliTests(unittest.TestCase):
    def run_cli(self, *args):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            code = v.main(list(args))
        return code, out.getvalue()

    def test_exit_codes_and_json_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            ev = Evidence(Path(tmp))
            code, out = self.run_cli("--json", str(ev.png))
            self.assertEqual(code, 0)
            self.assertEqual(json.loads(out)["status"], v.PASS)

            code, _ = self.run_cli(str(ev.json))  # JSON path resolves the sibling PNG
            self.assertEqual(code, 0)

            renamed = ev.png.with_name("x.png")
            ev.png.rename(renamed)
            self.assertEqual(self.run_cli(str(renamed), str(ev.json))[0], 0)
            self.assertEqual(self.run_cli("--strict", str(renamed), str(ev.json))[0], 1)

    def test_dir_mode_reports_each_pair(self):
        with tempfile.TemporaryDirectory() as tmp:
            Evidence(Path(tmp) / "a")
            bad = Evidence(Path(tmp) / "b")
            bad.png.write_bytes(bad.png.read_bytes()[:-1] + b"\x00")
            code, out = self.run_cli("--json", "--dir", tmp)
            self.assertEqual(code, 1)
            self.assertEqual(sorted(r["status"] for r in json.loads(out)), [v.FAIL, v.PASS])

    def test_usage_errors(self):
        self.assertEqual(self.run_cli()[0], 2)
        self.assertEqual(self.run_cli("--dir", "/nonexistent-dir")[0], 2)


if __name__ == "__main__":
    unittest.main()
