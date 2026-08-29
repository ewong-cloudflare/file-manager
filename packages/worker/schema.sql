CREATE TABLE IF NOT EXISTS shares (
  id           TEXT    PRIMARY KEY,
  owner_email  TEXT    NOT NULL,
  path         TEXT    NOT NULL,
  is_folder    INTEGER NOT NULL DEFAULT 0,
  permission   TEXT    NOT NULL CHECK(permission IN ('read','read_write','read_write_delete')),
  grantee_email TEXT   NOT NULL,
  link_token   TEXT    NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shares_owner   ON shares(owner_email);
CREATE INDEX IF NOT EXISTS idx_shares_grantee ON shares(grantee_email);
CREATE INDEX IF NOT EXISTS idx_shares_token   ON shares(link_token);
