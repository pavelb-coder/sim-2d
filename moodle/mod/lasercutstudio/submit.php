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
 * Handles the student submission form.
 *
 * @package    mod_lasercutstudio
 * @copyright  2026 LaserCut Studio
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

require_once('../../config.php');
require_once($CFG->dirroot . '/mod/lasercutstudio/lib.php');
require_once($CFG->dirroot . '/mod/lasercutstudio/classes/submission.php');
require_once($CFG->dirroot . '/mod/lasercutstudio/classes/form/submit_form.php');

$id = required_param('id', PARAM_INT);

$cm = get_coursemodule_from_id('lasercutstudio', $id, 0, false, MUST_EXIST);
$course = $DB->get_record('course', ['id' => $cm->course], '*', MUST_EXIST);
$instance = $DB->get_record('lasercutstudio', ['id' => $cm->instance], '*', MUST_EXIST);

require_login($course, true, $cm);
$context = context_module::instance($cm->id);
require_capability('mod/lasercutstudio:submit', $context);

$viewurl = new moodle_url('/mod/lasercutstudio/view.php', ['id' => $cm->id]);

$PAGE->set_url('/mod/lasercutstudio/submit.php', ['id' => $cm->id]);
$PAGE->set_title(format_string($instance->name));
$PAGE->set_heading(format_string($course->fullname));
$PAGE->requires->css('/mod/lasercutstudio/styles.css');
$PAGE->add_body_class('path-mod-lasercutstudio');

$form = new \mod_lasercutstudio\form\submit_form(null, ['instance' => $instance]);

if ($form->is_cancelled()) {
    redirect($viewurl);
}

if ($data = $form->get_data()) {
    require_sesskey();

    $project = isset($data->project) ? (string) $data->project : '';
    $comment = isset($data->comment) ? (string) $data->comment : '';
    $draftitemid = isset($data->attachments) ? (int) $data->attachments : 0;

    try {
        $saved = \mod_lasercutstudio\submission::save($instance, $context, $USER->id, $project, $comment, $draftitemid);
        redirect($viewurl, get_string('submittedthanks', 'mod_lasercutstudio'), null,
            \core\output\notification::NOTIFY_SUCCESS);
        unset($saved);
    } catch (moodle_exception $e) {
        echo $OUTPUT->header();
        echo $OUTPUT->notification($e->getMessage(), \core\output\notification::NOTIFY_ERROR);
        echo html_writer::div(html_writer::link($viewurl, get_string('back')), 'lcx-backlink');
        echo $OUTPUT->footer();
        exit;
    }
}

echo $OUTPUT->header();
echo $OUTPUT->heading(get_string('submissionstatus', 'mod_lasercutstudio'), 2);
$form->display();
echo $OUTPUT->footer();
