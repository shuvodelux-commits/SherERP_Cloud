/** M07-B6 TEST-ONLY edit-version projection; no financial D1 writer or migration. */
export const M07_RETURN_EDIT_READ_DDL=[
`CREATE TABLE m07_return_edit_versions(
 tenant_id TEXT NOT NULL,
 return_id TEXT NOT NULL,
 edit_version INTEGER NOT NULL CHECK(edit_version>=0 AND edit_version<=1000000),
 PRIMARY KEY(tenant_id,return_id)
) STRICT`
];
