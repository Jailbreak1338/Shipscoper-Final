"""Sanity checks for vessel name normalization consistency."""

from utils.normalization import normalize_vessel_name


def test_normalize_vessel_name_cases() -> None:
    """Verify canonical vessel name normalization for representative inputs."""
    cases = [
        (" ever given ", "EVER GIVEN"),
        ("MSC    OSCAR", "MSC OSCAR"),
        ("cma cgm marco polo", "CMA CGM MARCO POLO"),
        ("HAPAG\tLLOYD\nEXPRESS", "HAPAG LLOYD EXPRESS"),
        ("MOL-TRIUMPH", "MOL-TRIUMPH"),
    ]

    for raw, expected in cases:
        actual = normalize_vessel_name(raw)
        assert actual == expected, f"{raw!r} -> {actual!r}, expected {expected!r}"


def run() -> None:
    """Backward-compatible direct runner for ad-hoc local checks."""
    test_normalize_vessel_name_cases()
    print("Normalization test passed (5 cases).")


if __name__ == "__main__":
    run()
