-- Repair migration: ensure watchlist business metadata columns exist in environments
-- where 20260227_watchlist_shipper_mode.sql was not applied.

ALTER TABLE vessel_watches
  ADD COLUMN IF NOT EXISTS shipper_source TEXT,
  ADD COLUMN IF NOT EXISTS shipment_mode TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'vessel_watches'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%shipment_mode%'
      AND pg_get_constraintdef(c.oid) ILIKE '%LCL%'
      AND pg_get_constraintdef(c.oid) ILIKE '%FCL%'
  ) THEN
    ALTER TABLE vessel_watches
      ADD CONSTRAINT vessel_watches_shipment_mode_check
      CHECK (shipment_mode IN ('LCL', 'FCL'));
  END IF;
END $$;

UPDATE vessel_watches
SET shipment_mode = CASE
  WHEN shipment_mode IN ('LCL', 'FCL') THEN shipment_mode
  WHEN container_reference IS NOT NULL AND btrim(container_reference) <> '' THEN 'FCL'
  ELSE 'LCL'
END
WHERE shipment_mode IS DISTINCT FROM CASE
  WHEN shipment_mode IN ('LCL', 'FCL') THEN shipment_mode
  WHEN container_reference IS NOT NULL AND btrim(container_reference) <> '' THEN 'FCL'
  ELSE 'LCL'
END;

ALTER TABLE vessel_watches
  ALTER COLUMN shipment_mode SET DEFAULT 'LCL';
