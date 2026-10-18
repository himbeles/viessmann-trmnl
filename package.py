from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import shutil

root = Path(__file__).resolve().parent
output = Path('/workspace/shared/downloads')
output.mkdir(parents=True, exist_ok=True)
with ZipFile(output / 'viessmann-trmnl-import.zip', 'w', ZIP_DEFLATED) as archive:
    archive.write(root / 'src/settings.yml', 'settings.yml')
    for name in ['full', 'half_horizontal', 'half_vertical', 'quadrant']:
        archive.write(root / f'dist/{name}.liquid', f'{name}.liquid')
with ZipFile(output / 'viessmann-trmnl-source.zip', 'w', ZIP_DEFLATED) as archive:
    for name in ['README.md', 'inspect_api.py', 'package.py', 'package.json', 'package-lock.json', 'build.mjs']:
        archive.write(root / name, name)
    for directory in ['src', 'tests', 'dist']:
        for path in (root / directory).rglob('*'):
            if path.is_file():
                archive.write(path, str(path.relative_to(root)))
for source, name in [('dist/preview.html', 'viessmann-preview.html'), ('README.md', 'viessmann-setup.md')]:
    shutil.copyfile(root / source, output / name)
print('Import, source, preview and setup guide packaged in', output)
