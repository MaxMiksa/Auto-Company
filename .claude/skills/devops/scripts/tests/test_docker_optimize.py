"""
Tests for docker-optimize.py

Run with: pytest test_docker_optimize.py -v
"""

import pytest
import json
from pathlib import Path
import sys

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from docker_optimize import DockerfileAnalyzer


@pytest.fixture
def temp_dockerfile(tmp_path):
    """Create temporary Dockerfile"""
    dockerfile = tmp_path / "Dockerfile"
    return dockerfile


def write_dockerfile(filepath, content):
    """Helper to write Dockerfile content"""
    with open(filepath, 'w') as f:
        f.write(content)


class TestDockerfileAnalyzerInit:
    """Test DockerfileAnalyzer initialization"""

    def test_init(self, temp_dockerfile):
        write_dockerfile(temp_dockerfile, "FROM node:20\n")
        analyzer = DockerfileAnalyzer(temp_dockerfile)

        assert analyzer.dockerfile_path == temp_dockerfile
        assert analyzer.verbose is False
        assert analyzer.lines == []
        assert analyzer.issues == []
        assert analyzer.suggestions == []


class TestLoadDockerfile:
    """Test Dockerfile loading"""

    def test_load_success(self, temp_dockerfile):
        content = "FROM node:20\nWORKDIR /app\n"
        write_dockerfile(temp_dockerfile, content)

        analyzer = DockerfileAnalyzer(temp_dockerfile)
        result = analyzer.load_dockerfile()

        assert result is True
        assert len(analyzer.lines) == 2

    def test_load_nonexistent(self, tmp_path):
        analyzer = DockerfileAnalyzer(tmp_path / "nonexistent")

        with pytest.raises(FileNotFoundError):
            analyzer.load_dockerfile()


class TestAnalyzeBaseImage:
    """Test base image analysis"""

    def test_latest_tag(self, temp_dockerfile):
        write_dockerfile(temp_dockerfile, "FROM node:latest\n")
        analyzer = DockerfileAnalyzer(temp_dockerfile)
        analyzer.load_dockerfile()
        analyzer.analyze_base_image()

        assert len(analyzer.issues) == 1
        assert analyzer.issues[0]['category'] == 'base_image'
        assert 'latest' in analyzer.issues[0]['message']

    def test_no_tag(self, temp_dockerfile):
        write_dockerfile(temp_dockerfile, "FROM node\n")
        analyzer = DockerfileAnalyzer(temp_dockerfile)
        analyzer.load_dockerfile()
        analyzer.analyze_base_image()

        assert len(analyzer.issues) == 1
        assert 'no tag' in analyzer.issues[0]['message']

    def test_specific_tag(self, temp_dockerfile):
        write_dockerfile(temp_dockerfile, "FROM node:20-alpine\n")
        analyzer = DockerfileAnalyzer(temp_dockerfile)
        analyzer.load_dockerfile()
        analyzer.analyze_base_image()

        # Should have no issues with specific tag
        base_image_issues = [i for i in analyzer.issues if i['category'] == 'base_image']
        assert len(base_image_issues) == 0

    def test_non_alpine_suggestion(self, temp_dockerfile):
        write_dockerfile(temp_dockerfile, "FROM node:20\n")
        analyzer = DockerfileAnalyzer(temp_dockerfile)
        analyzer.load_dockerfile()
        analyzer.analyze_base_image()

        assert len(analyzer.suggestions) >= 1
        assert any('Alpine' in s['message'] for s in analyzer.suggestions)


class TestAnalyzeMultiStage:
    """Test multi-stage build analysis"""

    def test_single_stage_with_build_tools(self, temp_dockerfile):
        content = """
FROM node:20
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
CMD ["node", "server.js"]
"""
        write_dockerfile(temp_dockerfile, content)
        analyzer = DockerfileAnalyzer(temp_dockerfile)
        analyzer.load_dockerfile()
        analyzer.analyze_multi_stage()

        assert len(analyzer.issues) == 1
        assert analyzer.issues[0]['category'] == 'optimization'
        assert 'multi-stage' in analyzer.issues[0]['message'].lower()

    def test_multi_stage_no_issues(self, temp_dockerfile):
        content = """
FROM node:20 AS build
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
CMD ["node", "dist/server.js"]
"""
        write_dockerfile(temp_dockerfile, content)
        analyzer = DockerfileAnalyzer(temp_dockerfile)
        analyzer.load_dockerfile()
        analyzer.analyze_multi_stage()

