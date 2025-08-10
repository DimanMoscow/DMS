from aiogram import Router, types
from aiogram.fsm.context import FSMContext
from aiogram.filters import StateFilter
from states.measurements import MeasurementStates
from database import get_connection
from datetime import datetime

router = Router()

@router.message(lambda m: m.text == "📏 Отправить замеры тела")
async def start_measurements(message: types.Message, state: FSMContext):
    await message.answer("Введите обхват груди (в см):")
    await state.set_state(MeasurementStates.chest)

@router.message(StateFilter(MeasurementStates.chest))
async def get_chest(message: types.Message, state: FSMContext):
    await state.update_data(chest=message.text)
    await message.answer("Талия:")
    await state.set_state(MeasurementStates.waist)

@router.message(StateFilter(MeasurementStates.waist))
async def get_waist(message: types.Message, state: FSMContext):
    await state.update_data(waist=message.text)
    await message.answer("Бёдра:")
    await state.set_state(MeasurementStates.hips)

@router.message(StateFilter(MeasurementStates.hips))
async def get_hips(message: types.Message, state: FSMContext):
    await state.update_data(hips=message.text)
    await message.answer("Левая рука:")
    await state.set_state(MeasurementStates.left_arm)

@router.message(StateFilter(MeasurementStates.left_arm))
async def get_left_arm(message: types.Message, state: FSMContext):
    await state.update_data(left_arm=message.text)
    await message.answer("Правая рука:")
    await state.set_state(MeasurementStates.right_arm)

@router.message(StateFilter(MeasurementStates.right_arm))
async def get_right_arm(message: types.Message, state: FSMContext):
    await state.update_data(right_arm=message.text)
    await message.answer("Левое бедро:")
    await state.set_state(MeasurementStates.left_leg)

@router.message(StateFilter(MeasurementStates.left_leg))
async def get_left_leg(message: types.Message, state: FSMContext):
    await state.update_data(left_leg=message.text)
    await message.answer("Правое бедро:")
    await state.set_state(MeasurementStates.right_leg)

@router.message(StateFilter(MeasurementStates.right_leg))
async def get_right_leg(message: types.Message, state: FSMContext):
    await state.update_data(right_leg=message.text)
    await message.answer("Плечи:")
    await state.set_state(MeasurementStates.shoulders)

@router.message(StateFilter(MeasurementStates.shoulders))
async def get_shoulders(message: types.Message, state: FSMContext):
    await state.update_data(shoulders=message.text)
    data = await state.get_data()

    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO measurements (
            user_id, date, chest, waist, hips, left_arm, right_arm, left_leg, right_leg, shoulders
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        message.from_user.id,
        datetime.now().strftime("%Y-%m-%d"),
        data.get("chest"), data.get("waist"), data.get("hips"),
        data.get("left_arm"), data.get("right_arm"),
        data.get("left_leg"), data.get("right_leg"),
        data.get("shoulders")
    ))
    conn.commit()
    conn.close()

    await message.answer("Замеры сохранены. Спасибо!")
    await state.clear()
