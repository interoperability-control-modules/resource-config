from fastapi import APIRouter, Depends, Request

from ..auth import Session, current_session

router = APIRouter(tags=['catalog'])


@router.get('/catalog')
async def catalog(request: Request, session: Session = Depends(current_session)):
    return request.app.state.catalog
