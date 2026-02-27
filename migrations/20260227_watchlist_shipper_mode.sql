-- Add business source + mode to watchlist entries
ALTER TABLE vessel_watches
  ADD COLUMN IF NOT EXISTS shipper_source TEXT,
  ADD COLUMN IF NOT EXISTS shipment_mode TEXT
    CHECK (shipment_mode IN ('LCL', 'FCL'));

UPDATE vessel_watches
SET shipment_mode = COALESCE(shipment_mode, CASE
  WHEN container_reference IS NOT NULL AND btrim(container_reference) <> '' THEN 'FCL'
  ELSE 'LCL'
END)
WHERE shipment_mode IS NULL;

ALTER TABLE vessel_watches
  ALTER COLUMN shipment_mode SET DEFAULT 'LCL';
