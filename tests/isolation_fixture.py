"""Boundary doubles for orchestration contracts, never runtime configuration.

Budget/governance fixtures deliberately act as a host-side test coordinator.
Only disposable copies under the OS temp directory receive these replacements.
The actual command builder, metadata parser and supervisor remain in use.
test_project_isolation separately exercises real namespaces without doubles.
"""
from pathlib import Path
import shutil
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
MARKER = '# Disposable orchestration test boundary double.\n'


def install(root):
    root = Path(root).resolve()
    root.relative_to(Path(tempfile.gettempdir()).resolve())
    if root == ROOT or ROOT in root.parents:
        raise ValueError('Boundary doubles are forbidden in the source checkout')
    core = root / 'scripts/core'
    core.mkdir(parents=True, exist_ok=True)
    for name in ('project_isolation.py', 'isolation_workspace.py', 'isolation_proxy.py',
                 'isolation-runtime-files.json', 'product_identity.py'):
        target = core / name
        if not target.exists():
            shutil.copy2(ROOT / 'scripts/core' / name, target)
    for name in ('project_isolation', 'isolation_workspace'):
        path = core / (name + '.py')
        if not path.read_text().startswith(MARKER):
            shutil.copy2(path, core / ('_fixture_real_' + name + '.py'))
    (core / 'project_isolation.py').write_text(MARKER + '''
from _fixture_real_project_isolation import *
def runtime_binary():
    return 'disposable-orchestration-double'
def inside_boundary():
    return True
if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--git-status':
        raise SystemExit(subprocess.run(['git', '-C', sys.argv[2], 'status', '--porcelain']).returncode)
    raise SystemExit(0)
''')
    (core / 'isolation_workspace.py').write_text(MARKER + '''
import os
from pathlib import Path
import subprocess
import tempfile
import _fixture_real_isolation_workspace as actual

class FixtureView:
    def __init__(self, root, project, cycle):
        self.workspace = Path(root)
        self.folder = Path(tempfile.mkdtemp(prefix='orchestration-fixture-'))
        self.home = self.folder / 'home'
        self.home.mkdir()
        self.store = self.folder
        self.active_record = self.folder / 'active.json'
        self.retain_view = False
        self.consensus_before = None
        self.collected = False
    def prepare(self):
        (self.workspace / 'logs').mkdir(exist_ok=True)
    def authentication(self, engine):
        pass
    def collect(self):
        self.collected = True

def fixture_execute(command, workspace, *, environment=None, engine=None, home=None, **kwargs):
    def mapped(value):
        return str(value).replace('/workspace', str(workspace)).replace('/home/agent', str(home))
    arguments = [str(engine) if value == '/opt/engine/agent' else mapped(value) for value in command]
    environment = dict(os.environ, **{key: mapped(value) for key, value in (environment or {}).items()})
    return subprocess.run(arguments, cwd=workspace, env=environment).returncode

actual.CompanyView = FixtureView
actual.run_isolated = fixture_execute
actual.runtime_binary = lambda: 'disposable-orchestration-double'
run_engine = actual.run_engine
copy_tree = actual.copy_tree
regular_bytes = actual.regular_bytes
if __name__ == '__main__':
    raise SystemExit(actual.main())
''')


if __name__ == '__main__':
    install(sys.argv[1])
