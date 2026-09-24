"""Release-package tests use real temporary Git object databases and archives."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
import zipfile


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("build_release", ROOT / "scripts/install/build_release.py")
BUILDER = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(BUILDER)
MANIFEST_SPEC = importlib.util.spec_from_file_location("install_manifest", ROOT / "scripts/install/manifest.py")
MANIFEST = importlib.util.module_from_spec(MANIFEST_SPEC)
assert MANIFEST_SPEC.loader is not None
MANIFEST_SPEC.loader.exec_module(MANIFEST)


class RepositoryFixture:
    def __init__(self, directory: Path):
        self.root = directory
        self.root.mkdir(parents=True)
        self.git("init", "-q")
        self.git("config", "user.name", "Release package test")
        self.git("config", "user.email", "release-test@example.invalid")
        self.write("package.json", '{"name":"fixture","version":"1.2.3"}\n')
        self.write("projects/registry.tsv", "name\tpath\tlifecycle\nExample\tprojects/example\tbundled\n")
        self.write("README.md", "committed content\n")
        self.write("docs/中文.md", "公开文档\n")
        for required in BUILDER.REQUIRED_PAYLOAD_PATHS:
            if not (self.root / required).exists():
                self.write(required, f"fixture for {required}\n")
        self.write("setup.sh", "#!/usr/bin/env bash\nset -eu\n")
        self.git("add", "--all")
        self.git("update-index", "--chmod=+x", "setup.sh")
        self.commit = self.save(stage=False)

    def git(self, *args: str, env: dict[str, str] | None = None, input_bytes: bytes | None = None) -> str:
        result = subprocess.run(
            ["git", "-C", str(self.root), *args], input=input_bytes,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, check=True,
        )
        return result.stdout.decode("utf-8").strip()

    def write(self, relative: str, content: str) -> None:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8", newline="\n")

    def save(self, stage: bool = True) -> str:
        if stage:
            self.git("add", "--all")
        env = dict(os.environ, GIT_AUTHOR_DATE="1700000000 +0000", GIT_COMMITTER_DATE="1700000000 +0000")
        self.git("commit", "-qm", "fixture", env=env)
        return self.git("rev-parse", "HEAD")

    def add_index_entry(self, mode: str, path: str, content: bytes = b"target") -> None:
        object_id = self.git("hash-object", "-w", "--stdin", input_bytes=content)
        self.git("update-index", "--add", "--cacheinfo", f"{mode},{object_id},{path}")


class ReleasePackageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.repo = RepositoryFixture(self.base / "repo")

    def build(self, name: str, ref: str | None = None) -> tuple[Path, dict[str, object]]:
        output = self.base / name
        manifest = BUILDER.build(self.repo.root, ref or self.repo.commit, output)
        return output, manifest

    def test_builds_reproducible_assets_from_commit_and_outer_hashes_match(self):
        first, first_manifest = self.build("first")
        self.repo.write("README.md", "dirty working tree must not be packaged\n")
        self.repo.write("local-secret.txt", "untracked\n")
        second, second_manifest = self.build("second", "HEAD")
        retry_manifest = BUILDER.build(self.repo.root, self.repo.commit, first)

        self.assertEqual(first_manifest, second_manifest)
        self.assertEqual(first_manifest, retry_manifest)
        self.assertFalse(any(path.name.startswith(".") for path in first.iterdir()))
        self.assertEqual(json.loads((first / "release-manifest.json").read_text(encoding="utf-8")), first_manifest)
        self.assertEqual(first_manifest["source_commit"], self.repo.commit)
        for asset in first_manifest["assets"]:
            first_bytes = (first / asset["name"]).read_bytes()
            second_bytes = (second / asset["name"]).read_bytes()
            self.assertEqual(first_bytes, second_bytes)
            self.assertEqual(hashlib.sha256(first_bytes).hexdigest(), asset["sha256"])
            self.assertEqual(len(first_bytes), asset["size"])
        self.assertEqual((first / "release-manifest.json").read_bytes(), (second / "release-manifest.json").read_bytes())
        self.assertEqual((first / "SHA256SUMS.txt").read_bytes(), (second / "SHA256SUMS.txt").read_bytes())
        sums = (first / "SHA256SUMS.txt").read_text(encoding="ascii").splitlines()
        self.assertEqual(sums, [f"{item['sha256']}  {item['name']}" for item in first_manifest["assets"]])

    def test_archives_have_one_safe_root_complete_manifest_and_expected_modes(self):
        output, outer = self.build("assets")
        root = "Auto-Company-v1.2.3"
        expected_source = set(self.repo.git("-c", "core.quotepath=false", "ls-files").splitlines())
        for asset in outer["assets"]:
            archive_path = output / asset["name"]
            if asset["platform"] == "windows":
                with zipfile.ZipFile(archive_path) as archive:
                    members = archive.infolist()
                    names = [member.filename for member in members]
                    contents = {member.filename: archive.read(member) for member in members}
                    modes = {member.filename: (member.external_attr >> 16) & 0o777 for member in members}
                    expected_time = time.gmtime(1700000000)[:6]
                    self.assertTrue(all(member.date_time == expected_time for member in members))
            else:
                with tarfile.open(archive_path, "r:gz") as archive:
                    members = archive.getmembers()
                    names = [member.name for member in members]
                    self.assertTrue(all(member.isfile() for member in members))
                    contents = {member.name: archive.extractfile(member).read() for member in members}
                    modes = {member.name: member.mode for member in members}
                    self.assertTrue(all(member.mtime == 1700000000 for member in members))

            self.assertEqual(names, sorted(names, key=lambda name: name.encode("utf-8")))
            self.assertTrue(all(PurePosixPath(name).parts[0] == root for name in names))
            self.assertFalse(any(".." in PurePosixPath(name).parts or name.startswith("/") for name in names))
            self.assertFalse(any("/.git/" in f"/{name}/" for name in names))
            self.assertNotIn(f"{root}/local-secret.txt", names)
            release_files = json.loads(contents[f"{root}/release-files.json"])
            self.assertEqual(release_files["schema"], 1)
            self.assertEqual(release_files["version"], "1.2.3")
            self.assertEqual(release_files["source_commit"], self.repo.commit)
            self.assertEqual(release_files["registry_baseline"], "name\tpath\tlifecycle\nExample\tprojects/example\tbundled\n")
            self.assertEqual({item["path"] for item in release_files["files"]}, expected_source)
            self.assertNotIn("release-files.json", {item["path"] for item in release_files["files"]})
            for item in release_files["files"]:
                packaged = contents[f"{root}/{item['path']}"]
                self.assertEqual(hashlib.sha256(packaged).hexdigest(), item["sha256"])
            self.assertEqual(modes[f"{root}/setup.sh"], 0o755)
            self.assertEqual(modes[f"{root}/README.md"], 0o644)

    def test_archives_extract_without_links_or_path_escape(self):
        output, outer = self.build("extract")
        for asset in outer["assets"]:
            destination = self.base / f"unpacked-{asset['platform']}"
            destination.mkdir()
            archive_path = output / asset["name"]
            if asset["platform"] == "windows":
                with zipfile.ZipFile(archive_path) as archive:
                    archive.extractall(destination)
            else:
                with tarfile.open(archive_path, "r:gz") as archive:
                    archive.extractall(destination)
            payload = destination / "Auto-Company-v1.2.3"
            self.assertEqual((payload / "README.md").read_text(encoding="utf-8"), "committed content\n")
            self.assertFalse((payload / ".git").exists())
            self.assertTrue(all(not path.is_symlink() for path in payload.rglob("*")))
            verified = MANIFEST.verify_payload(payload)
            self.assertEqual(verified["source_commit"], self.repo.commit)

    def test_rejects_symlinks_gitlinks_and_tracked_private_state(self):
        cases = (
            ("120000", "linked-file"),
            ("100644", ".auto-company/install.json"),
            ("100644", ".env"),
            ("100644", "logs/session.log"),
            ("100644", ".auto-loop-state"),
            ("100644", "memories/consensus.md"),
            ("100644", "AGENTS.md"),
        )
        for index, (mode, path) in enumerate(cases):
            with self.subTest(path=path):
                repo_dir = self.base / f"unsafe-{index}"
                fixture = RepositoryFixture(repo_dir)
                fixture.add_index_entry(mode, path)
                commit = fixture.save(stage=False)
                with self.assertRaises(BUILDER.BuildError):
                    BUILDER.build(repo_dir, commit, self.base / f"unsafe-output-{index}")

        gitlink = RepositoryFixture(self.base / "gitlink")
        gitlink.git("update-index", "--add", "--cacheinfo", f"160000,{gitlink.commit},vendor/repo")
        gitlink_commit = gitlink.save(stage=False)
        with self.assertRaises(BUILDER.BuildError):
            BUILDER.build(gitlink.root, gitlink_commit, self.base / "gitlink-output")

    def test_rejects_case_collisions_and_refuses_different_existing_outputs(self):
        self.repo.add_index_entry("100644", "readme.md", b"collision\n")
        collision_commit = self.repo.save(stage=False)
        with self.assertRaises(BUILDER.BuildError):
            BUILDER.build(self.repo.root, collision_commit, self.base / "collision")

        output, _ = self.build("existing")
        asset = output / "Auto-Company-v1.2.3-windows.zip"
        asset.write_bytes(b"different")
        with self.assertRaises(BUILDER.BuildError):
            BUILDER.build(self.repo.root, self.repo.commit, output)

    def test_portable_path_validation_rejects_traversal_and_windows_ambiguity(self):
        for path in ("../escape", "/absolute", "folder\\file", "con.txt", "CON .txt", "trailing. ", "colon:name"):
            with self.subTest(path=path), self.assertRaises(BUILDER.BuildError):
                BUILDER.validate_path(path)

    def test_rejects_commit_missing_guided_installer_files(self):
        self.repo.git("rm", "LICENSE")
        commit = self.repo.save(stage=False)
        with self.assertRaisesRegex(BUILDER.BuildError, "missing required installer files"):
            BUILDER.build(self.repo.root, commit, self.base / "missing-installer")

    def test_cli_fails_for_non_commit_and_does_not_create_assets(self):
        output = self.base / "bad-ref-output"
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts/install/build_release.py"), "--repo", str(self.repo.root), "--ref", "missing-ref", "--output", str(output)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False,
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("release build failed", result.stderr)
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
