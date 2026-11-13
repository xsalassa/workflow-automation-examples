"""Apply a visible image overlay to PDF pages. This is not digital signing."""

import argparse
import math
import os
from pathlib import Path
import tempfile

import pymupdf


def add_watermark(input_pdf, mark_image, output_pdf, *, x=36, y=72,
                  width=120, height=48, pages='first', overwrite=False):
    source = Path(input_pdf).resolve(strict=True)
    mark = Path(mark_image).resolve(strict=True)
    output = Path(output_pdf).absolute()
    if output.is_symlink():
        raise ValueError('Output must not be a symbolic link')
    if not source.is_file() or not mark.is_file():
        raise ValueError('Input PDF and mark must be regular files')
    if output.suffix.lower() != '.pdf':
        raise ValueError('Output filename must end in .pdf')
    if source == output.resolve() or mark == output.resolve():
        raise ValueError('Output must be different from both input files')
    if output.exists() and (os.path.samefile(output, source) or os.path.samefile(output, mark)):
        raise ValueError('Output must not be a hard link to an input')
    if output.exists() and not overwrite:
        raise FileExistsError('Output exists; use --overwrite to replace it')
    if not output.parent.is_dir():
        raise FileNotFoundError('Output directory must already exist')
    if pages not in ('first', 'all'):
        raise ValueError('Pages must be first or all')
    if not all(math.isfinite(n) for n in (x, y, width, height)):
        raise ValueError('Geometry must contain finite numbers')
    if x < 0 or y < 0 or width <= 0 or height <= 0:
        raise ValueError('Position must be nonnegative and dimensions positive')
    if mark.suffix.lower() not in ('.png', '.jpg', '.jpeg'):
        raise ValueError('Mark must be a PNG or JPEG file')
    if mark.stat().st_size > 10 * 1024 * 1024:
        raise ValueError('Mark exceeds the 10 MiB input limit')
    try:
        image_bytes = mark.read_bytes()
        decoded = pymupdf.Pixmap(image_bytes)
        if decoded.width * decoded.height > 20_000_000:
            raise ValueError('Mark exceeds the 20 megapixel limit')
    except Exception as exc:
        raise ValueError('Cannot decode the mark image') from exc

    temporary = None
    try:
        try:
            document = pymupdf.open(source)
        except Exception as exc:
            raise ValueError('Cannot open the input PDF') from exc
        with document:
            if not document.is_pdf or document.needs_pass or not len(document):
                raise ValueError('Input must be a nonempty, unencrypted PDF')
            selected = list(range(len(document))) if pages == 'all' else [0]
            box = pymupdf.Rect(x, y, x + width, y + height)
            for index in selected:
                page = document[index]
                if page.rotation or page.cropbox != page.mediabox or page.mediabox.top_left != pymupdf.Point(0, 0):
                    raise ValueError('This example requires unrotated, uncropped pages with a zero-origin MediaBox')
                if not document[index].rect.contains(box):
                    raise ValueError(f'Mark rectangle does not fit page {index + 1}')
            for index in selected:
                document[index].insert_image(box, stream=image_bytes, overlay=True,
                                              keep_proportion=True)
            descriptor, name = tempfile.mkstemp(prefix='.watermark-', suffix='.pdf', dir=output.parent)
            os.close(descriptor)
            temporary = Path(name)
            document.save(temporary, garbage=4, deflate=True)
        if overwrite:
            os.replace(temporary, output)
        else:
            # Publishing through link() fails if another process creates the target.
            os.link(temporary, output)
        return len(selected)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input_pdf', type=Path)
    parser.add_argument('mark_image', type=Path)
    parser.add_argument('output_pdf', type=Path)
    parser.add_argument('--pages', choices=('first', 'all'), default='first')
    for name, default in [('x',36), ('y',72), ('width',120), ('height',48)]:
        parser.add_argument('--' + name, type=float, default=default, help='PDF points')
    parser.add_argument('--overwrite', action='store_true')
    args = parser.parse_args(argv)
    try:
        count = add_watermark(**vars(args))
    except (ValueError, OSError, RuntimeError) as exc:
        parser.exit(1, f'Error: {exc}\n')
    print(f'Created {args.output_pdf.name}; marked {count} page(s).')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
