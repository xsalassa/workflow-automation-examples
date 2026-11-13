"""Check that the explorer retains scoped dependencies and source details."""
import importlib.util
from pathlib import Path
import unittest

path=Path(__file__).resolve().parents[1]/'tools/build_flow_details.py'
spec=importlib.util.spec_from_file_location('flow_details',path)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class FlowDetailsTests(unittest.TestCase):
    def test_dependencies_keep_status_and_parallel_roots(self):
        definition={'triggers':{'T':{'type':'Trigger'}},'actions':{
            'A':{'type':'Compose'},'B':{'type':'Compose'},
            'C':{'type':'Compose','runAfter':{'A':['Failed','TimedOut']}}}}
        scope=module.extract_scopes(definition)[0]
        self.assertEqual(scope['edges'],[
            {'from':'T','to':'A','statuses':[],'triggerEntry':True},
            {'from':'T','to':'B','statuses':[],'triggerEntry':True},
            {'from':'A','to':'C','statuses':['Failed','TimedOut']}])
    def test_condition_loop_and_action_details_are_retained(self):
        leaf={'type':'Compose','inputs':'@variables(\'GENERIC_VALUE\')'}
        definition={'triggers':{},'actions':{'Choice':{'type':'If','expression':True,
            'actions':{'Loop':{'type':'Foreach','foreach':'@items()','actions':{'Leaf':leaf}}},
            'else':{'actions':{'Other':{'type':'Compose'}}}}}}
        scopes=module.extract_scopes(definition)
        self.assertEqual(len(scopes),4)
        self.assertEqual(scopes[0]['nodes'][0]['children'][1]['label'],'False branch')
        found=[n for s in scopes for n in s['nodes'] if n['id']=='Leaf'][0]
        self.assertEqual(found['detail'],leaf)
        self.assertEqual(sum(len(s['nodes']) for s in scopes),4)
    def test_invalid_cross_scope_dependency_fails(self):
        with self.assertRaises(ValueError):
            module.extract_scopes({'triggers':{},'actions':{'A':{'runAfter':{'missing':['Succeeded']}}}})

if __name__=='__main__':unittest.main()
