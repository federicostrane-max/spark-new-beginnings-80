-- Update check constraint to include all benchmark suite categories
ALTER TABLE benchmark_datasets 
DROP CONSTRAINT IF EXISTS benchmark_datasets_suite_category_check;

ALTER TABLE benchmark_datasets 
ADD CONSTRAINT benchmark_datasets_suite_category_check 
CHECK (suite_category = ANY (ARRAY['finance'::text, 'charts'::text, 'general'::text, 'safety'::text, 'receipts'::text, 'science'::text]));