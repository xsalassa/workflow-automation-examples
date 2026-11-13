
CREATE OR REPLACE TABLE {{ params.project_id }}.{{ params.target_dataset }}.{{ params.target_table }} AS
SELECT DISTINCT
  NULLIF(field_168.field_170, '') AS field_185,
  NULLIF(field_168.field_174, '') AS field_186,
  'ID' AS field_048,
  NULLIF(field_168.field_146, '') AS field_023,
  COALESCE(NULLIF(field_168.field_089, ''), NULLIF(field_168.field_083, '')) AS field_041,
  NULLIF(field_168.field_083, '') AS field_060,
  NULLIF(field_168.field_080, '') AS field_032,
  NULL AS field_039,
  NULLIF(field_168.field_172, '') AS field_042,
  CASE WHEN field_189.field_170 field_076 NOT NULL THEN 'SMLWH=Y' ELSE NULL END AS field_069,
  field_168.field_028 AS field_166,

  CASE
    WHEN field_168.field_171 = 'VI' THEN 'E-Commerce'
    WHEN LEFT(field_168.field_170, 1) IN ('F', 'R') THEN 'Franchise'
    WHEN LEFT(field_168.field_170, 1) = 'T' THEN 'Regular'
  END AS field_040,
  field_098 AS field_071,
  field_097 AS field_103,
  'square meters' AS field_024,
  field_091,
  field_096,
  field_192 AS field_107,
  field_193 AS field_043,

  IFNULL(field_193, CURRENT_DATE("Asia/Jakarta")+1) > CURRENT_DATE("Asia/Jakarta") AS field_077,
  'IDR' AS field_093,
  NULLIF(field_176, '') AS field_187,
  NULLIF(field_175, '') AS field_180,
  NULLIF(field_173, '') AS field_065,
  NULLIF(field_177, '') AS field_188
from {{ params.project_id }}.{{ params.source_dataset }}.{{ params.source_tables['stores'] }} field_168
JOIN `{{ params.project_id }}.{{ params.source_dataset }}.{{ params.source_tables['branch_hierarchy'] }}` field_053 ON field_168.field_028 = field_053.field_086 AND field_087 IN ({{ params.branch_codes }})
LEFT JOIN {{ params.project_id }}.{{ params.source_dataset }}.{{ params.source_tables['store_warehouses'] }} field_189 ON field_168.field_170 = field_189.field_170
