-- Hermes SQL Runner Extension - Mock Database Examples
-- These examples work with the in-memory SQLite database (useMockDatabase: true)
-- Press Cmd+Enter (Mac) or Ctrl+Enter (Win/Linux) to execute

-- ============================================
-- Pre-populated Tables in Mock Database:
-- - people (id, name, age, email, department)
-- - products (id, name, category, price, stock)
-- - sales (id, product_id, quantity, sale_date, revenue)
-- - DW_SITES (site_id, site_name, region, active)
-- - active_sites (view)
-- ============================================

/*

*/


-- Example 1: Query the people table
SELECT * FROM people WHERE age > 28;

SELECT * FROM people WHERE age > 28;


/*
SELECT * FROM people WHERE age > 28;
*/

-- SLOW_QUERY
SELECT * FROM people WHERE age > 28;

-- Example 2: Query products by category
SELECT
    category,
    COUNT(*) as product_count,
    AVG(price) as avg_price,
    SUM(stock) as total_stock
FROM products
GROUP BY
    category
ORDER BY avg_price DESC;

-- Example 3: Join sales with products
SELECT p.name, p.category, s.quantity, s.revenue, s.sale_date
FROM sales s
    JOIN products p ON s.product_id = p.id
ORDER BY s.sale_date DESC;




-- Example 4: Create a temporary table (session persistence test)
CREATE TEMPORARY TABLE tmp_high_earners AS
SELECT name, age, department, email
FROM people
WHERE
    age > 30;

-- Example 5: Query the temporary table
-- Execute this AFTER creating the temp table above
SELECT department, COUNT(*) as count, ROUND(AVG(age), 1) as avg_age
FROM tmp_high_earners
GROUP BY
    department
ORDER BY count DESC;

-- Example 6: Complex aggregation with window functions
SELECT
    name,
    department,
    age,
    AVG(age) OVER (
        PARTITION BY
            department
    ) as dept_avg_age,
    age - AVG(age) OVER (
        PARTITION BY
            department
    ) as age_diff_from_avg
FROM people
ORDER BY department, age;

-- Example 7: Multiple statements (select all lines and execute)
DROP TABLE IF EXISTS tmp_product_summary;

CREATE TEMPORARY TABLE tmp_product_summary AS
SELECT category, COUNT(*) as count, AVG(price) as avg_price
FROM products
GROUP BY
    category;

SELECT * FROM tmp_product_summary;

-- Example 8: DW_SITES table (compatible with your ODBC examples)
SELECT * FROM DW_SITES;

-- Example 9: Using the view
SELECT * FROM active_sites WHERE region = 'North';

-- Example 10: Subquery example
SELECT name, email, department
FROM people
WHERE
    department IN (
        SELECT department
        FROM people
        GROUP BY
            department
        HAVING
            COUNT(*) > 2
    );

-- Example 11: Test aggregation in webview
-- After executing, select the numeric columns in the result table
-- The status bar will show Sum/Avg/Max
SELECT
    name,
    age,
    CASE
        WHEN age < 27 THEN 'Junior'
        WHEN age < 32 THEN 'Mid-level'
        ELSE 'Senior'
    END as level
FROM people
ORDER BY age;

-- Example 12: Insert new data
INSERT INTO
    people (name, age, email, department)
VALUES (
        'Kevin',
        28,
        'kevin@example.com',
        'Engineering'
    );

-- Example 13: Verify the insert
SELECT * FROM people WHERE name = 'Kevin';

-- Example 14: Update data
UPDATE products
SET
    stock = stock + 50
WHERE
    category = 'Electronics';

-- Example 15: Verify the update
SELECT name, category, stock
FROM products
WHERE
    category = 'Electronics';