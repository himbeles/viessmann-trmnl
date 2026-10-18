"""Package exactly the five files in TRMNL's official private-plugin ZIP format."""
import argparse
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent.parent
FILES = ['settings.yml', 'full.liquid', 'half_horizontal.liquid', 'half_vertical.liquid', 'quadrant.liquid']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'auxiliary/output/viessmann-trmnl-import.zip')
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        if not (ROOT / name).is_file():
            parser.error(f'Missing plugin file: {name}')
        if name.endswith('.liquid') and (ROOT / name).stat().st_size > 1_000_000:
            parser.error(f'Template exceeds the 1 MB limit: {name}')
    with ZipFile(args.output, 'w', ZIP_DEFLATED) as archive:
        for name in FILES:
            archive.write(ROOT / name, name)
    with ZipFile(args.output) as archive:
        assert archive.namelist() == FILES
        assert archive.testzip() is None
    print(f'Created and verified {args.output}')


if __name__ == '__main__':
    main()
