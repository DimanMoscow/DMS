from aiogram import Router, types
from aiogram.fsm.context import FSMContext
from aiogram.filters import StateFilter
from states.health import HealthStates

router = Router()

@router.message(StateFilter(HealthStates.chronic))
async def get_chronic(message: types.Message, state: FSMContext):
    await state.update_data(chronic=message.text)
    await message.answer("Были ли у вас травмы или операции?")
    await state.set_state(HealthStates.injuries)

@router.message(StateFilter(HealthStates.injuries))
async def get_injuries(message: types.Message, state: FSMContext):
    await state.update_data(injuries=message.text)
    await message.answer("Есть ли жалобы на сердечно-сосудистую систему?")
    await state.set_state(HealthStates.cardio)

@router.message(StateFilter(HealthStates.cardio))
async def get_cardio(message: types.Message, state: FSMContext):
    await state.update_data(cardio=message.text)
    await message.answer("Жалобы на опорно-двигательный аппарат?")
    await state.set_state(HealthStates.musculoskeletal)

@router.message(StateFilter(HealthStates.musculoskeletal))
async def get_musculoskeletal(message: types.Message, state: FSMContext):
    await state.update_data(musculoskeletal=message.text)
    await message.answer("Спасибо! Данные сохранены.")
    await state.clear()
