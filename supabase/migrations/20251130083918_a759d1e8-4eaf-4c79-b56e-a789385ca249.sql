-- Constraint architetturale corretto: chunk_id NULL permesso solo per job non ancora processati
ALTER TABLE visual_enrichment_queue
ADD CONSTRAINT visual_enrichment_chunk_id_required
CHECK (
  chunk_id IS NOT NULL 
  OR status IN ('pending')
);