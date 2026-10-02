#!/bin/bash
set -euo pipefail

# Provision only an ephemeral hosted CI runner. Runtime startup never changes
# host security policy and never falls back to unisolated execution.
if [ "${GITHUB_ACTIONS:-}" != "true" ]; then
    echo "This dependency setup is for GitHub Actions runners only." >&2
    exit 1
fi

sudo apt-get update
sudo apt-get install -y bubblewrap libseccomp2 apparmor-profiles apparmor-utils
if ! python3 scripts/core/project_isolation.py --check; then
    # Ubuntu 24.04 ships this narrow userns allowance as an extra profile.
    # Do not disable AppArmor or its system-wide user namespace restriction.
    profile=/etc/apparmor.d/bwrap-userns-restrict
    if [ ! -f "$profile" ]; then
        sudo install -m 0644 /usr/share/apparmor/extra-profiles/bwrap-userns-restrict "$profile"
    fi
    sudo apparmor_parser -r "$profile"
fi
python3 scripts/ci/run.py isolation-preflight python3 scripts/core/project_isolation.py --check
