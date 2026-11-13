import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import pymupdf

MODULE = Path(__file__).resolve().parents[1] / 'add_watermark.py'
spec = importlib.util.spec_from_file_location('watermark', MODULE)
watermark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watermark)


class WatermarkTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.input = self.root / 'input.pdf'
        with pymupdf.open() as doc:
            for text in ('Synthetic page one', 'Synthetic page two'):
                page = doc.new_page(width=300, height=400)
                page.insert_text((30, 40), text)
            doc.save(self.input)
        self.original = self.input.read_bytes()
        self.mark = self.root / 'sample.png'
        pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 20), False)
        pix.clear_with(90)
        pix.save(self.mark)
        self.output = self.root / 'output.pdf'

    def apply(self, **kwargs):
        return watermark.add_watermark(self.input, self.mark, self.output,
                                       x=20, y=70, width=80, height=40, **kwargs)

    def test_first_page_only_and_preserve_input(self):
        self.assertEqual(self.apply(), 1)
        with pymupdf.open(self.output) as doc:
            self.assertEqual(len(doc[0].get_images()), 1)
            self.assertEqual(len(doc[1].get_images()), 0)
            self.assertIn('Synthetic page two', doc[1].get_text())
        self.assertEqual(self.input.read_bytes(), self.original)

    def test_all_pages_changes_both_pages(self):
        self.assertEqual(self.apply(pages='all'), 2)
        with pymupdf.open(self.output) as doc:
            self.assertTrue(all(page.get_images() for page in doc))

    def test_existing_output_requires_explicit_overwrite(self):
        self.output.write_bytes(b'existing content')
        with self.assertRaises(FileExistsError):
            self.apply()
        self.assertEqual(self.output.read_bytes(), b'existing content')
        self.assertEqual(self.apply(overwrite=True), 1)

    def test_refuses_input_as_output_even_with_overwrite(self):
        with self.assertRaises(ValueError):
            watermark.add_watermark(self.input, self.mark, self.input, overwrite=True)
        self.assertEqual(self.input.read_bytes(), self.original)

    def test_refuses_hardlink_to_input(self):
        self.output.hardlink_to(self.input)
        with self.assertRaises(ValueError):
            self.apply(overwrite=True)
        self.assertEqual(self.input.read_bytes(), self.original)

    def test_refuses_symlink_output(self):
        self.output.symlink_to(self.input)
        with self.assertRaises(ValueError):
            self.apply(overwrite=True)

    def test_invalid_geometry_leaves_no_output(self):
        for geometry in ({'x':-1}, {'width':0}, {'height':float('nan')},
                         {'x':290,'width':80}, {'y':390,'height':40}):
            with self.subTest(geometry=geometry), self.assertRaises(ValueError):
                watermark.add_watermark(self.input, self.mark, self.output, **geometry)
            self.assertFalse(self.output.exists())

    def test_invalid_page_selection_leaves_no_output(self):
        with self.assertRaises(ValueError):
            self.apply(pages='last')
        self.assertFalse(self.output.exists())

    def test_corrupt_input_leaves_no_output(self):
        self.input.write_bytes(b'not a PDF')
        with self.assertRaises(ValueError):
            self.apply()
        self.assertFalse(self.output.exists())

    def test_invalid_mark_leaves_no_output(self):
        self.mark.write_bytes(b'not an image')
        with self.assertRaises(ValueError):
            self.apply()
        self.assertFalse(self.output.exists())

    def test_missing_input_and_output_directory(self):
        self.input.unlink()
        with self.assertRaises(FileNotFoundError):
            self.apply()
        self.assertFalse(self.output.exists())

    def test_all_pages_preflight_before_output(self):
        with pymupdf.open() as doc:
            doc.new_page(width=300,height=400)
            doc.new_page(width=40,height=40)
            doc.save(self.input)
        with self.assertRaises(ValueError):
            self.apply(pages='all')
        self.assertFalse(self.output.exists())

    def test_no_output_on_encrypted_document(self):
        encrypted = self.root / 'encrypted.pdf'
        with pymupdf.open(self.input) as doc:
            doc.save(encrypted, encryption=pymupdf.PDF_ENCRYPT_AES_256,
                     owner_pw='synthetic-owner', user_pw='synthetic-reader')
        with self.assertRaises(ValueError):
            watermark.add_watermark(encrypted,self.mark,self.output)
        self.assertFalse(self.output.exists())

    def test_rotated_page_is_rejected_explicitly(self):
        rotated = self.root / 'rotated.pdf'
        with pymupdf.open(self.input) as doc:
            doc[0].set_rotation(90)
            doc.save(rotated)
        with self.assertRaises(ValueError):
            watermark.add_watermark(rotated,self.mark,self.output)
        self.assertFalse(self.output.exists())

    def test_cropped_page_is_rejected_explicitly(self):
        cropped = self.root / 'cropped.pdf'
        with pymupdf.open(self.input) as doc:
            doc[0].set_cropbox(pymupdf.Rect(10,10,290,390))
            doc.save(cropped)
        with self.assertRaises(ValueError):
            watermark.add_watermark(cropped,self.mark,self.output)
        self.assertFalse(self.output.exists())

    def test_failed_publication_preserves_existing_output_and_cleans_temp(self):
        self.output.write_bytes(b'existing content')
        with patch.object(watermark.os,'replace',side_effect=PermissionError('Synthetic failure')):
            with self.assertRaises(PermissionError):
                self.apply(overwrite=True)
        self.assertEqual(self.output.read_bytes(),b'existing content')
        self.assertEqual(list(self.root.glob('.watermark-*')),[])

    def test_missing_output_directory(self):
        output = self.root/'missing'/'out.pdf'
        with self.assertRaises(FileNotFoundError):
            watermark.add_watermark(self.input,self.mark,output)
        self.assertFalse(output.parent.exists())


if __name__ == '__main__':
    unittest.main()
