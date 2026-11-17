-- One report per brand / marketplace / week, as available at the evaluation time ($1).
-- A report is a self-contained snapshot, so candidates are ranked, never added together.
-- Precedence: complete over partial, then widest coverage (period_end), then the report the
-- publisher generated last. `revision` is our import sequence, not the publisher's: a late
-- re-import of a superseded report gets a higher revision without being newer, so revision
-- only breaks ties between imports of the same publisher report.
WITH ranked AS (
  SELECT r.*, ROW_NUMBER() OVER (
    PARTITION BY brand_id, marketplace, period_start
    ORDER BY CASE WHEN status = 'complete' THEN 0 ELSE 1 END,
             period_end DESC, generated_at DESC, revision DESC
  ) AS priority
  FROM raw.subscription_reports r
  WHERE extracted_at <= $1::timestamptz
)
SELECT * FROM ranked WHERE priority = 1
