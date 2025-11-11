-- Elimina i messaggi "user" che contengono pattern di sistema generati dalla vecchia logica
-- Questi messaggi confondono l'LLM e causano risposte duplicate

DELETE FROM agent_messages
WHERE role = 'user'
AND (
  content LIKE 'Ho trovato % PDF per%'
  OR content LIKE '%Confermi il download di questi PDF?%'
  OR content LIKE '%Non ho trovato risultati per%'
  OR content LIKE '%Errore durante la ricerca:%'
  OR content LIKE '%Vuoi provare con una query diversa?%'
);