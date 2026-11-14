/**
 * Мост «редактор → Moodle»: рисует кнопку «Сдать в Moodle» и отправляет
 * текущий макет в родительское окно через postMessage.
 *
 * Подключается только при отдаче через mod/lasercutstudio/editor.php,
 * поэтому в обычной версии редактора ничего не меняется.
 */
(function() {
    'use strict';

    var cfg = {};
    try {
        var node = document.getElementById('lcx-moodle-config');
        if (node) {
            cfg = JSON.parse(node.textContent) || {};
        }
    } catch (e) {
        cfg = {};
    }

    // В отдельной вкладке (не в iframe) кнопка не нужна — там своя кнопка «Скачать».
    if (window.parent === window) {
        return;
    }

    var isRu = String(cfg.lang || 'ru').indexOf('ru') === 0;
    var strings = {
        submit: isRu ? 'Сдать в Moodle' : 'Submit to Moodle',
        sent: isRu ? 'Макет отправлен в Moodle ↓' : 'Layout sent to Moodle ↓',
        empty: isRu ? 'Лист пуст — сначала нарисуйте макет' : 'The sheet is empty — draw something first',
        loading: isRu ? 'Редактор ещё загружается…' : 'The editor is still loading…',
        tooBig: isRu ? 'Макет слишком большой для отправки' : 'The layout is too large to submit'
    };

    function post(type, payload) {
        try {
            window.parent.postMessage({
                source: 'lasercutstudio',
                type: type,
                payload: payload || null
            }, window.location.origin);
        } catch (e) {
            /* родитель недоступен — молча игнорируем */
        }
    }

    function getDoc() {
        var api = window.lcx;
        if (!api || !api.store || !api.store.state || !api.store.state.doc) {
            return null;
        }
        return api.store.state.doc;
    }

    function paint() {
        var style = document.createElement('style');
        style.textContent = [
            '.lcx-moodle-bar{position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;gap:8px;align-items:center;',
            'font:600 14px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}',
            '.lcx-moodle-btn{border:0;border-radius:10px;padding:11px 16px;cursor:pointer;color:#fff;',
            'background:linear-gradient(180deg,#0ea5e9,#0284c7);box-shadow:0 10px 24px rgba(2,132,199,.35);}',
            '.lcx-moodle-btn:hover{filter:brightness(1.05);}',
            '.lcx-moodle-btn:active{transform:translateY(1px);}',
            '.lcx-moodle-flash{position:fixed;right:16px;bottom:64px;z-index:9999;max-width:320px;padding:9px 12px;',
            'border-radius:9px;background:#0f172a;color:#fff;font:500 13px/1.35 system-ui,sans-serif;opacity:0;',
            'transform:translateY(6px);transition:opacity .18s ease,transform .18s ease;}',
            '.lcx-moodle-flash.is-on{opacity:.95;transform:translateY(0);}'
        ].join('');
        document.head.appendChild(style);
    }

    var flashTimer = null;
    var flashNode = null;

    function flash(text) {
        if (!flashNode) {
            flashNode = document.createElement('div');
            flashNode.className = 'lcx-moodle-flash';
            document.body.appendChild(flashNode);
        }
        flashNode.textContent = text;
        flashNode.classList.add('is-on');
        window.clearTimeout(flashTimer);
        flashTimer = window.setTimeout(function() {
            flashNode.classList.remove('is-on');
        }, 3200);
    }

    function build() {
        paint();

        var bar = document.createElement('div');
        bar.className = 'lcx-moodle-bar';

        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'lcx-moodle-btn';
        button.textContent = strings.submit;
        button.title = isRu ? 'Передать макет в задание Moodle' : 'Send the layout to the Moodle activity';

        button.addEventListener('click', function() {
            var doc = getDoc();
            if (!doc) {
                flash(strings.loading);
                return;
            }
            var objects = (doc.order || []).length;
            if (!objects) {
                flash(strings.empty);
                return;
            }
            var project = JSON.stringify(doc);
            if (cfg.maxbytes && project.length > cfg.maxbytes) {
                flash(strings.tooBig);
                return;
            }
            post('submit', {project: project, objects: objects});
            flash(strings.sent);
        });

        bar.appendChild(button);
        document.body.appendChild(bar);
    }

    // Ждём, пока приложение поднимет window.lcx, и сообщаем родителю о готовности.
    var attempts = 0;
    var timer = window.setInterval(function() {
        attempts += 1;
        if (getDoc()) {
            window.clearInterval(timer);
            post('ready', {version: '1.0'});
            return;
        }
        if (attempts > 100) {
            window.clearInterval(timer);
        }
    }, 100);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', build);
    } else {
        build();
    }
})();
