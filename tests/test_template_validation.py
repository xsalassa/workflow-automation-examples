import importlib.util
from pathlib import Path
import unittest

path=Path(__file__).resolve().parents[1]/'tools/validate_templates.py'
spec=importlib.util.spec_from_file_location('validator',path)
validator=importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


def document(value='@outputs(\'ACTION_001\')'):
    return {'properties':{'definition':{
        'triggers':{'TRIGGER_001':{'type':'OpenApiConnection'}},
        'actions':{'ACTION_001':{'type':'Compose','inputs':'example'},
                   'ACTION_002':{'type':'Compose','inputs':value,'runAfter':{'ACTION_001':['Succeeded']}}}
    }}}


class TemplateValidationTests(unittest.TestCase):
    def test_generic_connected_actions_pass(self):
        self.assertEqual(validator.validate_document(document()),[])

    def test_undeclared_expression_reference_fails(self):
        self.assertTrue(validator.validate_document(document("@body('MISSING_ACTION')")))

    def test_undeclared_run_after_reference_fails(self):
        value=document();value['properties']['definition']['actions']['ACTION_002']['runAfter']={'MISSING_ACTION':['Succeeded']}
        self.assertTrue(validator.validate_document(value))

    def test_private_email_fails_but_example_email_passes(self):
        self.assertTrue(validator.validate_document(document('person@private.test')))
        self.assertEqual(validator.validate_document(document('person@example.com')),[])

    def test_private_url_fails_standard_schema_passes(self):
        self.assertTrue(validator.validate_document(document('https://private.test/workbook')))
        self.assertEqual(validator.validate_document(document('https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#')),[])

    def test_real_resource_uuid_fails(self):
        self.assertTrue(validator.validate_document(document('11111111-2222-4333-8444-555555555555')))

    def test_missing_definition_fails(self):
        self.assertTrue(validator.validate_document({}))


if __name__=='__main__':
    unittest.main()
