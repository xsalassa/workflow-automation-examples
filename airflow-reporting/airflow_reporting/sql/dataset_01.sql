
CREATE OR REPLACE TABLE {{ params.project_id }}.{{ params.target_dataset }}.{{ params.target_table }} AS
SELECT distinct
  NULLIF(field_116.field_117, '') AS field_123,
  NULLIF(field_116.field_119, '') AS field_124,
  NULL AS field_108,
  NULL AS field_100,
  NULL AS field_101,
  NULL AS field_045,
  NULLIF(field_116.field_068, '') AS field_046,
  NULLIF(field_116.field_118, '') AS field_109,
  NULLIF(field_116.field_178, '') AS field_179,
  NULLIF(field_116.field_062, '') AS field_127,
  NULLIF(field_116.field_063, '') AS field_128,
  NULLIF(field_116.field_057, '') AS field_129,
  NULLIF(field_116.field_058, '') AS field_130,
  NULLIF(field_116.field_037, '') AS field_131,
  NULLIF(field_116.field_038, '') AS field_132,
  NULL AS field_133,
  NULL AS field_134,
  NULL AS field_135,
  NULL AS field_136,
  NULL AS field_137,
  NULL AS field_138,
  NULL AS field_139,
  NULL AS field_140,
  NULL AS field_141,
  NULL AS field_142,
  NULL AS field_143,
  NULL AS field_144,
  NULL AS field_125,
  NULL AS field_126,
  NULL AS field_005,
  NULL AS field_006,
  NULL AS field_007,
  NULL AS field_008,
  NULL AS field_009,
  NULL AS field_010,
  NULL AS field_011,
  NULL AS field_012,
  NULL AS field_013,
  NULL AS field_014,
  NULL AS field_015,
  NULL AS field_016,
  NULL AS field_017,
  NULL AS field_018,
  NULL AS field_019,
  NULL AS field_020,
  NULL AS field_021,
  NULL AS field_022,
  NULL AS field_003,
  NULL AS field_004,
  NULLIF(field_116.field_031, '') AS field_031,
  NULL AS field_148,
  NULL AS field_121,
  NULL AS field_120,
  NULLIF(field_116.field_195, '') AS field_195,
  ifnull(MAX(field_092) OVER(PARTITION BY field_115.field_117 ORDER BY field_115.field_090 DESC),0) AS field_044,
  'IDR' AS field_050,
  DATE(DATE('{{ dag_run.conf.get("rpt_date", params.period) }}')-1) AS field_075,
  NULL AS field_002,
  CASE
    WHEN UPPER(field_115.field_067) LIKE '%TBO=Y%' OR field_147 IN ('N', 'R', 'F') THEN FALSE
    ELSE TRUE
  END AS field_077,
  CASE
    WHEN field_165 = 'B' THEN CAST(field_202 AS FLOAT64) * 30
    WHEN field_165 = 'H' THEN CAST(field_202 AS FLOAT64)
    WHEN field_165 = 'J' THEN 1.0
    ELSE CAST(field_202 AS FLOAT64)
  END AS field_025,
  NULL AS field_111,
  NULLIF(field_203, '') AS field_110,
  field_205 AS field_205,
  NULL AS field_206,
  NULLIF(field_209,'') AS field_209,
  NULLIF(field_210, '') AS field_210
from `{{ params.project_id }}.{{ params.source_dataset }}.{{ params.source_tables['products'] }}` field_116
LEFT JOIN `{{ params.project_id }}.{{ params.source_dataset }}.{{ params.source_tables['monthly_product_status'] }}` field_115 ON field_116.field_117 = field_115.field_117 AND field_115.field_102 = DATE_TRUNC(DATE('{{ dag_run.conf.get("rpt_date", params.period) }}')-1, MONTH)
LEFT JOIN `{{ params.project_id }}.{{ params.source_dataset }}.{{ params.source_tables['stores'] }}` field_168 ON field_115.field_170 = field_168.field_170 AND field_168.field_028 IN ({{ params.branch_codes }})

where 1=1

QUALIFY ROW_NUMBER() OVER (PARTITION BY field_116.field_117 ORDER BY field_115.field_090 DESC) = 1
