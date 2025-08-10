from aiogram import Router, types
from aiogram.fsm.context import FSMContext
from states.documents import DocumentStates
from database import get_connection
import os

router = Router()

DOCUMENTS_PATH = "documents"

@router.message(lambda m: m.text == "📁 Документы")
async def document_menu(message: types.Message):
    await message.answer("Вы можете прикрепить скан согласия. Отправьте файл:")
    await FSMContext.set_state(DocumentStates.waiting_file)

@router.message(DocumentStates.waiting_file)
async def save_document(message: types.Message, state: FSMContext):
    if not message.document:
        await message.answer("Пожалуйста, отправьте файл.")
        return

    file = message.document
    path = os.path.join(DOCUMENTS_PATH, f"{message.from_user.id}_{file.file_name}")
    await message.bot.download(file, destination=path)

    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO documents (user_id, file_type, file_path) VALUES (?, ?, ?)",
                   (message.from_user.id, "consent", path))
    conn.commit()
    conn.close()

    await message.answer("Документ сохранён.")
    await state.clear()
