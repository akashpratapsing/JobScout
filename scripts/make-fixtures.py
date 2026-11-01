#!/usr/bin/env python3
"""Generate the sample resumes used by the automated tests.

Run with: npm run fixtures
Requires: pip install reportlab python-docx
"""

from pathlib import Path

from docx import Document
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "test" / "fixtures"

RESUME_LINES = [
    ("name", "Aarav Sharma"),
    ("contact", "Bengaluru, India | aarav.sharma@example.com | +91 98765 43210"),
    ("links", "linkedin.com/in/aaravsharma | github.com/aaravsharma"),
    ("heading", "Summary"),
    ("body", "Backend engineer with 5 years of experience building Python and Node.js services. "
             "Comfortable with PostgreSQL, Redis, AWS, Docker, Kubernetes, and CI/CD."),
    ("heading", "Skills"),
    ("body", "Python, JavaScript, TypeScript, Node.js, Express, FastAPI, PostgreSQL, Redis, "
             "AWS, Docker, Kubernetes, Terraform, REST APIs, GraphQL, Git, Linux"),
    ("heading", "Experience"),
    ("body", "Senior Backend Engineer | Nimbus Labs | Jan 2022 - Present"),
    ("bullet", "Designed event-driven services handling 4M requests per day using Python, FastAPI, Kafka, and Redis."),
    ("bullet", "Cut p95 latency by 38% by adding PostgreSQL indexes and a read-through cache."),
    ("bullet", "Led migration of 24 services to Kubernetes on AWS with Terraform and GitHub Actions."),
    ("body", "Backend Engineer | Riverstone Technologies | Jun 2019 - Dec 2021"),
    ("bullet", "Built REST APIs in Node.js and Express for a payments product used by 120,000 customers."),
    ("bullet", "Introduced integration tests and CI checks that reduced production rollbacks by half."),
    ("heading", "Projects"),
    ("body", "JobScout - Local job discovery assistant"),
    ("bullet", "Node.js service that normalizes public job feeds, deduplicates listings, and scores fit against a resume."),
    ("body", "LogPilot - Log search and alerting tool"),
    ("bullet", "Python and Elasticsearch pipeline for searching application logs with sub-second queries."),
    ("heading", "Education"),
    ("body", "B.Tech in Computer Science | National Institute of Technology, Surathkal | 2019"),
    ("heading", "Certifications"),
    ("bullet", "AWS Certified Solutions Architect - Associate"),
    ("bullet", "Certified Kubernetes Administrator (CKA)"),
]


def add_docx(path: Path) -> None:
    document = Document()
    for kind, text in RESUME_LINES:
        if kind == "name":
            document.add_heading(text, level=0)
        elif kind == "heading":
            document.add_heading(text, level=1)
        elif kind == "bullet":
            document.add_paragraph(text, style="List Bullet")
        else:
            document.add_paragraph(text)
    document.save(path)


def add_pdf(path: Path) -> None:
    styles = getSampleStyleSheet()
    story = []
    for kind, text in RESUME_LINES:
        if kind == "name":
            story.append(Paragraph(f"<b>{text}</b>", styles["Title"]))
            story.append(Spacer(1, 4 * mm))
        elif kind == "heading":
            story.append(Spacer(1, 2 * mm))
            story.append(Paragraph(f"<b>{text}</b>", styles["Heading2"]))
        elif kind == "bullet":
            story.append(Paragraph(f"&bull; {text}", styles["BodyText"]))
        else:
            story.append(Paragraph(text, styles["BodyText"]))
    document = SimpleDocTemplate(
        str(path),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title="Aarav Sharma - Resume",
        author="Aarav Sharma",
    )
    document.build(story)


def main() -> None:
    FIXTURES.mkdir(parents=True, exist_ok=True)
    add_docx(FIXTURES / "sample-resume.docx")
    add_pdf(FIXTURES / "sample-resume.pdf")
    print(f"Wrote fixtures to {FIXTURES}")


if __name__ == "__main__":
    main()
