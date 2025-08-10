from aiogram import Router, types
from aiogram.fsm.context import FSMContext
from states.registration import RegistrationStates
from aiogram.filters import StateFilter
from database import get_connection

router = Router()

@router.message(StateFilter(RegistrationStates.name))
async def get_name(message: types.Message, state: FSMContext):
    await state.update_data(name=message.text)
    await message.answer("Укажите ваш пол (М/Ж):")
    await state.set_state(RegistrationStates.gender)

@router.message(StateFilter(RegistrationStates.gender))
async def get_gender(message: types.Message, state: FSMContext):
    await state.update_data(gender=message.text)
    await message.answer("Введите дату рождения (ДД.ММ.ГГГГ):")
    await state.set_state(RegistrationStates.birth_date)

@router.message(StateFilter(RegistrationStates.birth_date))
async def get_birth_date(message: types.Message, state: FSMContext):
    await state.update_data(birth_date=message.text)
    await message.answer("Введите ваш рост и вес (например: 175 70):")
    await state.set_state(RegistrationStates.height_weight)

@router.message(StateFilter(RegistrationStates.height_weight))
async def get_height_weight(message: types.Message, state: FSMContext):
    try:
        height, weight = map(int, message.text.split())
    except:
        await message.answer("Пожалуйста, введите два числа через пробел (например: 175 70)")
        return
    await state.update_data(height=height, weight=weight)

    # Сохраняем пользователя
    data = await state.get_data()
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO users (telegram_id, name, gender, birth_date, height, weight)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (
        message.from_user.id,
        data.get("name"),
        data.get("gender"),
        data.get("birth_date"),
        data.get("height"),
        data.get("weight")
    ))
    conn.commit()
    conn.close()

    await message.answer("Регистрация завершена. Добро пожаловать!")
    from keyboards.client import main_menu_kb
    await message.answer("Выберите действие:", reply_markup=main_menu_kb())
    await state.clear()
