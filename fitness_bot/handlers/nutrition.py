from aiogram import Router, types

router = Router()

@router.message(lambda m: m.text == "📋 План питания")
async def show_nutrition_menu(message: types.Message):
    await message.answer("Раздел питания. Выберите действие:\n"
                         "1. Заполнить анкету\n"
                         "2. Получить план\n"
                         "3. Мои планы питания")
