// This file is part of Moodle - https://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <https://www.gnu.org/licenses/>.

/**
 * Receives the layout from the editor iframe and fills the submission form.
 *
 * @module     mod_lasercutstudio/parent
 * @copyright  2026 LaserCut Studio
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
(function() {
    'use strict';

    /**
     * Reads the JSON config printed by view.php.
     *
     * @return {Object|null}
     */
    function readConfig() {
        var node = document.getElementById('lcx-parent-config');
        if (!node) {
            return null;
        }
        try {
            return JSON.parse(node.textContent);
        } catch (e) {
            return null;
        }
    }

    /**
     * Replaces ##PLACEHOLDER## in a localised string.
     *
     * @param {String} text
     * @param {String} key
     * @param {String|Number} value
     * @return {String}
     */
    function fill(text, key, value) {
        return String(text).split(key).join(String(value));
    }

    function init() {
        var config = readConfig();
        var status = document.getElementById('lcx-status');
        if (!config || !status) {
            return;
        }

        status.textContent = config.strings.idle;

        var projectField = document.querySelector('input[name="project"]');
        var wrap = document.getElementById('lcx-submit-wrap');
        var frame = document.getElementById('lcx-frame');

        window.addEventListener('message', function(event) {
            if (event.origin !== window.location.origin) {
                return;
            }
            var data = event.data;
            if (!data || data.source !== 'lasercutstudio') {
                return;
            }

            if (data.type === 'ready') {
                status.textContent = config.strings.ready;
                status.classList.add('lcx-status-ok');
                return;
            }

            if (data.type !== 'submit') {
                return;
            }

            var payload = data.payload || {};
            var project = payload.project || '';
            if (!projectField) {
                return;
            }

            if (project.length > config.maxbytes) {
                status.textContent = fill(config.strings.toobig, '##SIZE##', Math.round(project.length / 1024));
                status.classList.remove('lcx-status-ok');
                return;
            }

            if (project === '') {
                status.textContent = config.strings.empty;
                return;
            }

            projectField.value = project;
            status.textContent = fill(
                fill(config.strings.received, '##OBJECTS##', payload.objects || 0),
                '##SIZE##',
                Math.round(project.length / 1024)
            );
            status.classList.add('lcx-status-ok');

            if (wrap) {
                wrap.classList.add('lcx-ready');
                if (wrap.scrollIntoView) {
                    wrap.scrollIntoView({behavior: 'smooth', block: 'center'});
                }
            }
        });

        if (frame) {
            frame.addEventListener('load', function() {
                status.textContent = config.strings.idle;
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
