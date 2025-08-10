from aiogram.fsm.state import StatesGroup, State

class HealthStates(StatesGroup):
    chronic = State()
    injuries = State()
    cardio = State()
    musculoskeletal = State()
