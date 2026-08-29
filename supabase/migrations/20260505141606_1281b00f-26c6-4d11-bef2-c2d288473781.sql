ALTER TABLE buyers ADD COLUMN IF NOT EXISTS external_id text;
CREATE UNIQUE INDEX IF NOT EXISTS buyers_external_id_idx ON buyers(external_id) WHERE external_id IS NOT NULL;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS external_id text;
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_external_id_idx ON suppliers(external_id) WHERE external_id IS NOT NULL;