import unittest
from importlib.metadata import PackageNotFoundError
from unittest.mock import patch
from versions import installed_versions


class InstalledVersionsTest(unittest.TestCase):
    def test_equivalent_beta_metadata_produces_canonical_evidence(self):
        for spelling in ("4.28.0b1", "4.28.0-beta.1"):
            with self.subTest(spelling=spelling), patch(
                "versions.version", side_effect=lambda name: spelling if name == "AstrBot" else "1.4.4"
            ):
                self.assertEqual(installed_versions(), {"AstrBot": "4.28.0b1", "aiocqhttp": "1.4.4"})

    def test_different_releases_are_still_rejected(self):
        for actual in ("4.28.0", "4.28.0b2", "4.28.0rc1", "4.27.0", "invalid"):
            with self.subTest(actual=actual), patch("versions.version", return_value=actual):
                with self.assertRaises((RuntimeError, ValueError)):
                    installed_versions()

    def test_wrong_adapter_and_missing_distribution_are_rejected(self):
        with patch("versions.version", side_effect=["4.28.0b1", "1.4.3"]):
            with self.assertRaisesRegex(RuntimeError, "aiocqhttp version mismatch"):
                installed_versions()
        with patch("versions.version", side_effect=PackageNotFoundError("AstrBot")):
            with self.assertRaises(PackageNotFoundError):
                installed_versions()
