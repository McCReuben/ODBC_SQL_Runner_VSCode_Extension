-- SQL Runner Extension - Test Examples
-- Place cursor on any line and press Cmd+Enter (Mac) or Ctrl+Enter (Win/Linux)
-- Example 1: Simple SELECT
SELECT 1 as id,
  'Alice' as name,
  25 as age
UNION ALL
SELECT 2,
  'Bob',
  30
UNION ALL
SELECT 3,
  'Charlie',
  35;
-- Example 2: Multiple statements (select all and press Cmd+Enter)
DROP TABLE IF EXISTS tmp_users;
CREATE TEMPORARY TABLE tmp_users AS
SELECT 1 as id,
  'Alice' as name;
SELECT *
FROM tmp_users;
-- Example 3: Session persistence
-- First, create a temp table (execute this block)
CREATE TEMPORARY TABLE tmp_analysis AS
SELECT 'Product A' as product,
  100 as sales
UNION ALL
SELECT 'Product B',
  200
UNION ALL
SELECT 'Product C',
  150;
-- Then, query the temp table (execute this separately)
-- This works because both queries run in the same session!
SELECT product,
  sales,
  ROUND(sales * 100.0 / SUM(sales) OVER (), 2) as pct
FROM tmp_analysis
ORDER BY sales DESC;
SELECT *
FROM people;
-- Example 4: Aggregation
-- The webview shows Sum/Avg/Max when you select numeric cells
SELECT id,
  value,
  value * 2 as doubled
FROM (
    SELECT 1 as id,
      10 as value
    UNION ALL
    SELECT 2,
      20
    UNION ALL
    SELECT 3,
      30
    UNION ALL
    SELECT 4,
      40
    UNION ALL
    SELECT 5,
      50
  ) t;
-- Example 5: Real database query (update with your table)
-- SELECT * FROM your_table LIMIT 100;