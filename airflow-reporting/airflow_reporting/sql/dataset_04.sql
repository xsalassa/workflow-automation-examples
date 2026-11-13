CREATE OR REPLACE TABLE {{ params.project_id }}.{{ params.target_dataset }}.{{ params.target_table }} AS
SELECT DISTINCT
    field_106.field_184         AS field_184,
    field_106.field_104        AS field_104,
    field_106.field_170         AS field_198,
    FORMAT_DATE('%d/%m/%Y', DATE(field_106.field_191))      AS field_191,
    field_106.field_085        AS field_085,
    field_106.field_073             AS `field_072`,
    field_106.field_105          AS field_105,
    field_106.field_081     AS field_081,
    field_106.field_112     AS field_112,
    field_106.field_150     AS field_150,
    field_106.field_156      AS field_156,
    field_106.field_029       AS field_053,
    FORMAT_DATE('%m', DATE(field_106.field_191))  AS field_033,
    FORMAT_DATE('%Y', DATE(field_106.field_191))  AS field_190,
    NULL                            AS field_196,
    NULL                            AS field_079,
    NULL                            AS field_204,
    field_169                           AS field_169
from {{ params.project_id }}.{{ params.source_dataset }}.{{ params.source_tables['channel_transactions'] }} field_106
WHERE field_106.field_191 BETWEEN DATE_SUB(DATE('{{ dag_run.conf.get("rpt_date", params.period) }}'), INTERVAL 1 DAY)
  AND DATE('{{ dag_run.conf.get("rpt_date", params.period) }}')
AND NOT (field_106.field_085 LIKE ANY ('AA%', 'HL%','UL%','UT%'))
AND field_029 IN ({{ params.branch_codes }})
