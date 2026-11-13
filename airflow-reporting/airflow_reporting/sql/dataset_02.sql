
CREATE OR REPLACE TABLE {{ params.project_id }}.{{ params.target_dataset }}.{{ params.target_table }} AS
SELECT DISTINCT
  field_115.field_170                      AS field_094,
  0                               AS field_095,
  field_115.field_117                       AS field_122,
  21                              AS field_181,
  CURRENT_DATE("Asia/Jakarta")    AS field_183,
  CURRENT_DATE("Asia/Jakarta")+1  AS field_066,
from `{{ params.project_id }}.{{ params.source_dataset }}.{{ params.source_tables['product_status_as_of'] }}`(DATE('{{ dag_run.conf.get("rpt_date", params.period) }}')-1) field_115
JOIN `{{ params.project_id }}.{{ params.source_dataset }}.{{ params.source_tables['stores'] }}` field_168 ON field_115.field_170 = field_168.field_170
JOIN `{{ params.project_id }}.{{ params.source_dataset }}.{{ params.source_tables['branch_hierarchy'] }}` field_053 ON field_168.field_028 = field_053.field_086 AND field_087 IN ({{ params.branch_codes }})
JOIN `{{ params.project_id }}.{{ params.source_dataset }}.{{ params.source_tables['products'] }}` field_116 ON field_115.field_117 = field_116.field_117
WHERE NOT(
    UPPER(field_115.field_067) LIKE "%TBO=Y%"
    OR UPPER(field_115.field_067) LIKE "%BJD=Y%"
    OR UPPER(field_115.field_067) LIKE "%POT=Y%"
    OR field_147 IN ("N","R","F")
    OR (field_088 = 'K'
          AND field_116.field_036 NOT IN ("732678","732679","732670",
                                  "733779",
                                  "733878","733879",
                                  "733978","733979",
                                  "733078","733070","733071","733072",
                                  "733278","733279",
                                  "733478","733479",
                                  "733578","733570",
                                  "733678","733679","733670",
                                  "734778",
                                  "734878",
                                  "734978","734979",
                                  "734078"
                                )
            AND field_115.field_117 NOT IN ("97801227", "97801228")
            AND field_116.field_031 NOT IN ("BRAND_ALPHA")
            AND NOT (field_116.field_031 IN ( "BRAND_BETA", "BRAND_BETA_VARIANT")
                    AND field_116.field_036 IN (  "710479", "710470", "710471",
                                          "710472", "710474", "710476")
            )
    )
    OR LEFT(field_036, 4) IN ('7206', '7221', '7222', '7223', '7224', '7225')
    OR field_036 IN ('721678', '721679', '721772')
    OR IFNULL(field_168.field_193, '2999-12-31') <= DATE('{{ dag_run.conf.get("rpt_date", params.period) }}')
    OR field_168.field_171 = 'VI'
    OR field_168.field_174 LIKE ANY (
                            '%PANCINGAN%'
                            ,'%PAYMENT_CATEGORY%'
                            ,'%SERVICE_CATEGORY%'
                            ,'%SIMULASI%'
                            ,'%EVENT%'
                            , '%MOBILE_CATEGORY%'
                            )
    OR field_168.field_170 = 'TCOD'
    OR field_115.field_049 = '99'
    )
AND NOT (
    field_115.field_117 IN
    (
      SELECT DISTINCT field_117 FROM
        (
          SELECT DISTINCT field_047 as field_117 from {{ params.source_dataset }}.{{ params.source_tables['product_conversions'] }}
          UNION ALL
          SELECT DISTINCT field_117 from {{ params.source_dataset }}.{{ params.source_tables['product_recipes'] }}
          UNION ALL
          SELECT DISTINCT field_117 from {{ params.source_dataset }}.{{ params.source_tables['product_bundles'] }}
        )
    )
)
AND NOT EXISTS (
    SELECT 1
    from `{{ params.project_id }}.{{ params.source_dataset }}.{{ params.source_tables['component_movements'] }}` field_199
    WHERE 1=1
      AND field_199.field_170 = field_115.field_170
      AND field_199.field_117 = field_115.field_117
)
