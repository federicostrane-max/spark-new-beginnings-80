-- Abilita REPLICA IDENTITY FULL per catturare tutti i dati durante gli update Realtime
ALTER TABLE browser_tasks REPLICA IDENTITY FULL;
ALTER TABLE browser_steps REPLICA IDENTITY FULL;