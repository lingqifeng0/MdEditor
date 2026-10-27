"""Package an electron-builder Windows directory with a stable product folder."""
from pathlib import Path
import argparse
import json
import os
import stat
import zipfile


def main():
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root / 'packages/desktop/package.json').read_text(encoding='utf-8'))
    product = manifest['productName']
    version = manifest['version']
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--program', type=Path, default=root / 'dist/win-unpacked')
    parser.add_argument('--output', type=Path, default=root / 'dist' / f'{product}-win-x64-{version}.zip')
    args = parser.parse_args()
    program = args.program.resolve(strict=True)
    if not (program / 'MdEditor.exe').is_file():
        raise RuntimeError('Build the Windows x64 application first; MdEditor.exe is missing.')
    if not product or any(character in product for character in '/\\:'):
        raise RuntimeError('The product name must be one directory component.')
    output = args.output.resolve()
    if output.is_relative_to(program):
        raise RuntimeError('The archive must be written outside the program directory.')
    output.parent.mkdir(parents=True, exist_ok=True)
    pending = output.with_name(output.name + '.pending')
    files = []
    for current, directories, names in os.walk(program, followlinks=False):
        directories[:] = [name for name in directories if name != 'marktext-user-data']
        for name in [*directories, *names]:
            item = Path(current) / name
            attributes = item.lstat()
            if item.is_symlink() or getattr(attributes, 'st_file_attributes', 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT:
                raise RuntimeError('Refusing a link or junction: ' + str(item))
        for name in names:
            file = Path(current) / name
            files.append((file, product + '/' + file.relative_to(program).as_posix()))
    directories = [product + '/', product + '/marktext-user-data/', product + '/marktext-user-data/plugins/', product + '/marktext-user-data/plugin-data/']
    with zipfile.ZipFile(pending, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for file, relative in sorted(files):
            archive.write(file, relative)
        for directory in directories:
            archive.mkdir(directory)
    with zipfile.ZipFile(pending) as archive:
        if archive.testzip() is not None:
            raise RuntimeError('Archive CRC verification failed.')
        for file, relative in files:
            if archive.read(relative) != file.read_bytes():
                raise RuntimeError('Archive contents differ: ' + relative)
    pending.replace(output)
    print(json.dumps({'archive': str(output), 'rootFolder': product, 'files': len(files), 'userDataIncluded': False}, ensure_ascii=False))


if __name__ == '__main__':
    main()
