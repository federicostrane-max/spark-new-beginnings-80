-- Add 'timeout' and 'blocked' to alignment_analysis_progress status constraint
ALTER TABLE alignment_analysis_progress 
DROP CONSTRAINT IF EXISTS alignment_analysis_progress_status_check;

ALTER TABLE alignment_analysis_progress 
ADD CONSTRAINT alignment_analysis_progress_status_check 
CHECK (status IN ('running', 'completed', 'error', 'timeout', 'blocked'));