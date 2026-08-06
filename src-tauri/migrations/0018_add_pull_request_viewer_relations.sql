ALTER TABLE github_pull_requests
  ADD COLUMN authored_by_viewer INTEGER NOT NULL DEFAULT 1;

ALTER TABLE github_pull_requests
  ADD COLUMN review_requested INTEGER NOT NULL DEFAULT 0;
