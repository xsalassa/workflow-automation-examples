"""Check the Excel source excerpt without cloud calls or workbook writes."""
import ast
import json
from pathlib import Path
from types import SimpleNamespace
import unittest

ROOT=Path(__file__).resolve().parents[1]/'airflow-reporting/excel-generation'

class ExcelGenerationTests(unittest.TestCase):
    def test_example_matches_publisher_message_contract(self):
        tree=ast.parse((ROOT/'publish_excel_request.py').read_text())
        dictionary=next(n for n in ast.walk(tree) if isinstance(n,ast.Dict) and any(isinstance(k,ast.Constant) and k.value=='Report_type' for k in n.keys))
        keys={ast.literal_eval(k) for k in dictionary.keys}
        payload=json.loads((ROOT/'message.example.json').read_text())
        self.assertEqual(set(payload),keys)
        self.assertEqual(payload['Format'],'xlsx')
        self.assertEqual(payload['Report_type'],'excel_table')

    def writer(self,fail=False):
        calls=[]
        class Sheet:
            def write(self,*a):calls.append(('header',a[:2]))
            def write_column(self,*a):calls.append(('column',a[:2]))
            def autofilter(self,*a):pass
            def hide_gridlines(self,*a):pass
            def ignore_errors(self,*a):pass
        class Workbook:
            def __init__(self,name):
                if fail:raise ValueError('Synthetic writer failure')
                calls.append(('filename',name))
            def add_worksheet(self,name):return Sheet()
            def add_format(self,style):return style
            def close(self):calls.append(('closed',True))
        node=next(n for n in ast.parse((ROOT/'excel_writer.py').read_text()).body if isinstance(n,ast.ClassDef))
        ns={'xlsxwriter':SimpleNamespace(Workbook=Workbook,utility=SimpleNamespace(xl_col_to_name=lambda n:chr(65+n)))}
        exec(compile(ast.Module(body=[node],type_ignores=[]),'excel_writer.py','exec'),ns)
        return ns['generate_excel'](),calls

    def test_xlsx_suffix_and_columns_written(self):
        writer,calls=self.writer()
        class Frame:
            shape=(2,1)
            def __iter__(self):return iter(['amount'])
            def __getitem__(self,key):return SimpleNamespace(dtype='int64',tolist=lambda:[10,20])
        self.assertEqual(writer.genExcelFile(Frame(),'synthetic_workbook','xlsx'),('',False,200))
        self.assertIn(('filename','synthetic_workbook.xlsx'),calls)
        self.assertIn(('header',('A1','amount')),calls)
        self.assertIn(('column',('A2',[10,20])),calls)
        self.assertIn(('closed',True),calls)

    def test_writer_failure_returns_error_status(self):
        writer,_=self.writer(fail=True)
        error,failed,status=writer.genExcelFile(None,'synthetic_workbook','xlsx')
        self.assertTrue(failed)
        self.assertEqual(status,500)
        self.assertIn('Synthetic writer failure',error)

if __name__=='__main__':unittest.main()
