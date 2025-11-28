-- Add 'narrative' to benchmark_datasets suite_category CHECK constraint
ALTER TABLE benchmark_datasets 
DROP CONSTRAINT IF EXISTS benchmark_datasets_suite_category_check;

ALTER TABLE benchmark_datasets 
ADD CONSTRAINT benchmark_datasets_suite_category_check 
CHECK (suite_category = ANY (ARRAY['finance', 'charts', 'general', 'safety', 'receipts', 'science', 'narrative']));