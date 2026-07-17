from sqlalchemy import Column, Integer, String

from app.db.session import Base


class Site(Base):
    __tablename__ = "sites"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, unique=True)
    location = Column(String(255), default="")
    latitude = Column(String(50), default="")
    longitude = Column(String(50), default="")
