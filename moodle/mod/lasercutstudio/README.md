# mod_lasercutstudio — редактор макетов для лазерной резки внутри Moodle

Активный модуль курса: студент рисует макет в редакторе LaserCut Studio прямо на странице
элемента курса, сдаёт `.lcx`-файл в Moodle, преподаватель смотрит сданное и ставит оценку
в журнал.

Версия плагина: **1.0.0 (2026111400)**. Требуется Moodle **4.2+** (проверено на 5.0.11),
PHP 8.1+ (проверено на 8.4).

---

## Что умеет

* Экран студента: `view.php` — iframe с редактором (или кнопка «открыть в новой вкладке»),
  поле комментария, кнопка сдачи. Высота редактора настраивается в параметрах элемента.
* Сдача: один активный `.lcx`-файл на пользователя (до 4 МБ) + до 5 вложений
  (PDF/фото/чертежи). Повторная сдача заменяет макет, а не плодит копии.
* Экран преподавателя: `submissions.php` — таблица сдач (кто, когда, сколько объектов,
  размер файла, комментарий, оценка) и выставление оценки прямо в строке.
* Оценка уходит в журнал оценок (`grade_item`), статус сдачи меняется на «Оценено».
* Права: `mod/lasercutstudio:addinstance`, `:view`, `:submit`, `:viewsubmissions`,
  `:grade`, `:export`.
* Приватность: реализован Privacy API (данные пользователя, файлы, оценки).
* Резервное копирование/восстановление курса (включая сдачи и файлы) — `backup/moodle2`.
* События: `course_module_viewed`, `submission_created`, `submission_graded`.
* Языки: английский и русский (все строки в `lang/`).

---

## Установка

1. Скачать архив плагина (или склонировать репозиторий) и распаковать так, чтобы получился путь:

   ```
   <moodle>/mod/lasercutstudio/version.php
   ```

   То есть папка внутри архива — `lasercutstudio`, а не `moodle-mod_lasercutstudio-1.0.0`.

2. Выполнить обновление базы:

   ```bash
   cd /path/to/moodle
   php admin/cli/upgrade.php --non-interactive
   ```

   Или зайти в веб-интерфейс под администратором — Moodle сам предложит обновиться.

3. Проверить, что плагин виден: «Администрирование → Плагины → Модули деятельности».

4. В курс добавить элемент «LaserCut Studio: макет» (или как он назван в вашей локализации).

### Требования к серверу

* `max_input_vars >= 5000` — иначе форма сдачи макета обрезается (в макете может быть
  много объектов, а Moodle передаёт их полем формы).
  Проверить: `php -i | grep max_input_vars`.
* Запись в `moodledata` (стандартно) — туда попадают `.lcx`-файлы.
* PHP 8.4 поддерживается Moodle 5.0; Moodle 4.5 с PHP 8.4 работать не будет (ограничение ядра).

---

## Как это работает

```
view.php            страница элемента курса
 ├─ iframe #lcx-frame → editor.php
 │                        └─ отдаёт editor/index.html (одностраничный редактор)
 │                           + <script id="lcx-moodle-config"> (cmid, sesskey, userid, maxbytes)
 │                           + bridge.js: postMessage 'ready' / 'submit'
 ├─ js/parent.js     ловит postMessage, кладёт макет в input[name=project],
 │                   проверяет размер, обновляет статус под iframe
 └─ форма (classes/form/submit_form.php) → submit.php → classes/submission.php
                                                          ├─ таблица lasercutstudio_submissions
                                                          └─ filearea 'submission' (itemid = userid)

submissions.php     таблица сдач + оценка (POST action=grade)
grade.php           переход к элементу журнала оценок
```

Файлы раздаются через `mod_lasercutstudio_pluginfile()`: студент видит только свой макет,
преподаватель (`:viewsubmissions`) — все.

---

## Разработка

Сборка редактора и укладка его в плагин (из корня репозитория `sim-2d`):

```bash
npm run build          # esbuild → site/index.html
npm run moodle:editor  # site/index.html → mod/lasercutstudio/editor/index.html + index.json
npm run moodle:check   # статическая проверка плагина: php -l, XML, строки, права, таблицы
```

`editor/index.html` — сгенерированный файл (~492 КБ, весь редактор со шрифтом и CSS внутри).
Править его руками нельзя: изменения затрутся при следующей сборке.

Живой смоук-тест на установленном Moodle (23 проверки: экземпляр, журнал, сдача, файлы,
пересдача, оценка, Privacy API, события, backup/restore, удаление):

```bash
php -d max_input_vars=5000 scripts/moodle-smoke.php --moodleroot=/path/to/moodle
```

Скрипт создаёт временные курсы и удаляет их после прогона (`--keep` — оставить).

---

## Ветки репозитория

Плагин живёт в ветке **`moodle-plugin`** — это `main` (редактор) плюс каталог `moodle/`.
`npm run sync`, запущенный из этой ветки, пушит её и подтягивает в неё свежий `main`;
запущенный из `main` — обновляет `main` и вливает его сюда. Поэтому ветка никогда не отстаёт
от редактора, а правки плагина не попадают в `main`.

## Структура

```
version.php                 версия и зависимости
db/install.xml              таблицы lasercutstudio, lasercutstudio_submissions
db/access.php               права
lang/{en,ru}/               строки
lib.php                     колбэки модуля: *_supports, *_add/update/delete_instance,
                            *_grade_item_update, *_pluginfile, *_reset_userdata
mod_form.php                форма настроек элемента курса
view.php                    экран студента (iframe + форма сдачи)
editor.php                  отдача редактора с внедрённой конфигурацией
submit.php                  обработка сдачи
submissions.php             экран преподавателя (таблица + оценки)
grade.php                   редирект в журнал оценок
index.php                   список всех экземпляров в курсе
classes/submission.php      логика сдачи: save(), get_files(), set_grade()
classes/form/submit_form.php
classes/event/              три события
classes/privacy/provider.php
backup/moodle2/             backup/restore шаги (сдачи и файлы переносятся)
editor/                     сборка редактора (генерируется)
js/parent.js, editor/bridge.js
pix/                        иконки модуля
styles.css
thirdpartylibs.xml          сторонние библиотеки внутри сборки редактора
```

---

## Лицензия

Код плагина — как и редактор — GPL-3.0-or-later (совместимо с Moodle). Сторонние библиотеки
перечислены в `thirdpartylibs.xml`.
