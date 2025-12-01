-- Add suite_category column to benchmark_results table for filtering by test suite
ALTER TABLE benchmark_results ADD COLUMN suite_category text;