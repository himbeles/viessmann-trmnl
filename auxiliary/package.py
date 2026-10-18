"""Package the flat TRMNL plugin archive, including its Serverless transform."""
import argparse
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'src'
FILES = ['settings.yml', 'full.liquid', 'half_horizontal.liquid', 'half_vertical.liquid', 'quadrant.liquid', 'transform.js']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'auxiliary/output/viessmann-trmnl-import.zip')
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        if not (SOURCE / name).is_file():
            parser.error(f'Missing plugin file: {name}')
        if name.endswith('.liquid') and (SOURCE / name).stat().st_size > 1_000_000:
            parser.error(f'Template exceeds the 1 MB limit: {name}')
    with ZipFile(args.output, 'w', ZIP_DEFLATED) as archive:
        for name in FILES:
            archive.write(SOURCE / name, name)
    with ZipFile(args.output) as archive:
        assert archive.namelist() == FILES
        assert archive.testzip() is None
    print(f'Created and verified {args.output}')


if __name__ == '__main__':
    main()
