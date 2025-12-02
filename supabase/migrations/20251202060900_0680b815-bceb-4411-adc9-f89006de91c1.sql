-- Extend benchmark_datasets suite_category constraint to include 'financebench'
ALTER TABLE benchmark_datasets 
DROP CONSTRAINT IF EXISTS benchmark_datasets_suite_category_check;

ALTER TABLE benchmark_datasets 
ADD CONSTRAINT benchmark_datasets_suite_category_check 
CHECK (suite_category = ANY (ARRAY[
  'general'::text, 
  'finance'::text, 
  'financebench'::text,
  'charts'::text, 
  'receipts'::text, 
  'science'::text, 
  'narrative'::text, 
  'code'::text, 
  'safety'::text, 
  'hybrid'::text, 
  'trading'::text
]));