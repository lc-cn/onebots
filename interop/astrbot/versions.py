"""AstrBot fixture identity shared by the preflight and emitted evidence."""
from importlib.metadata import version
from packaging.version import Version

EXPECTED_VERSIONS = {"AstrBot": "4.28.0b1", "aiocqhttp": "1.4.4"}


def installed_versions() -> dict[str, str]:
    result = {}
    for name, expected in EXPECTED_VERSIONS.items():
        actual = version(name)
        if Version(actual) != Version(expected):
            raise RuntimeError(f"{name} version mismatch: expected {expected}, got {actual}")
        result[name] = str(Version(actual))
    return result
