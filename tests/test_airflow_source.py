"""Verify the copied source without importing Airflow or making cloud requests."""
import ast
import hashlib
import io
import json
import re
from pathlib import Path
from types import SimpleNamespace
import unittest

PACKAGE=Path(__file__).resolve().parents[1]/'airflow-reporting/airflow_reporting'

def function(name,path,namespace):
    node=next(n for n in ast.parse(path.read_text()).body if isinstance(n,ast.FunctionDef) and n.name==name)
    exec(compile(ast.Module(body=[node],type_ignores=[]),str(path),'exec'),namespace)
    return namespace[name]

class AirflowSourceTests(unittest.TestCase):
    def test_every_source_relation_is_configured_in_both_environments(self):
        keys=set()
        for path in (PACKAGE/'sql').glob('*.sql'):
            sql=path.read_text()
            keys.update(re.findall(r"params\.source_tables\['([^']+)'\]",sql))
            self.assertIn('{{ params.source_dataset }}',sql)
            self.assertTrue(sql.lstrip().startswith('CREATE OR REPLACE TABLE') or 'CREATE OR REPLACE TABLE' in sql)
            self.assertIn('{{ params.target_table }} AS',sql)
            self.assertNotRegex(sql,r'\bdw\.')
        for path in (PACKAGE/'config').glob('*.json'):
            env=json.loads(path.read_text())['env']
            self.assertEqual(keys,set(env['source_tables']))
            self.assertEqual(env['source_dataset'],'source_demo')
            self.assertTrue(env['source_tables']['product_status_as_of'].startswith('fn_'))

    def test_create_and_export_resolve_to_the_same_configured_target(self):
        tree=ast.parse((PACKAGE/'report_generation.py').read_text())
        bindings={}
        for node in ast.walk(tree):
            if isinstance(node,ast.Dict):
                for key,value in zip(node.keys,node.values):
                    if isinstance(key,ast.Constant) and key.value in ['target_table','source_table']:
                        bindings[key.value]=value
        env=json.loads((PACKAGE/'config/config_dev.json').read_text())['env']
        reports=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and isinstance(n.targets[0],ast.Name) and n.targets[0].id=='REPORTS')
        self.assertEqual(set(env['target_tables']),{r['name'] for r in reports})
        for report in reports:
            context={'TARGET_TABLES':env['target_tables'],'report_name':report['name']}
            resolved={key:eval(compile(ast.Expression(body=node),'target_binding','eval'),{'__builtins__':{}},context) for key,node in bindings.items()}
            self.assertEqual(resolved['target_table'],resolved['source_table'])
            self.assertTrue(resolved['target_table'].startswith('generated_'))

    def test_generic_category_prefixes_retain_their_lengths(self):
        for name in ['dataset_02.sql','dataset_06.sql']:
            sql=(PACKAGE/'sql'/name).read_text()
            prefixes=re.search(r'LEFT\([^)]*,\s*4\) IN \(([^)]+)\)',sql).group(1)
            values=re.findall(r"'([^']+)'",prefixes)
            self.assertTrue(values)
            self.assertTrue(all(len(value)==4 and value.isdigit() for value in values))
            self.assertNotIn('CATEGORY_',sql)
            for comparison in re.findall(r'(?:field_\d+\.)?field_\d+\s+(?:NOT\s+)?IN\s*\(([^)]+)\)',sql,re.I):
                if 'BRAND_' not in comparison:
                    continue
                brands=re.findall(r'"([^"]+)"',comparison)
                self.assertTrue(brands)
                self.assertTrue(all(value.startswith('BRAND_') for value in brands))
    def test_report_groups_and_sql_files_are_consistent(self):
        values={}
        for node in ast.parse((PACKAGE/'report_generation.py').read_text()).body:
            if isinstance(node,ast.Assign) and isinstance(node.targets[0],ast.Name) and node.targets[0].id in ['REPORTS','GROUP_1','GROUP_2']:
                values[node.targets[0].id]=ast.literal_eval(node.value)
        names=[r['name'] for r in values['REPORTS']]
        self.assertEqual(len(names),8)
        self.assertCountEqual(values['GROUP_1']+values['GROUP_2'],names)
        self.assertFalse(set(values['GROUP_1'])&set(values['GROUP_2']))
        for report in values['REPORTS']:
            self.assertTrue((PACKAGE/'sql'/report['sql_file']).is_file())
        for config in (PACKAGE/'config').glob('*.json'):
            d=json.loads(config.read_text())
            self.assertEqual(d['dag']['email'],['owner@example.com'])
            self.assertIsNone(d['dag']['schedule'])
    def test_sql_identifiers_use_only_neutral_fields(self):
        allowed=set("CREATE OR REPLACE TABLE AS SELECT FROM DISTINCT NULL FALSE TRUE CASE WHEN THEN ELSE END LEFT JOIN ON AND IN WHERE QUALIFY OVER PARTITION BY ORDER DESC ASC NOT LIKE ANY UNION ALL EXISTS BETWEEN INTERVAL DAY MONTH YEAR FLOAT64 INT64 STRING DATE BOOL GROUP NULLIF IFNULL MAX DATE_TRUNC CURRENT_DATE ROW_NUMBER UPPER CAST COALESCE FORMAT_DATE DATE_SUB SUM TIME".split())
        for path in (PACKAGE/'sql').glob('*.sql'):
            sql=path.read_text()
            self.assertNotIn('--',sql)
            masked=re.sub(r'\{\{.*?\}\}', '', sql, flags=re.S)
            masked=re.sub(r"'(?:[^']|'')*'|\"(?:[^\"]|\"\")*\"", '', masked)
            fields=[]
            for token in re.findall(r'\b[A-Za-z_]\w*\b',masked):
                neutral=re.fullmatch(r'field_\d{3}',token)
                self.assertTrue(neutral or token.upper() in allowed,(path.name,token))
                if neutral:
                    fields.append(token)
            self.assertTrue(fields,path.name)

    def test_readiness_ready_branch(self):
        ns={'bigquery':SimpleNamespace(Client=lambda:object()),'get_total_rows_table':lambda *args:1}
        poll=function('_waiting_until_jobs_done',PACKAGE/'script/waiting_until_jobs_done.py',ns)
        self.assertEqual(poll('project','ops','status'),'waiting_jobs_done')
    def test_readiness_timeout_does_not_sleep_after_last_check(self):
        waits=[]
        ns={'bigquery':SimpleNamespace(Client=lambda:object()),'get_total_rows_table':lambda *args:0,'time':SimpleNamespace(sleep=waits.append)}
        poll=function('_waiting_until_jobs_done',PACKAGE/'script/waiting_until_jobs_done.py',ns)
        with self.assertRaisesRegex(Exception,'Maximum retries'):
            poll('project','ops','status')
        self.assertEqual(waits,[300]*11)
    def test_manifest_checksum_stream(self):
        checksum=function('sha1_stream_gcs',PACKAGE/'report_generation.py',{'hashlib':hashlib})
        blob=SimpleNamespace(open=lambda mode:io.BytesIO(b'synthetic report data'))
        self.assertEqual(checksum(blob),hashlib.sha1(b'synthetic report data').hexdigest())

if __name__=='__main__':unittest.main()
