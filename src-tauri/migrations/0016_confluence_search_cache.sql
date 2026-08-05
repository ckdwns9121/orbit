CREATE TABLE IF NOT EXISTS confluence_pages (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  space_key TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  url TEXT NOT NULL,
  last_modified TEXT NOT NULL,
  discovered_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS confluence_searches (
  query_key TEXT PRIMARY KEY NOT NULL,
  cql TEXT NOT NULL,
  searched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS confluence_search_results (
  query_key TEXT NOT NULL REFERENCES confluence_searches(query_key) ON DELETE CASCADE,
  page_id TEXT NOT NULL REFERENCES confluence_pages(id) ON DELETE CASCADE,
  PRIMARY KEY (query_key, page_id)
);

CREATE INDEX IF NOT EXISTS confluence_pages_last_modified
  ON confluence_pages(last_modified DESC);
