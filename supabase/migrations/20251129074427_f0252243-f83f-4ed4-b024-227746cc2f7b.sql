-- Add 'trading' to benchmark_datasets suite_category constraint
ALTER TABLE benchmark_datasets 
DROP CONSTRAINT IF EXISTS benchmark_datasets_suite_category_check;

ALTER TABLE benchmark_datasets
ADD CONSTRAINT benchmark_datasets_suite_category_check 
CHECK (suite_category IN ('general', 'finance', 'charts', 'receipts', 'science', 'narrative', 'code', 'safety', 'hybrid', 'trading'));