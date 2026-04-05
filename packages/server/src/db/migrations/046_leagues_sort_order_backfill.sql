UPDATE leagues l
SET sort_order = s.ord
FROM (
  SELECT
    league_id,
    (ROW_NUMBER() OVER (ORDER BY country, tier, league_name) * 10)::INTEGER AS ord
  FROM leagues
) s
WHERE l.league_id = s.league_id;
