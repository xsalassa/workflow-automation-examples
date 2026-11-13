CREATE OR REPLACE TABLE {{ params.project_id }}.{{ params.target_dataset }}.{{ params.target_table }} AS
SELECT DISTINCT
    field_182.field_184       AS field_184,
    field_182.field_104      AS field_104,
    field_182.field_170       AS field_198,
    FORMAT_DATE('%d/%m/%Y', DATE(field_182.field_191))      AS field_191,
    field_182.field_145      AS field_085,
    field_182.field_113   AS field_113,
    field_182.field_151   AS field_151,
    field_182.field_157    AS field_157,
    field_028.field_028     AS field_053,
    FORMAT_DATE('%m', DATE(field_182.field_191))  AS field_033,
    FORMAT_DATE('%Y', DATE(field_182.field_191))  AS field_190,
    NULL              AS field_196,
    NULL              AS field_079,
    NULL              AS field_204,
    field_169             AS field_169
from {{ params.project_id }}.{{ params.source_dataset }}.{{ params.source_tables['replenishments'] }} field_182
LEFT JOIN `{{ params.project_id }}.{{ params.source_dataset }}.{{ params.source_tables['stores'] }}` field_028
  ON field_182.field_170 = field_028.field_170
WHERE field_182.field_191 BETWEEN DATE_SUB(DATE('{{ dag_run.conf.get("rpt_date", params.period) }}'), INTERVAL 1 DAY)
  AND DATE('{{ dag_run.conf.get("rpt_date", params.period) }}')
AND NOT (field_182.field_145 LIKE ANY ('AA%', 'HL%','UL%','UT%'))
AND field_028.field_028 IN ({{ params.branch_codes }})
