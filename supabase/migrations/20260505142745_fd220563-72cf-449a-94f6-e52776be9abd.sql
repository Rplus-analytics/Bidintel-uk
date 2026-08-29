DROP INDEX IF EXISTS buyers_external_id_idx;
DROP INDEX IF EXISTS suppliers_external_id_idx;
ALTER TABLE buyers ADD CONSTRAINT buyers_external_id_key UNIQUE (external_id);
ALTER TABLE suppliers ADD CONSTRAINT suppliers_external_id_key UNIQUE (external_id);