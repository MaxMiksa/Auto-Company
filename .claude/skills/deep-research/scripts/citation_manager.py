#!/usr/bin/env python3
"""
Citation Management System
Tracks sources, generates citations, and maintains bibliography
"""

from dataclasses import dataclass, field
from typing import List, Dict, Optional
from datetime import datetime
from urllib.parse import urlparse
import hashlib


@dataclass
class Citation:
    """Represents a single citation"""
    id: str
    title: str
    url: str
    authors: Optional[List[str]] = None
    publication_date: Optional[str] = None
    retrieved_date: str = field(default_factory=lambda: datetime.now().strftime('%Y-%m-%d'))
    source_type: str = "web"  # web, academic, documentation, book, paper
    doi: Optional[str] = None
    citation_count: int = 0

    def to_apa(self, index: int) -> str:
        """Generate APA format citation"""
        author_str = ""
        if self.authors:
            if len(self.authors) == 1:
                author_str = f"{self.authors[0]}."
            elif len(self.authors) == 2:
                author_str = f"{self.authors[0]} & {self.authors[1]}."
            else:
                author_str = f"{self.authors[0]} et al."

        date_str = f"({self.publication_date})" if self.publication_date else "(n.d.)"

        return f"[{index}] {author_str} {date_str}. {self.title}. Retrieved {self.retrieved_date}, from {self.url}"

    def to_inline(self, index: int) -> str:
        """Generate inline citation [index]"""
        return f"[{index}]"

    def to_markdown(self, index: int) -> str:
        """Generate markdown link format"""
        return f"[{index}] [{self.title}]({self.url}) (Retrieved: {self.retrieved_date})"


class CitationManager:
    """Manages citations and bibliography"""

    def __init__(self):
        self.citations: Dict[str, Citation] = {}
        self.citation_order: List[str] = []

    def add_source(
        self,
        url: str,
        title: str,
        authors: Optional[List[str]] = None,
        publication_date: Optional[str] = None,
        source_type: str = "web",
        doi: Optional[str] = None
    ) -> str:
        """Add a source and return its citation ID"""
        # Generate unique ID based on URL
        citation_id = hashlib.md5(url.encode()).hexdigest()[:8]

        if citation_id not in self.citations:
            citation = Citation(
                id=citation_id,
                title=title,
                url=url,
                authors=authors,
                publication_date=publication_date,
                source_type=source_type,
                doi=doi
            )
            self.citations[citation_id] = citation
            self.citation_order.append(citation_id)

        # Increment citation count
        self.citations[citation_id].citation_count += 1

        return citation_id

    def get_citation_number(self, citation_id: str) -> Optional[int]:
