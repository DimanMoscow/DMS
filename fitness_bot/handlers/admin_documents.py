from aiogram import Router, types
from database import get_connection

router = Router()

@router.message(lambda m: m.text.lower() == "📁 документы" and m.from_user.id == 123456789)  # замените на ID админа
async def list_user_documents(message: types.Message):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT user_id, file_type, file_path FROM documents")
    rows = cursor.fetchall()
    conn.close()

    if not rows:
        await message.answer("Нет загруженных документов.")
        return

    for user_id, file_type, file_path in rows:
        await message.answer(f"👤 {user_id} | 📄 {file_type}\n{file_path}")
