import asyncio
from aiogram import Bot, Dispatcher
from aiogram.fsm.storage.memory import MemoryStorage
from config import BOT_TOKEN
from handlers import start, registration, health, measurements, profile, training, nutrition, payment, documents, admin_documents

async def main():
    bot = Bot(token=BOT_TOKEN)
    dp = Dispatcher(storage=MemoryStorage())

    dp.include_router(start.router)
    dp.include_router(registration.router)
    dp.include_router(health.router)
    dp.include_router(measurements.router)
    dp.include_router(profile.router)
    dp.include_router(training.router)
    dp.include_router(nutrition.router)
    dp.include_router(payment.router)
    dp.include_router(documents.router)
    dp.include_router(admin_documents.router)

    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
