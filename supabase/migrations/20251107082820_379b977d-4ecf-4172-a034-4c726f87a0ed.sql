-- Enable Realtime for agent_messages table to receive background updates
ALTER PUBLICATION supabase_realtime ADD TABLE agent_messages;