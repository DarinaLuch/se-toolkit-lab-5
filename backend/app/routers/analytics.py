"""Router for analytics endpoints.

Each endpoint performs SQL aggregation queries on the interaction data
populated by the ETL pipeline. All endpoints require a `lab` query
parameter to filter results by lab (e.g., "lab-01").
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.database import get_session
from app.models.item import ItemRecord
from app.models.interaction import InteractionLog
from app.models.learner import Learner

router = APIRouter()


async def _get_lab_and_task_ids(lab: str, session: AsyncSession):
    """Helper to find lab record and its task IDs.
    
    Returns (lab_id, task_ids) or (None, []) if lab not found.
    """
    # Convert "lab-04" → "Lab 04" for title matching
    lab_title_pattern = f"%Lab {lab.split('-')[1]}%"

    # Find the lab item id - use scalars() to get plain values
    lab_stmt = select(ItemRecord.id).where(
        ItemRecord.type == "lab",
        ItemRecord.title.ilike(lab_title_pattern),
    )
    lab_result = await session.exec(lab_stmt)
    lab_id_row = lab_result.first()
    
    # Extract the actual id value from the row
    lab_id = lab_id_row[0] if lab_id_row else None

    if lab_id is None:
        return None, []

    # Find all tasks under this lab
    tasks_stmt = select(ItemRecord.id).where(
        ItemRecord.type == "task",
        ItemRecord.parent_id == lab_id,
    )
    tasks_result = await session.exec(tasks_stmt)
    # Extract ids from rows
    task_ids = [row[0] for row in tasks_result.all()]

    return lab_id, task_ids


@router.get("/scores")
async def get_scores(
    lab: str = Query(..., description="Lab identifier, e.g. 'lab-01'"),
    session: AsyncSession = Depends(get_session),
):
    """Score distribution histogram for a given lab."""
    lab_id, task_ids = await _get_lab_and_task_ids(lab, session)

    if not task_ids:
        return [
            {"bucket": "0-25", "count": 0},
            {"bucket": "26-50", "count": 0},
            {"bucket": "51-75", "count": 0},
            {"bucket": "76-100", "count": 0},
        ]

    # Build CASE WHEN for score buckets
    bucket_case = case(
        (InteractionLog.score <= 25, "0-25"),
        (InteractionLog.score <= 50, "26-50"),
        (InteractionLog.score <= 75, "51-75"),
        (InteractionLog.score <= 100, "76-100"),
        else_="0-25",
    ).label("bucket")

    # Query interactions with score, grouped by bucket
    stmt = (
        select(bucket_case, func.count(InteractionLog.id).label("count"))
        .where(
            InteractionLog.item_id.in_(task_ids),
            InteractionLog.score.isnot(None),
        )
        .group_by(bucket_case)
    )

    result = await session.exec(stmt)
    rows = result.all()

    # Build result dict from query
    bucket_counts = {row.bucket: row.count for row in rows}

    # Always return all four buckets
    return [
        {"bucket": "0-25", "count": bucket_counts.get("0-25", 0)},
        {"bucket": "26-50", "count": bucket_counts.get("26-50", 0)},
        {"bucket": "51-75", "count": bucket_counts.get("51-75", 0)},
        {"bucket": "76-100", "count": bucket_counts.get("76-100", 0)},
    ]


@router.get("/pass-rates")
async def get_pass_rates(
    lab: str = Query(..., description="Lab identifier, e.g. 'lab-01'"),
    session: AsyncSession = Depends(get_session),
):
    """Per-task pass rates for a given lab."""
    lab_id, task_ids = await _get_lab_and_task_ids(lab, session)

    if not task_ids:
        return []

    # Find all tasks under this lab with their stats
    stmt = (
        select(
            ItemRecord.title.label("task"),
            func.round(func.avg(InteractionLog.score), 1).label("avg_score"),
            func.count(InteractionLog.id).label("attempts"),
        )
        .join(
            InteractionLog,
            InteractionLog.item_id == ItemRecord.id,
        )
        .where(ItemRecord.id.in_(task_ids))
        .group_by(ItemRecord.id, ItemRecord.title)
        .order_by(ItemRecord.title)
    )

    result = await session.exec(stmt)
    rows = result.all()

    return [
        {"task": row.task, "avg_score": float(row.avg_score) if row.avg_score else 0.0, "attempts": row.attempts}
        for row in rows
    ]


@router.get("/timeline")
async def get_timeline(
    lab: str = Query(..., description="Lab identifier, e.g. 'lab-01'"),
    session: AsyncSession = Depends(get_session),
):
    """Submissions per day for a given lab."""
    lab_id, task_ids = await _get_lab_and_task_ids(lab, session)

    if not task_ids:
        return []

    # Group interactions by date
    stmt = (
        select(
            func.date(InteractionLog.created_at).label("date"),
            func.count(InteractionLog.id).label("submissions"),
        )
        .where(InteractionLog.item_id.in_(task_ids))
        .group_by(func.date(InteractionLog.created_at))
        .order_by(func.date(InteractionLog.created_at))
    )

    result = await session.exec(stmt)
    rows = result.all()

    return [
        {"date": str(row.date), "submissions": row.submissions}
        for row in rows
    ]


@router.get("/groups")
async def get_groups(
    lab: str = Query(..., description="Lab identifier, e.g. 'lab-01'"),
    session: AsyncSession = Depends(get_session),
):
    """Per-group performance for a given lab."""
    lab_id, task_ids = await _get_lab_and_task_ids(lab, session)

    if not task_ids:
        return []

    # Join interactions with learners, group by student_group
    stmt = (
        select(
            Learner.student_group.label("group"),
            func.round(func.avg(InteractionLog.score), 1).label("avg_score"),
            func.count(func.distinct(Learner.id)).label("students"),
        )
        .join(
            InteractionLog,
            InteractionLog.learner_id == Learner.id,
        )
        .where(InteractionLog.item_id.in_(task_ids))
        .group_by(Learner.student_group)
        .order_by(Learner.student_group)
    )

    result = await session.exec(stmt)
    rows = result.all()

    return [
        {"group": row.group, "avg_score": float(row.avg_score) if row.avg_score else 0.0, "students": row.students}
        for row in rows
    ]
