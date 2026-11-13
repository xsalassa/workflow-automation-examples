
CREATE OR REPLACE TABLE {{ params.project_id }}.{{ params.target_dataset }}.{{ params.target_table }} AS
SELECT DISTINCT
  NULLIF(field_184||field_169||field_064||field_167, '') AS field_200,
  NULLIF(field_184||field_169||field_064, '') AS field_161,
  NULLIF(field_152.field_117, '') AS field_123,
  NULLIF(field_170, '') AS field_185,
  NULL AS field_051,
  field_153 AS field_160,
  TIME(field_154) AS field_197,
  NULLIF(field_158, '') AS field_164,
  NULLIF(field_201, '') AS field_159,
  SUM(CASE WHEN field_158 = 'D' THEN field_149 * -1 ELSE field_149 END) AS field_162,
  SUM(CASE WHEN field_158 = 'D' THEN (field_070 - field_114) * -1 ELSE field_070 - field_114 END) AS field_163,
  SUM(CASE WHEN field_158 = 'D' THEN field_114 * -1 ELSE field_114 END) AS field_194,
  SUM(CASE WHEN field_158 = 'D' THEN field_059 * -1 ELSE field_059 END) AS field_059,
  SUM(field_074) AS field_044,
  'IDR' AS field_050,
  NULL AS field_078
from {{ params.project_id }}.{{ params.source_dataset }}.{{ params.source_tables['sales_lines'] }} field_152
JOIN `{{ params.project_id }}.{{ params.source_dataset }}.{{ params.source_tables['branch_hierarchy'] }}` field_027
  ON field_152.field_029 = field_027.field_086
  AND field_087 IN ({{ params.branch_codes }})
JOIN {{ params.project_id }}.{{ params.source_dataset }}.{{ params.source_tables['products'] }} field_116
  ON field_152.field_117 = field_116.field_117
WHERE field_153 = DATE('{{ dag_run.conf.get("rpt_date", params.period) }}')-1
AND NOT(
    LEFT(field_116.field_036, 4) IN ('7206', '7221', '7222', '7223', '7224', '7225')
    OR field_116.field_036 IN ('721678', '721679', '721772')
 )
GROUP BY ALL
