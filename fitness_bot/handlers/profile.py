from aiogram import Router, types
from database import get_connection

router = Router()

@router.message(lambda m: m.text.lower() == "профиль" or m.text.lower() == "личный кабинет")
async def profile(message: types.Message):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT name, gender, birth_date, height, weight FROM users WHERE telegram_id = ?", (message.from_user.id,))
    row = cursor.fetchone()
    conn.close()

    if row:
        name, gender, birth_date, height, weight = row
        await message.answer(f"Ваши данные:\n"
                             f"Имя: {name}\nПол: {gender}\nДата рождения: {birth_date}\n"
                             f"Рост: {height} см\nВес: {weight} кг")
    else:
        await message.answer("Вы ещё не зарегистрированы.")
