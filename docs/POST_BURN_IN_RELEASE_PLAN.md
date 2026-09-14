# План выпуска кандидата v57 — corrected activation order

Действующая последовательность и доказательства: [V57_RETRY_PROCEDURE](V57_RETRY_PROCEDURE.md).
**READY TO RETRY v57 RELEASE: YES** для исправленной процедуры и неизменённого candidate. В текущей задаче production не переключается.

1. Fresh identities, сохранённые gates неизменённого runtime, recovery/restore и raw Calendar write-set.
2. CLOSED/readback → свежий **420 s drain** → проверка исполнений/durable operations.
3. Полный HEAD v57/readback → уже существующий exact numbered 57 → existing production mapping.
4. Release commit через protected main → единственный автоматический Vercel deploy → READY/exact SHA.
5. При CLOSED: source, mapping, runtime, GET, HTTP validation и native data/financial/durable checks.
6. Guarded OPEN/readback → немедленный read-only signed Telegram/MiniApp smoke → сравнение бизнес-данных.
7. При первой доказанной регрессии CLOSED → новый drain → exact v56 HEAD/mapping и нужный Web rollback → GET/native checks → guarded OPEN → безопасные signed reads.
8. После initial PASS — только естественные sync/watchdog/post-sync наблюдения, без новых функций.

**Signed smoke при CLOSED удалён из gate.** Ночной rollback был корректным: P1 interlock закрывает весь POST ingress и на v56, и на v57. Никакого bypass или изменения защит нет. Runtime candidate не изменился; numbered 57 не создаётся повторно. На v56 rollback smoke исключает `/today` и `/attention`, поскольку они делают inline sync.

Свежий preview: **3 новые pending Queue rows + 8 одинаковых rewrites**, cancelled/errors 0; все 17 значений совпадают с обычным v56 wide planner. Не выполнять confirm-day, клиентские/финансовые/блоковые/attendance mutations или автоматическое применение решений. Новые business rules и P3 backlog не входят в release.

Ночная история: [V57_NIGHT_RELEASE](V57_NIGHT_RELEASE.md). Предыдущие gates и candidate evidence: [V57_READINESS](V57_READINESS.md). Старые rollout steps с signed smoke до OPEN не исполнять; их заменил указанный corrected document.