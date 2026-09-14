# v57 — проверка готовности, 14 сентября 2026

**Latest execution admission: BLOCKED.** The owner-authorized 12:25–13:10 Moscow retry did not start a production switch. Fresh source/recovery/Calendar passed, but the activation/smoke time budget was not met and intermediate release metadata still requires a truthful contract for the three known horizon omissions. See [V57_RETRY_RELEASE_CHECKPOINT](V57_RETRY_RELEASE_CHECKPOINT.md). Earlier procedure YES below is not current execution readiness. Production remains exact v56 with OPEN ingress.

**Действующий corrected порядок: [V57_RETRY_PROCEDURE](V57_RETRY_PROCEDURE.md), READY TO RETRY v57 RELEASE: YES.** Production остаётся v56; текущая задача не выполняет повторный release. Требование signed smoke при CLOSED удалено из действующего gate; оно выполняется немедленно после guarded OPEN. Далее сохранён контекст ночной ошибки. **Прежний порядок smoke: NO.** Ночная разрешённая попытка создала exact numbered v57 и переключила Apps Script mapping, затем была остановлена: production interlock блокирует весь `doPost`, включая signed reads. Невозможно одновременно держать interlock закрытым и получить успешный Telegram/MiniApp smoke. Это свойство присутствует и в v56, и в v57; прежнее YES не учитывало фактический ingress-контракт. Mapping и HEAD возвращены на v56. Main/Vercel не менялись. Ночной фактический результат: [V57_NIGHT_RELEASE](V57_NIGHT_RELEASE.md).

Следующие A–E сохраняют доказательства предыдущего preflight. Их PASS не разрешает повторить опровергнутый rollout. Новый тест `release-maintenance-contract.test.mjs` воспроизводит блокировку подписанных чтений на обоих bundles без business writes.

**Утреннее дополнение:** exact v56 повторно подтверждён owner reader в 05:28:49Z, бизнес-значения неизменны. Естественные sync/watchdog воспроизвели известный horizon-дефект v56: одна запись Calendar отсутствует в Queue до wide scan; alert сохранён. Локальный actual v57 planner теперь предлагает **1 новую pending row + 8 идентичных rewrites**, поэтому прежний preview «только 8» больше не является актуальным write-set. Перед повторным release нужны новый fresh preflight и review нового write-set вместе с исправленным порядком smoke/activation. F09 OPEN; утренний digest завершён, ночное наблюдение приостановлено.

## A. Изменения после первого аудита

- Стоимость в карточке: активный блок → цена блока; без блока и `singlePrice > 0` → цена разовой; неизвестная цена → «—». Три render regression tests.
- «Calendar onboarding» / «Показать preview» заменены на «Регистрация из календаря» / «Проверить данные».
- Добавлен изолированный backend: полный bundle v57, реальные `doGet` / `doPost`, HMAC/TTL/admin checks и бизнес-читатели. Подменяются только границы Google services. Токен синтетический, внешняя сеть запрещена, transport отклоняет все mutation actions до бизнес-обработчиков.
- Добавлены проверки смешанных версий: реальные ответы v56 → новый Web; реальные ответы v57 → Web из точного baseline commit.
- Runtime constants в candidate приведены к синтаксису, поддерживаемому строгим release verifier; значения fingerprints не менялись.

## B. Isolated E2E — PASS с указанной границей

Код Web: `af99236e18b1dd13273768171972063dc11af6eb`. Apps Script: полные 26 файлов v57. Браузер → локальная production-сборка Next → `/api/dms` → реальный router v57 → service-boundary fixtures.

В отдельной локальной копии применена только будущая точная runtime expectation v57 в `lib/apps-script-runtime-identity.ts`. SHA-256 полученного файла: `2bcc1106e5836115b0fbeb72b42b3fdd577d582b84871a693d97a9322890a149`. Это явно обозначенная staging-правка поверх commit, а не утверждение, что неизменённый PR уже ожидает v57. Production pointer в Git остаётся v56. Credentials и production URL в Preview/fixture не переносились.

| Проверка | Доказательство |
|---|---|
| `/api/health` | HTTP 200, `no-store`, exact code SHA выше, connected |
| `/api/apps-script-runtime` | HTTP 200, `post-burn-in-audit`, все три fingerprint и оба loaded-флага совпадают |
| Today, Clients, без блока, разовая, история | Реальные signed API reads; браузер показывает 3 клиента, «—» без цены, 3 500 ₽ для разовой и 1 тренировку без active block |
| Unknown текущая/старая дата | В браузере отдельная секция других дат; new/link/ignore previews через реальный backend, без записи |
| Accepted selection | Браузер отправил `confirm_day` только с `Q-TODAY` и `Q-UNKNOWN`; `Q-OLDER` отсутствует. Transport перехватил запрос, writes=0 |
| Report | UI показывает «Август 2026» из fixture Report. Отдельные v56/v57 fixtures доказывают запрет сложения разных месяцев/лет с текущим прогнозом |
| Health / error | HTTP read успешен; health честно красный из-за отсутствующих fixture triggers/backup/formulas. Это не production health 23/23 |
| Reload / stale reads | Повторный bootstrap сохраняет revision без изменений; reload восстанавливает данные; изменённая/просроченная auth отклоняется 401 |
| P1 mutation paths | Успешные replay/concurrency/fault-injection проверки выполнены отдельными actual-bundle fixtures; браузерный перехват не выдаётся за успешное проведение дня |

Проверки воспроизводятся через `tests/isolated-candidate-backend.test.mjs`, `scripts/serve-isolated-candidate.mjs`, `npm run test:audit-candidate`; браузерные и HTTP receipts сохранены приватно. Локальная среда не доказывает Google service latency или реальное Telegram WebView поведение на телефоне; prior read-only production smoke и mobile render evidence остаются отдельными доказательствами.

## C. Fresh preflight

| Gate | Итог |
|---|---|
| GitHub main / Vercel Production | PASS: `4ab73e2103e85c3e0dd199ac220db51d2ccd61d3`; Vercel READY, target production, Git SHA совпадает |
| Owner exact source | PASS: HEAD = numbered v56 = immutable Git v56 после двух документированных URL substitutions; 25 файлов; повторно проверено после native read-only preview в 00:18:12Z |
| Полный repo gate | PASS: 335/335 tests, lint, typecheck/build, dependency audit 0 vulnerabilities, snapshots, migrations |
| Candidate gate | PASS: 47/47; replay, selection semantics, stale row, concurrency, fault injection |
| P1 неизменность | PASS: OperationSafety, UndoSafety, FinancialSafety, ReleaseSafety и DomainOperations побайтно равны v56 |
| Recovery | PASS: ровно 2 owner-only копии; backup = source на 16 листах в 00:17:44Z; isolated restore = backup в 00:17:56Z; source fingerprint `fd45b8ced940cba25672c41fc8abd21d81c46a34c610c8b6e20e5b6174715f49` |
| Reader + manifest + ledger | PASS: отдельный reviewed preflight проверил backup reference, restore, ledger `present-v2`, materialized candidate и runtime markers; только GET |
| Repair consistency | PASS: affected client/current block 2 проведено / 8 осталось, старт 10.09, долг 0; prior block закрыт 10/10; payment уникален; обе нужные записи Journal относятся к новому блоку. IDs и исходные строки остаются в private evidence |
| Native Calendar v56 preview | PASS: 03:16:37 Moscow, added/updated/cancelled/errors = 0, writes=[]; sync не запускался |
| Candidate Calendar preview | PASS: raw Google Calendar API + exact saved scan cursor + actual v56/v57 planners; 129 событий, 19 deleted, все страницы прочитаны |

Calendar preflight **00:42:08Z**: Sheet read 00:39:22Z, сохранённый cursor `lastSuccessfulAt=00:21:13.120Z`, `lastWideVerificationAt=13.09 16:21:33.611Z`. Raw Calendar API использован только для рабочего календаря, с `calendar.events.readonly`; credentials и IDs остаются вне Git. Incremental query с `updatedMin=13.09 00:21:13.120Z`, `showDeleted=true`, без ограничения start/end вернул 0 событий (включая переносы за пределы горизонта). Wide query с 11.08 Moscow до 15.09 00:42:08Z вернул **129 событий, включая 19 cancelled**, без следующей страницы.

Точные v56/v57 planners исполнялись в VM без подмены бизнес-функций, с service-boundary ответами raw API. **v56: 0 writes; v57: 8 writes**, added/cancelled/errors = 0. Сравнение всех 17 значений не выявило изменений: 7 строк остаются `Ожидает`, 1 — `Требует регистрации`. Очередь, Журнал, клиенты и оплаты не изменялись. Нативный v56 preview независимо показал тот же нулевой результат. Earlier connector-only projection больше не является единственным доказательством; missing tombstones/cursor устранены. Перед фактическим staging/активацией повторить preview с новым фиксированным временем и остановиться при любом новом смысловом изменении.

## D. Identity

- Base: `4ab73e2103e85c3e0dd199ac220db51d2ccd61d3`.
- Последний runtime-code commit: `af99236e18b1dd13273768171972063dc11af6eb`; последующие readiness commits должны быть только документацией.
- Candidate tree: `332ef8a3c8672293598704abf62ee445b496d29d5bbddd4f4f98a9b1c404220c` (26 файлов, 9 changed/added).
- Router: `161d134be312bf1e35206e31f290c670f930b16daaa9c3f50559b6e5d7dd4866`.
- Portal: `763e56aebc3bd07db8bae8e70e33e40ea3ab29856f7fb9ed408c482e979e4b98`.
- Confirmations: `b2e901820acae7e6453d57d562d244caeb916abb1a190583c95e0318a1460ba5`.

## E. Риски и P3 backlog

**F09 остаётся открытым, не самостоятельный blocker v57.** Native 13.09 watchdog показал 150.717 s overall / 140.072 s health; соседние завершённые исполнения 15–34 s не опровергают выброс. Phase profiling возвращает исходный результат/исключение и не меняет alert/reconciliation. В изолированном actual health pipeline подтверждены фазовые записи; их локальные миллисекунды не являются production performance evidence.

После разрешённого выпуска наблюдать следующие 12 естественных watchdog запусков (24 часа): total/health/phase timings, исходный health verdict, sync generation и completed post-sync evidence. При >120 s — сохранить медленную фазу и окружающие service errors; при >240 s либо двух последовательных ухудшениях сравнить со v56 и остановить дальнейшее расширение. Это диагностические критерии наблюдения, не новые правила маскирования alert. Не запускать синтетические digest/health ради зелёного статуса.

**P3 — история и размер Journal.** Сейчас каждый client-scoped запрос читает полный Journal и фильтрует по clientId. Предлагаемый trigger для профилирования/индекса: 5 000 записей Journal либо p95 чтения истории >1 s на 20 естественных запросах, что наступит раньше; это инженерный порог, не установленный предел Google. При 5 000 строках измерить cells/read и сортировку; затем выбрать client index/узкий read path с проверкой stale index и сохранением cancelled/undated history. До измерения не усложнять v57. Дополнительно P3: подавить полностью одинаковые Queue rewrites после доказательства совместимости; сейчас эти 8 повторов явно включены в release write-set estimate.

## F. Действующий порядок выпуска

Исполнять только [V57_RETRY_PROCEDURE](V57_RETRY_PROCEDURE.md): fresh preflight/recovery → CLOSED/readback → 420 s drain → exact полный HEAD v57 → existing numbered 57 mapping → Web READY → доступные GET/runtime/native checks → guarded OPEN/readback → немедленный read-only signed smoke → сравнение данных → естественное наблюдение. При регрессии: CLOSED → новый drain → exact HEAD/mapping/Web v56 → GET/native checks → guarded OPEN → безопасные signed reads.

Signed smoke при CLOSED не требуется и не считается возможным. P1 код и auth/interlock semantics не меняются. Ночная версия 57 уже создана и повторно не создаётся. Проверка runtime source 09:07Z подтвердила неизменность candidate. Новый raw Calendar preview 09:12Z: **3 pending additions + 8 полностью одинаковых rewrites**, не прежние 1+8 или 0+8; обычный v56 wide planner даёт все те же 17 значений. Это не подтверждение посещений. Новые данные и окно подробно зафиксированы в corrected procedure.

## G. Итог

**READY TO RETRY v57 RELEASE: YES** для исправленной процедуры и неизменённого candidate, с обязательными execution-time fresh gates из нового документа. Повторного production переключения в этой задаче нет. Полные предыдущие gates остаются исторически атрибутированными; дополнительно пройдено 22/22 целевых теста. Текущий live baseline — v56, main/Vercel unchanged. Ночной rollback признан корректным; candidate v57 не объявляется виновником ошибки процедуры.