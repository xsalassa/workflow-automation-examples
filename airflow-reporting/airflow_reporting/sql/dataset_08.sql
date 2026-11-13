CREATE OR REPLACE TABLE {{ params.project_id }}.{{ params.target_dataset }}.{{ params.target_table }} AS
SELECT
    field_001.field_117    AS field_123,
    field_001.field_170   AS field_185,
    field_001.field_084  AS field_099
from {{ params.source_dataset }}.{{ params.source_tables['display_capacity'] }} field_001
JOIN {{ params.source_dataset }}.{{ params.source_tables['products'] }} field_026
    ON field_001.field_117 = field_026.field_117
JOIN {{ params.source_dataset }}.{{ params.source_tables['stores'] }} field_034
    ON field_001.field_170 = field_034.field_170
JOIN {{ params.source_dataset }}.{{ params.source_tables['product_assignments'] }} field_052  on  field_034.field_028 = field_052.field_030 and field_026.field_062 || field_026.field_057|| field_026.field_037 = field_052.field_061 || field_052.field_056|| field_052.field_035
WHERE field_191 = DATE('{{ dag_run.conf.get("rpt_date", params.period) }}')-1
    AND field_034.field_028 IN ({{ params.branch_codes }})
ORDER BY 1;
