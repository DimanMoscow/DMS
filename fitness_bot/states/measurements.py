from aiogram.fsm.state import StatesGroup, State

class MeasurementStates(StatesGroup):
    chest = State()
    waist = State()
    hips = State()
    left_arm = State()
    right_arm = State()
    left_leg = State()
    right_leg = State()
    shoulders = State()
