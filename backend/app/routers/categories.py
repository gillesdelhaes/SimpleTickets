from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth.deps import get_current_user, require_admin
from app.database import get_session
from app.models import Category, User
from app.schemas.category import CategoryCreate, CategoryRead, CategoryUpdate

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("", response_model=list[CategoryRead])
async def list_categories(
    include_archived: bool = False,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[Category]:
    """List categories. Pass ?include_archived=true to include archived ones."""
    stmt = select(Category).order_by(Category.name)
    if not include_archived:
        stmt = stmt.where(Category.is_archived == False)  # noqa: E712
    result = await session.execute(stmt)
    return list(result.scalars().all())


@router.post("", response_model=CategoryRead, status_code=status.HTTP_201_CREATED)
async def create_category(
    body: CategoryCreate,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> Category:
    """Create a new category. Admin only."""
    # Check for duplicate name (case-insensitive)
    result = await session.execute(
        select(Category).where(Category.name == body.name)
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A category named '{body.name}' already exists",
        )

    category = Category(name=body.name)
    session.add(category)
    await session.commit()
    await session.refresh(category)
    return category


@router.patch("/{category_id}", response_model=CategoryRead)
async def update_category(
    category_id: int,
    body: CategoryUpdate,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> Category:
    """Rename or archive/unarchive a category. Admin only."""
    result = await session.execute(select(Category).where(Category.id == category_id))
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    if body.name is not None:
        # Check name collision
        dup = await session.execute(
            select(Category).where(Category.name == body.name, Category.id != category_id)
        )
        if dup.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"A category named '{body.name}' already exists",
            )
        category.name = body.name

    if body.is_archived is not None:
        category.is_archived = body.is_archived

    await session.commit()
    await session.refresh(category)
    return category


