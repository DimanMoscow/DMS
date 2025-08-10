from aiogram.types import ReplyKeyboardMarkup, KeyboardButton

def admin_menu_kb():
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="👤 Клиенты"), KeyboardButton(text="📋 Протоколы")],
            [KeyboardButton(text="📁 Документы"), KeyboardButton(text="📊 Отчёты")],
            [KeyboardButton(text="↩️ Назад")]
        ],
        resize_keyboard=True
    )
