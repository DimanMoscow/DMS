# План выпуска кандидата v57 — прежний порядок опровергнут

14.09: разрешённая ночная попытка создала numbered 57 и вернула production mapping/HEAD на v56. Main/Vercel не менялись; writes восстановлены. Точный результат: [V57_NIGHT_RELEASE](V57_NIGHT_RELEASE.md).

**Не исполнять следующий исторический порядок.** P1 interlock закрывает весь POST ingress, поэтому signed read smoke до открытия writes невозможен. Новый actual-bundle test доказывает это на v56 и v57. Перед повторным выпуском требуется отдельно согласованный порядок с guarded activation перед signed reads либо новая проверенная реализация maintenance-read contract. Ночью P1 код не менялся. Numbered 57 уже существует и не должен создаваться повторно как будто номер свободен.

Текущий preflight и проверенный порядок: [V57_READINESS](V57_READINESS.md).
Выбран backend-first в одном контролируемом окне с закрытой записью до Web READY
и совпадения runtime identities. Смешанные read-контракты протестированы; strict
runtime mismatch не отключается. Raw Calendar gate закрыт; техническая readiness
YES для отдельного release approval, production пока v56.

1. После review заново получить `origin/main` и живые Vercel/Apps Script identities. При изменившемся baseline остановить выпуск и пересобрать diff. Проверить полный HEAD и numbered source через owner reader, а не только deployment label.
2. Завершить gate: dependency audit, lint, все tests, typecheck/build, snapshot verifier, migrations; отдельно candidate replay/concurrency/fault fixtures. Проверить PR Preview без production writes. Зафиксировать точный commit и candidate tree.
3. Подготовить offline release plan (`buildOfflineReleasePlan`, candidate v57, baseline v56) с exact source revision. Отдельно проверить форматы reader/writer profiles; это не доказательство OAuth или remote access. Не выводить credentials.
4. Получить свежую owner-only private recovery manifest + проверенный isolated restore. Fixture workbook не заменяет production backup. Предварительно выполнить read-only Calendar plan и показать число/типы ожидаемых Queue writes; исключения и неизвестные записи остаются pending.
5. Показать Дмитрию точный итог: Apps Script source diff, runtime fingerprints, какие новые поля/API/UI появятся, Calendar preview write-set, порядок выпуска/rollback. Получить отдельное подтверждение. Если нет свежего owner reader/writer OAuth — ручной hard stop, без обхода.
6. Только после разрешения: действующий execution drain/interlock, staging полного HEAD, независимое read-back сравнение с кандидатом после двух разрешённых URL substitutions, numbered version, production deployment mapping, runtime proof и проверенное открытие interlock. Сохранять trigger ownership/cadence и не перекрывать backup/digest окна. Использовать действующий staged release contract, не копировать release-v56 runner вслепую под другой номер.
7. Production pointer и ожидаемая runtime identity MiniApp обновляются отдельным согласованным release commit после фактического подтверждения numbered source. Merge main автоматически запускает Vercel production; не делать второй manual deploy. Новый UI совместим с отсутствующими optional полями старого backend, однако old UI не показывает старые registrations — согласовать минимальное окно между двумя частями.
8. Read-only gate и smoke: /api/health exact SHA, /api/apps-script-runtime, signed Today/Clients/history/registration; сравнение исходных клиентских счётчиков и платежей; никаких attendance/payment/alias writes. Новую history/unknown ветку проверять на fixtures либо approved isolated copy.
9. Естественный sync должен пройти с completed post-sync reconciliation; проверить сценарий наступления горизонта. Watchdog оценивать по новым phase timings на естественных запусках; один быстрый запуск не закрывает F09. Уведомления не маскировать и не создавать синтетический digest ради зелёного статуса.

Rollback: заранее сохранить проверенный v56 source/identity и предыдущий Vercel deployment. Возврат кода — отдельное согласованное production действие. Не откатывать всю таблицу поверх новых клиентских операций; исправление данных только по точному сравнению и отдельному плану. Этот кандидат не требует schema migration и не восстанавливает repair клиента повторно.

Можно принять в PR сейчас: проверенные source fixes, read-only UI/history/onboarding navigation, profiler и документацию. Автоматически выпускать нельзя: изменения затрагивают реальные пользовательские потоки и Calendar ingestion. Новые бизнес-правила/цены/автоматические продления/массовые подтверждения не входят в релиз.
