from aiogram import Router, types
from aiogram.filters import CommandStart
from keyboards.client import main_menu_kb
from database import get_connection

router = Router()

@router.message(CommandStart())
async def cmd_start(message: types.Message):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM users WHERE telegram_id = ?", (message.from_user.id,))
    user = cur.fetchone()
    conn.close()

    if user:
        await message.answer("С возвращением! Выберите действие:", reply_markup=main_menu_kb())
    else:
        await message.answer("Привет! Давайте начнём регистрацию. Введите ваше имя:")
        from states.registration import RegistrationStates
        from aiogram.fsm.context import FSMContext
        await FSMContext.set_state(RegistrationStates.name)
