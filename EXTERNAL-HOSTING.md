# DZ LAB в Cloudflare

Публичный адрес — [dz-lab.dimkaaistov.workers.dev](https://dz-lab.dimkaaistov.workers.dev). Основной конфиг — `wrangler.jsonc`, точка входа — `worker/external.ts`. Worker раздаёт React SPA из `dist/static` и использует D1 `dz-lab-db` через `env.DB`.

## Порядок публикации

В корне репозитория выполни команды с Node 24+, pnpm и Wrangler из проекта. Авторизуйся в аккаунте, где одновременно находятся Worker и база.

```sh
pnpm install --frozen-lockfile
pnpm exec wrangler login --scopes account:read user:read workers_scripts:write d1:write
pnpm exec wrangler d1 migrations apply dz-lab-db --remote --config wrangler.jsonc
```

Перед переключением скачай действующий публичный прайс, чтобы сохранить подтверждённые даты и цены, появившиеся после последнего коммита каталога. Храни SQL и снимок вне Git.

```sh
mkdir -p .sites-runtime
curl -fsS https://dz-lab.dimkaaistov.workers.dev/api/prices/current \
  -o .sites-runtime/previous-price-feed.json
node scripts/seed-price-offers.mts .sites-runtime/price-offers.sql .sites-runtime/previous-price-feed.json
pnpm exec wrangler d1 execute dz-lab-db --remote --config wrangler.jsonc --file .sites-runtime/price-offers.sql
```

При развёртывании с нуля, если прежнего опубликованного прайса нет, запусти скрипт с одним аргументом — путём к SQL. Повторный импорт безопасен. Снимок из репозитория заполняет отсутствующие предложения, а наблюдения из прежнего прайса применяются только при более свежем `checkedAt`. Импорт сам по себе не создаёт записи успешного цикла.

Установи один случайный секрет в двух местах. Wrangler и GitHub CLI попросят ввести значение интерактивно.

```sh
pnpm exec wrangler secret put PRICE_JOB_TOKEN --config wrangler.jsonc
gh secret set PRICE_JOB_TOKEN --repo prepodobniy77/dz-lab
gh variable set SITE_URL --repo prepodobniy77/dz-lab --body 'https://dz-lab.dimkaaistov.workers.dev'
pnpm run build:cloudflare
pnpm run deploy:cloudflare
```

При первом развёртывании в пустом аккаунте Worker должен существовать для установки секрета. Для уже работающего `dz-lab` секрет можно задать до переключения. Резервный workflow начнёт использовать D1 после публикации нового Worker и попадания изменений в `main`. Если в Cloudflare настроен автоматический деплой GitHub, проверь, что он вызывает `pnpm run build:cloudflare` и `pnpm run deploy:cloudflare`.

Необязательные секреты. Для бесплатного прохода XCOM оставь их пустыми.

```sh
# Один из двух поставщиков поиска
pnpm exec wrangler secret put ROUTERAI_API_KEY --config wrangler.jsonc
pnpm exec wrangler secret put PERPLEXITY_API_KEY --config wrangler.jsonc
# Прайс Delect требует обе настройки
pnpm exec wrangler secret put DELECT_API_KEY --config wrangler.jsonc
pnpm exec wrangler secret put DELECT_DISTRIBUTOR --config wrangler.jsonc
```

## Доступ посетителей

Каталог и конфигуратор доступны без аккаунта. Кнопка сохранения записывает сборку в локальное хранилище браузера. Другой браузер или устройство использует своё хранилище. Облачное сохранение через `/api/builds` отключено и возвращает 404. Если понадобится сохранение по ссылке, минимальный вариант — отдельный анонимный маршрут с непрогнозируемым идентификатором, сроком жизни и лимитом создания.

Вход и доверие к заголовкам ChatGPT отключены через `TRUST_OAI_HEADERS=0`. Интерфейс для посетителя показывает время проверки и переход в магазин. Точечный `POST /api/prices/refresh` возвращает 401. Владелец вручную запускает порционный цикл через GitHub Actions или `POST /api/prices/sweep` с Bearer-секретом.

## Расписание и проверка

Cloudflare Cron запускается в **06:00 и 18:00 МСК**. Резерв GitHub Actions — в **06:20 и 18:20 МСК**, а также через `workflow_dispatch`. Фид DNS — отдельный workflow в **06:40 и 18:40 МСК**, только при наличии URL. Связанное задание Sites выключено. [Проверка публикации и истории циклов](PRICE-UPDATES.md).

## Источники и панель владельца

`/admin/prices` читает защищённый отчёт; `/api/prices/sources` публично показывает расписание и возраст цен. [Источники и требуемые доступы](PRICE-SOURCES.md).

Когда DNS выдаст разрешённый фид, задай настройки (до этого DNS пропускается):

```sh
gh secret set DNS_FEED_URL --repo prepodobniy77/dz-lab
# Только если поставщик требует Bearer-токен:
gh secret set DNS_FEED_TOKEN --repo prepodobniy77/dz-lab
gh variable set PRICE_DNS_INTERVAL_HOURS --repo prepodobniy77/dz-lab --body 12
gh variable set FEED_MAX_AGE_HOURS --repo prepodobniy77/dz-lab --body 36
```

В переменные Worker добавь `DNS_FEED_ENABLED=1`, когда фид настроен в GitHub. Частоты XCOM/Delect — `PRICE_XCOM_INTERVAL_HOURS` / `PRICE_DELECT_INTERVAL_HOURS`. Не помещай секретный URL в `wrangler.jsonc`.

Необязательные уведомления владельцу:

```sh
pnpm exec wrangler secret put TELEGRAM_BOT_TOKEN --config wrangler.jsonc
pnpm exec wrangler secret put TELEGRAM_CHAT_ID --config wrangler.jsonc
```

Зелёная сборка не подтверждает свежесть: после публикации нужны реальные новые `checkedAt` и запись успешного цикла. Предпросмотр может использовать ту же базу: не вызывай в нём обновление с рабочим секретом. Локальная проверка использует отдельную временную D1.
