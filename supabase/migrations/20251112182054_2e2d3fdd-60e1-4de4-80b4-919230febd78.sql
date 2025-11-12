-- Add bibliographic_match column to knowledge_relevance_scores (if not exists)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='knowledge_relevance_scores' 
                 AND column_name='bibliographic_match') THEN
    ALTER TABLE knowledge_relevance_scores
    ADD COLUMN bibliographic_match NUMERIC NOT NULL DEFAULT 0.0;
    
    COMMENT ON COLUMN knowledge_relevance_scores.bibliographic_match IS 
    'Score 0.0-1.0 indicante quanto il chunk corrisponde ai requisiti bibliografici';
  END IF;
END $$;

-- Add missing_bibliographic_references and prerequisite_check_status columns to alignment_analysis_log
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='alignment_analysis_log' 
                 AND column_name='missing_bibliographic_references') THEN
    ALTER TABLE alignment_analysis_log
    ADD COLUMN missing_bibliographic_references JSONB DEFAULT '[]'::jsonb;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='alignment_analysis_log' 
                 AND column_name='prerequisite_check_status') THEN
    ALTER TABLE alignment_analysis_log
    ADD COLUMN prerequisite_check_status TEXT DEFAULT 'passed';
    
    COMMENT ON COLUMN alignment_analysis_log.prerequisite_check_status IS 
    'Stato della verifica prerequisiti: 
    - passed: tutti i prerequisiti soddisfatti, analisi completata
    - blocked_missing_sources: riferimenti bibliografici critici mancanti, analisi BLOCCATA
    - skipped: nessun prerequisito critico, verifica saltata';
    
    -- Check constraint for valid status values
    ALTER TABLE alignment_analysis_log
    ADD CONSTRAINT check_prerequisite_status 
    CHECK (prerequisite_check_status IN ('passed', 'blocked_missing_sources', 'skipped'));
  END IF;
END $$;

-- Add missing_bibliographic_references column to knowledge_gap_analysis
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='knowledge_gap_analysis' 
                 AND column_name='missing_bibliographic_references') THEN
    ALTER TABLE knowledge_gap_analysis
    ADD COLUMN missing_bibliographic_references JSONB NOT NULL DEFAULT '[]'::jsonb;
    
    COMMENT ON COLUMN knowledge_gap_analysis.missing_bibliographic_references IS 
    'Riferimenti bibliografici richiesti dal prompt ma assenti dal knowledge base';
  END IF;
END $$;