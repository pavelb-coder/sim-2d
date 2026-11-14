<?php
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
 * Serves the LaserCut Studio editor (single self-contained HTML build).
 *
 * @package    mod_lasercutstudio
 * @copyright  2026 LaserCut Studio
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

require_once('../../config.php');
require_once($CFG->dirroot . '/mod/lasercutstudio/lib.php');

$id = required_param('id', PARAM_INT);

$cm = get_coursemodule_from_id('lasercutstudio', $id, 0, false, MUST_EXIST);
$course = $DB->get_record('course', ['id' => $cm->course], '*', MUST_EXIST);
$instance = $DB->get_record('lasercutstudio', ['id' => $cm->instance], '*', MUST_EXIST);

require_login($course, true, $cm);
$context = context_module::instance($cm->id);
require_capability('mod/lasercutstudio:view', $context);

$path = $CFG->dirroot . '/mod/lasercutstudio/editor/index.html';
if (!is_readable($path)) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo get_string('editormissing', 'mod_lasercutstudio') . "\n\n" .
        get_string('editormissing_details', 'mod_lasercutstudio') . "\n";
    exit;
}

$html = file_get_contents($path);

$config = [
    'component' => 'mod_lasercutstudio',
    'cmid' => (int) $cm->id,
    'instanceid' => (int) $instance->id,
    'courseid' => (int) $course->id,
    'userid' => (int) $USER->id,
    'sesskey' => sesskey(),
    'wwwroot' => $CFG->wwwroot,
    'openinnewtab' => !empty($instance->openinnewtab),
    'maxbytes' => \mod_lasercutstudio\submission::MAX_PROJECT_BYTES,
    'lang' => current_language(),
];

$inject = '<script type="application/json" id="lcx-moodle-config">' .
    json_encode($config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) . '</script>';

$bridgepath = $CFG->dirroot . '/mod/lasercutstudio/editor/bridge.js';
if (is_readable($bridgepath)) {
    $inject .= '<script>' . file_get_contents($bridgepath) . '</script>';
}

$pos = strripos($html, '</body>');
if ($pos === false) {
    $html .= $inject;
} else {
    $html = substr($html, 0, $pos) . $inject . substr($html, $pos);
}

@header_remove('Content-Disposition');
header('Content-Type: text/html; charset=utf-8');
header('X-Frame-Options: SAMEORIGIN');
header('Cache-Control: private, max-age=0, no-cache, must-revalidate');
header('X-Content-Type-Options: nosniff');

echo $html;
