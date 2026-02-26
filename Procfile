web: bash -lc 'exec python -m gunicorn scraper_api:app --bind 0.0.0.0:${PORT:-8080} --timeout 300 --workers 1 --error-logfile - --access-logfile - --capture-output --log-level info'
