from aiogram.fsm.state import StatesGroup, State

class DocumentStates(StatesGroup):
    waiting_file = State()
    waiting_type = State()
