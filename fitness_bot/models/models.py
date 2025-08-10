from pydantic import BaseModel
from typing import Optional

class User(BaseModel):
    telegram_id: int
    name: Optional[str]
    gender: Optional[str]
    birth_date: Optional[str]
    height: Optional[int]
    weight: Optional[int]

class Measurement(BaseModel):
    user_id: int
    date: str
    chest: Optional[float]
    waist: Optional[float]
    hips: Optional[float]
    left_arm: Optional[float]
    right_arm: Optional[float]
    left_leg: Optional[float]
    right_leg: Optional[float]
    shoulders: Optional[float]
