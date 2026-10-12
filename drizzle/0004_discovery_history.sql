CREATE INDEX IF NOT EXISTS idx_pair_discovery_domain
ON pair_memories (pair_id, json_extract(payload, '$.discovery.domain'), created_at);
