from aiogram.types import ReplyKeyboardMarkup, KeyboardButton

def main_menu_kb():
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="📏 Отправить замеры тела")],
            [KeyboardButton(text="📦 Купить тренировки")],
            [KeyboardButton(text="📋 План питания")],
            [KeyboardButton(text="📰 План тренировок")],
            [KeyboardButton(text="📁 Документы")],
            [KeyboardButton(text="💬 Поддержка")]
        ],
        resize_keyboard=True
    )
