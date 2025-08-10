from aiogram import Router, types
from aiogram.fsm.context import FSMContext
from states.training import TrainingStates
from database import get_connection
from datetime import datetime

router = Router()

@router.message(lambda m: m.text == "🏋 Самостоятельная тренировка")
async def start_training(message: types.Message, state: FSMContext):
    await message.answer("Введите тип тренировки:")
    await state.set_state(TrainingStates.type)

@router.message(TrainingStates.type)
async def get_type(message: types.Message, state: FSMContext):
    await state.update_data(type=message.text)
    await message.answer("Введите список упражнений:")
    await state.set_state(TrainingStates.exercise)

@router.message(TrainingStates.exercise)
async def get_exercises(message: types.Message, state: FSMContext):
    await state.update_data(exercises=message.text)
    data = await state.get_data()

    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO trainings (user_id, date, type, protocol)
        VALUES (?, ?, ?, ?)
    """, (
        message.from_user.id,
        datetime.now().strftime("%Y-%m-%d"),
        data.get("type"),
        data.get("exercises")
    ))
    conn.commit()
    conn.close()

    await message.answer("Тренировка сохранена. Отличная работа!")
    await state.clear()
