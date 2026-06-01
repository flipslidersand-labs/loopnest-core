-- ============================================
-- M01: Seed Data - Organizations & Staff
-- ============================================

-- Organizations
INSERT INTO core.organizations (id, name, type, parent_id) VALUES
  (gen_random_uuid(), 'LoopNest Tech 株式会社', 'company', NULL);

-- Get the company ID
WITH company AS (
  SELECT id FROM core.organizations WHERE name = 'LoopNest Tech 株式会社' LIMIT 1
)
INSERT INTO core.organizations (id, name, type, parent_id)
SELECT
  gen_random_uuid(),
  '法人営業部',
  'department',
  id
FROM company;

-- Get the sales department ID
WITH sales_dept AS (
  SELECT id FROM core.organizations WHERE name = '法人営業部' LIMIT 1
)
INSERT INTO core.organizations (id, name, type, parent_id)
SELECT gen_random_uuid(), '第1課（大手企業担当）', 'division', id FROM sales_dept
UNION ALL
SELECT gen_random_uuid(), '第2課（中堅企業担当）', 'division', id FROM sales_dept
UNION ALL
SELECT gen_random_uuid(), '第3課（新規開拓担当）', 'division', id FROM sales_dept
UNION ALL
SELECT gen_random_uuid(), '第4課（既存顧客深耕担当）', 'division', id FROM sales_dept
UNION ALL
SELECT gen_random_uuid(), '第5課（海外営業 / LoopNest Global 担当）', 'division', id FROM sales_dept;

-- Verify
SELECT COUNT(*) as organization_count FROM core.organizations;
