from aiogram.fsm.state import StatesGroup, State

class RegistrationStates(StatesGroup):
    name = State()
    gender = State()
    birth_date = State()
    height_weight = State()
    measurements = State()
    health = State()
    pdn_consent = State()
