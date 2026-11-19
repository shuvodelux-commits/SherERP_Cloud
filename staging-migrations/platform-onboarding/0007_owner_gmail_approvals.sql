CREATE TABLE platform_owner_gmail_approvals (
  shop_id TEXT PRIMARY KEY NOT NULL REFERENCES platform_shop_bindings(shop_id),
  email TEXT NOT NULL CHECK(length(email) BETWEEN 11 AND 74 AND email=lower(email) AND email LIKE '%@gmail.com'),
  approved_by_subject TEXT NOT NULL CHECK(length(approved_by_subject) BETWEEN 1 AND 255),
  approved_at_ms INTEGER NOT NULL CHECK(approved_at_ms>0)
) STRICT;
