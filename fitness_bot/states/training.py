from aiogram.fsm.state import StatesGroup, State

class TrainingStates(StatesGroup):
    type = State()
    exercise = State()
    sets = State()
    finish = State()
