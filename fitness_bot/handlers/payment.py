from aiogram import Router, types
from database import get_connection
from datetime import datetime

router = Router()

@router.message(lambda m: m.text == "📦 Купить тренировки")
async def buy_trainings(message: types.Message):
    await message.answer("Введите количество тренировок, которое вы хотите купить:")

@router.message(lambda m: m.text.isdigit())
async def confirm_purchase(message: types.Message):
    count = int(message.text)
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO purchases (user_id, date, count) VALUES (?, ?, ?)",
                   (message.from_user.id, datetime.now().strftime("%Y-%m-%d"), count))
    conn.commit()
    conn.close()
    await message.answer(f"Покупка {count} тренировок успешно зарегистрирована!")
