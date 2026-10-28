"""Check the test runner's MediaStore selection without a connected device."""
import ast
from pathlib import Path
import re
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'docs/quality/whimsical-neck-region-20261029/try-android-ui.py'
tree = ast.parse(SOURCE.read_text(encoding='utf-8'))
method = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'parse_media_uri')
scope = {'re': re}
exec(compile(ast.Module(body=[method], type_ignores=[]), str(SOURCE), 'exec'), scope)
parse = scope['parse_media_uri']

class QueryParserTest(unittest.TestCase):
    def test_selects_exact_name_from_multiple_rows(self):
        raw = ('Row: 0 _id=12, _display_name=mint-qa-wilson.png\n'
               'Row: 1 _id=42, _display_name=mint-qa-sherman.png\n')
        self.assertEqual(parse(raw, 'mint-qa-sherman.png'),
                         'content://media/external/images/media/42')
        self.assertEqual(parse(raw, 'mint-qa-wilson.png'),
                         'content://media/external/images/media/12')

    def test_does_not_match_substrings_or_error_output(self):
        self.assertIsNone(parse('Row: 0 _id=2, _display_name=mint-qa-sherman.png.bak',
                                'mint-qa-sherman.png'))
        self.assertIsNone(parse('Error: SQL syntax error', 'mint-qa-sherman.png'))
        self.assertIsNone(parse('Row: 0 _id=3, _display_name=other.png',
                                'mint-qa-sherman.png'))

if __name__ == '__main__':
    unittest.main()
