param(
  [switch]$SkipWebBuild
)

$ErrorActionPreference = "Stop"

Write-Host "== ETA Sea Tracker smoke test =="

Write-Host "[1/4] Python syntax check..."
python -m py_compile main.py scraper_api.py orchestrator/pipeline.py scraper/hhla_scraper.py processor/excel_processor.py

Write-Host "[2/4] Python normalization test..."
python -m tests.test_normalization

Write-Host "[3/4] Mini pipeline simulation (no secrets/network)..."
@'
from processor.excel_processor import cross_match

eurogate = [{"vessel_name": " EVER GIVEN ", "eta": "13.02.2026 05:30", "terminal": "EUROGATE Hamburg"}]
hhla = [{"vessel_name": "EVER GIVEN", "eta": "13.02.2026 06:00", "terminal": "HHLA CTA"}]

result = cross_match(eurogate, hhla, threshold=85)
assert len(result) >= 1
assert result[0].get("match_score", 0) >= 85
print("Mini pipeline simulation passed.")
'@ | python -

if (-not $SkipWebBuild) {
  Write-Host "[4/4] Web build..."
  npm --prefix web run build
} else {
  Write-Host "[4/4] Web build skipped (--SkipWebBuild)."
}

Write-Host "Smoke test completed successfully."
