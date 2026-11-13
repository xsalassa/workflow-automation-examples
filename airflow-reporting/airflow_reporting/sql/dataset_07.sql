
CREATE OR REPLACE TABLE {{ params.project_id }}.{{ params.target_dataset }}.{{ params.target_table }} AS
SELECT DISTINCT
  NULLIF(field_054, '') AS field_207,
  NULLIF(field_055, '') AS field_208,
  "ID" AS field_048,
  NULLIF(field_155, '') AS field_023,
  NULLIF(field_155, '') AS field_041,
  NULL AS field_060,
  NULL AS field_211,
  NULL AS field_091,
  NULL AS field_096
from {{ params.project_id }}.{{ params.source_dataset }}.{{ params.source_tables['distribution_centers'] }} field_053
JOIN `{{ params.project_id }}.{{ params.source_dataset }}.{{ params.source_tables['branch_hierarchy'] }}` field_027
  ON field_027.field_086 = field_053.field_054 AND field_087 IN ({{ params.branch_codes }})
  AND (
        NOT(UPPER(field_055) LIKE "DC PERISHABLE%"
        OR UPPER(field_055) LIKE "SECONDARY%")
      )
QUALIFY ROW_NUMBER()over(partition by field_053.field_054 ORDER BY field_053.field_082 DESC) = 1
