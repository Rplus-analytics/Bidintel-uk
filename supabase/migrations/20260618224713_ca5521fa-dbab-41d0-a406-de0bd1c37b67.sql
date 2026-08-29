UPDATE saved_searches
SET last_alerted_at = now()
WHERE active = true;