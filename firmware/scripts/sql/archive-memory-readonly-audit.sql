-- OFFLINE-COPY-ONLY; never run against a mounted/live CoreS3 SD card.
-- PRAGMA query_only protects against accidental UPDATE/DDL in this sqlite3 session.
-- Outputs only schema and aggregate counts; names/messages are never printed.
PRAGMA query_only = ON;
PRAGMA table_info(entities);
PRAGMA table_info(name_readings);
PRAGMA table_info(profile_details);
PRAGMA table_info(messages);
PRAGMA table_info(message_context);
PRAGMA foreign_key_check;

SELECT 'people',COUNT(*) FROM entities WHERE kind='person';
SELECT 'robot_profiles',COUNT(*) FROM entities WHERE kind='robot';
SELECT 'legacy_stackchan_self',COUNT(*) FROM entities WHERE id='stackchan-self';
SELECT 'readings',COUNT(*) FROM name_readings;
SELECT 'profile_details',COUNT(*) FROM profile_details;
SELECT 'unmatched_readings',COUNT(*) FROM name_readings r LEFT JOIN entities e ON e.id=r.user_id WHERE e.id IS NULL;
SELECT 'unmatched_details',COUNT(*) FROM profile_details p LEFT JOIN entities e ON e.id=p.user_id WHERE e.id IS NULL;
SELECT 'assistant_messages',COUNT(*) FROM messages WHERE role='assistant';
SELECT 'legacy_robot_speaker',COUNT(*) FROM messages WHERE speaker_id='stackchan-self';
SELECT 'context_links',COUNT(*) FROM message_context;
SELECT 'unmatched_message_context',COUNT(*) FROM message_context c LEFT JOIN messages m ON m.id=c.message_id WHERE m.id IS NULL;
SELECT 'multi_person_messages',COUNT(*) FROM (SELECT message_id FROM message_context GROUP BY message_id HAVING COUNT(DISTINCT user_id)>1);
