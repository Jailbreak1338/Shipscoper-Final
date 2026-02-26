web: env LD_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu:/lib/x86_64-linux-gnu:/usr/lib:/lib python -m gunicorn scraper_api:app --bind 0.0.0.0:$PORT --timeout 300 --workers 1
