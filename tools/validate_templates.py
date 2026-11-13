"""Static documentation-template checks; does not establish importability."""

import json
from pathlib import Path
import re
import sys
from urllib.parse import urlparse


def validate_document(document):
    definition=document.get('properties',{}).get('definition')
    if not isinstance(definition,dict) or not definition.get('triggers') or not definition.get('actions'):
        return ['Missing workflow definition, triggers, or actions']
    declared=set()
    references=set()

    def walk(value):
        if isinstance(value,dict):
            for key,child in value.items():
                if key in ('actions','triggers') and isinstance(child,dict):
                    declared.update(child)
                if key=='runAfter' and isinstance(child,dict):
                    references.update(child)
                walk(child)
        elif isinstance(value,list):
            for child in value:
                walk(child)
        elif isinstance(value,str):
            references.update(re.findall(r"(?:outputs|body|items|actions)\('([^']+)'\)",value))

    walk(definition)
    issues=[f'Undeclared action reference: {name}' for name in sorted(references-declared)]
    text=json.dumps(document,ensure_ascii=False)
    emails=re.findall(r'[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})',text,re.I)
    if any(domain.lower() not in ('example.com','thread.example.com') for domain in emails):
        issues.append('Non-example email domain found')
    if re.search(r'\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b',text,re.I):
        issues.append('Unreplaced resource UUID found')
    for url in re.findall(r'https?://[^\s<>\"\\]+',text):
        parsed=urlparse(url)
        if parsed.hostname=='example.com':
            continue
        if url=='https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#':
            continue
        issues.append('Non-example resource URL found')
    return sorted(set(issues))


def main():
    root=Path(__file__).resolve().parents[1]
    paths=sorted((root/'power-automate').rglob('definition.template.json'))
    if len(paths)!=2:
        print('Expected exactly two explanatory flow templates',file=sys.stderr)
        return 1
    failed=False
    for path in paths:
        try:
            issues=validate_document(json.loads(path.read_text()))
        except (ValueError,OSError,TypeError,AttributeError) as exc:
            issues=[f'Cannot validate template: {type(exc).__name__}']
        print(f'{path.parent.name}: '+('; '.join(issues) if issues else 'PASS (static checks only)'))
        failed|=bool(issues)
    return int(failed)


if __name__=='__main__':
    raise SystemExit(main())
