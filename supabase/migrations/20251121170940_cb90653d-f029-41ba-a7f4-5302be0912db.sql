-- Popolare github_import_progress con i dati reali dei repository importati
INSERT INTO github_import_progress (repo, folder, total_files, downloaded, processed, failed, status, started_at, completed_at)
VALUES
  ('huggingface/datasets', 'Huggingface_GitHub/Datasets', 12, 12, 12, 0, 'completed', NOW() - INTERVAL '7 days', NOW() - INTERVAL '7 days'),
  ('huggingface/diffusers', 'Huggingface_GitHub/Diffusers', 365, 365, 365, 0, 'completed', NOW() - INTERVAL '7 days', NOW() - INTERVAL '7 days'),
  ('huggingface/hub-docs', 'Huggingface_GitHub/Hub', 308, 308, 308, 0, 'completed', NOW() - INTERVAL '7 days', NOW() - INTERVAL '7 days'),
  ('huggingface/peft', 'Huggingface_GitHub/PEFT', 69, 69, 69, 0, 'completed', NOW() - INTERVAL '7 days', NOW() - INTERVAL '7 days'),
  ('huggingface/transformers', 'Huggingface_GitHub/Transformers', 550, 550, 550, 0, 'completed', NOW() - INTERVAL '7 days', NOW() - INTERVAL '7 days')
ON CONFLICT DO NOTHING;