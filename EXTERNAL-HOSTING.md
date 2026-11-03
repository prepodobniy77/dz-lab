# DZ LAB в собственном Cloudflare

Режим первого запуска: публичный каталог и конфигуратор без входа. Черновик и до 100 сохранённых сборок хранятся в localStorage этого браузера. Очистка данных браузера удаляет их. Для передачи состава используется TXT; ссылки на локальные сборки открываются только в том же браузере. Серверное сохранение и MCP на внешнем хостинге закрыты.

## Сборка и публикация

Node.js 24, pnpm 11.25.0 из package.json. Установка: pnpm install --frozen-lockfile. Проверка: pnpm exec tsc --noEmit и node --test tests/*.test.mts. Сборка: pnpm run build:cloudflare. Публикация: pnpm run deploy:cloudflare. Локально: pnpm run dev:cloudflare.

Workers Builds: репозиторий prepodobniy77/dz-lab, ветка main, build command pnpm run build:cloudflare, deploy command pnpm exec wrangler deploy --config dist/server/wrangler.json. Переменная сборки NODE_VERSION=24.22.2. Секреты не нужны для публичного каталога.

wrangler.jsonc задаёт Worker dz-lab и новую D1 dz-lab. Wrangler может создать базу при первой публикации. После создания нужно закрепить возвращённый database_id и применить миграции из drizzle к новой базе. Пока таблицы не созданы, каталог работает из data/catalog.json и честно показывает этот режим. Рабочие данные исходной D1 Sites этим способом не переносятся.

## Обновление цен

Автообновление на новом сайте не включено. Cron отсутствует в конфигурации внешнего Worker. Существующий GitHub workflow требует vars.SITE_URL и secrets.PRICE_JOB_TOKEN; не настраивать его на новый адрес до миграции D1 и проверки защиты и отчёта. Лимиты платного поиска не повышены. Старый хостинг Sites не изменяется.

## Совместная работа с Claude Code и Codex

Код хранится в GitHub. Перед задачей обновляйте main, используйте отдельные ветки и pull requests. Сохранены исходные команды Sites; для внешнего Cloudflare используйте команды с суффиксом :cloudflare. При внешней сборке Sites preview-плагины отключены. Входящие заголовки oai-authenticated-user-* удаляются до обработки запроса. TRUST_OAI_HEADERS остаётся 0.

Проверки при подготовке: TypeScript и 77 тестов прошли; внешняя production-сборка проходит. Успешную публикацию проверять отдельно по фактическому URL.
