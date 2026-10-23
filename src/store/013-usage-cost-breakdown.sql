ALTER TABLE usage ADD COLUMN cost_input REAL CHECK (cost_input IS NULL OR cost_input >= 0);
ALTER TABLE usage ADD COLUMN cost_output REAL CHECK (cost_output IS NULL OR cost_output >= 0);
ALTER TABLE usage ADD COLUMN cost_cache_read REAL CHECK (cost_cache_read IS NULL OR cost_cache_read >= 0);
ALTER TABLE usage ADD COLUMN cost_cache_write REAL CHECK (cost_cache_write IS NULL OR cost_cache_write >= 0);
