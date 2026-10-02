"""Run worker contracts in real namespaces containing synthetic test data only.

The worker's PID/port collision tests belong inside one namespace. Host-to-worker
isolation is tested separately by test_isolated_media.py, through capture_product.
"""
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/core'))
from project_isolation import run_isolated


def main():
    with tempfile.TemporaryDirectory(prefix='isolated-media-contracts-') as folder:
        workspace = Path(folder)
        sources = [path for path in (ROOT / 'scripts/core').iterdir()
                   if path.suffix in ('.py', '.json', '.cjs', '.sh')]
        sources += [ROOT / 'tests/test_product_media.py', ROOT / 'tests/browser/media-reference-probe.cjs',
                    ROOT / 'scripts/media/package.json']
        for source in sources:
            target = workspace / source.relative_to(ROOT)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        readonly = [(ROOT / 'scripts/media/node_modules', '/workspace/scripts/media/node_modules')]
        browsers = Path(os.environ['AUTO_COMPANY_BROWSER_RUNTIME'])
        for child in browsers.iterdir():
            if child.is_dir() and re.fullmatch(r'(?:chromium|chromium_headless_shell|ffmpeg)-[0-9]+', child.name):
                readonly.append((child, '/opt/browsers/' + child.name))
        return run_isolated(['/usr/bin/python3', '-m', 'unittest', 'discover', '-s', 'tests',
                             '-p', 'test_product_media.py', '-v'], workspace, readonly=readonly,
                            environment={'AUTO_COMPANY_TEST_PRODUCT_MEDIA_BROWSER': '1',
                                         'PLAYWRIGHT_BROWSERS_PATH': '/opt/browsers'})


if __name__ == '__main__':
    sys.exit(main())
