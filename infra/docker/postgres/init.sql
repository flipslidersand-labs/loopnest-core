-- Create schemas
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS workflow;
CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS events;

-- Grant permissions
GRANT ALL ON SCHEMA core TO loopnest;
GRANT ALL ON SCHEMA workflow TO loopnest;
GRANT ALL ON SCHEMA finance TO loopnest;
GRANT ALL ON SCHEMA audit TO loopnest;
GRANT ALL ON SCHEMA events TO loopnest;
