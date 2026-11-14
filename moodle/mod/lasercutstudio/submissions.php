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
 * Teacher view: all submitted layouts and grading.
 *
 * @package    mod_lasercutstudio
 * @copyright  2026 LaserCut Studio
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

require_once('../../config.php');
require_once($CFG->dirroot . '/mod/lasercutstudio/lib.php');
require_once($CFG->dirroot . '/mod/lasercutstudio/classes/submission.php');

$id = required_param('id', PARAM_INT);
$action = optional_param('action', '', PARAM_ALPHA);

$cm = get_coursemodule_from_id('lasercutstudio', $id, 0, false, MUST_EXIST);
$course = $DB->get_record('course', ['id' => $cm->course], '*', MUST_EXIST);
$instance = $DB->get_record('lasercutstudio', ['id' => $cm->instance], '*', MUST_EXIST);

require_login($course, true, $cm);
$context = context_module::instance($cm->id);
require_capability('mod/lasercutstudio:viewallsubmissions', $context);

$listurl = new moodle_url('/mod/lasercutstudio/submissions.php', ['id' => $cm->id]);

if ($action === 'grade') {
    require_sesskey();
    $userid = required_param('userid', PARAM_INT);
    $grade = required_param('grade', PARAM_FLOAT);

    $submission = \mod_lasercutstudio\submission::get($instance->id, $userid);
    if ($submission && has_capability('mod/lasercutstudio:grade', $context)) {
        \mod_lasercutstudio\submission::set_grade($instance, $context, $submission, $grade);
        redirect($listurl, get_string('savedgrade', 'mod_lasercutstudio'), null,
            \core\output\notification::NOTIFY_SUCCESS);
    }
    redirect($listurl, get_string('nopermissions', 'error'), null, \core\output\notification::NOTIFY_ERROR);
}

$PAGE->set_url($listurl);
$PAGE->set_title(format_string($instance->name) . ': ' . get_string('submissions', 'mod_lasercutstudio'));
$PAGE->set_heading(format_string($course->fullname));
$PAGE->requires->css('/mod/lasercutstudio/styles.css');
$PAGE->add_body_class('path-mod-lasercutstudio');

echo $OUTPUT->header();
echo $OUTPUT->heading(get_string('submissions', 'mod_lasercutstudio'), 2);

$submissions = \mod_lasercutstudio\submission::all_for_instance($instance->id);

if (!$submissions) {
    echo $OUTPUT->notification(get_string('nosubmissions', 'mod_lasercutstudio'), 'notifymessage');
    echo $OUTPUT->single_button(new moodle_url('/mod/lasercutstudio/view.php', ['id' => $cm->id]),
        get_string('back'), 'get');
    echo $OUTPUT->footer();
    exit;
}

$cangrade = has_capability('mod/lasercutstudio:grade', $context);
$hasgrade = !empty($instance->grade);

$table = new html_table();
$table->head = [
    get_string('student', 'mod_lasercutstudio'),
    get_string('status', 'mod_lasercutstudio'),
    get_string('objectcount', 'mod_lasercutstudio'),
    get_string('timemodified', 'mod_lasercutstudio'),
    get_string('downloadproject', 'mod_lasercutstudio'),
];
if ($hasgrade) {
    $table->head[] = get_string('grades', 'mod_lasercutstudio');
}
$table->attributes['class'] = 'generaltable lcx-table';

foreach ($submissions as $submission) {
    $user = $DB->get_record('user', ['id' => $submission->userid], '*', IGNORE_MISSING);
    if (!$user) {
        continue;
    }

    $row = [];
    $row[] = fullname($user);

    $row[] = \mod_lasercutstudio\submission::status_label($submission->status);
    $row[] = (int) $submission->objectcount;
    $row[] = userdate($submission->timemodified, get_string('strftimedatetimeshort', 'langconfig'));

    $links = [];
    foreach (\mod_lasercutstudio\submission::get_files($context, $submission->userid) as $file) {
        $url = moodle_url::make_pluginfile_url($context->id, 'mod_lasercutstudio',
            \mod_lasercutstudio\submission::FILEAREA, $submission->userid, $file->get_filepath(),
            $file->get_filename(), true);
        $links[] = html_writer::link($url, s($file->get_filename()));
    }
    $row[] = $links ? implode('<br>', $links) : '-';

    if ($hasgrade) {
        if ($cangrade) {
            $form = html_writer::start_tag('form', ['method' => 'post', 'action' => $listurl->out(false),
                'class' => 'lcx-gradeform']);
            $form .= html_writer::empty_tag('input', ['type' => 'hidden', 'name' => 'id', 'value' => $cm->id]);
            $form .= html_writer::empty_tag('input', ['type' => 'hidden', 'name' => 'action', 'value' => 'grade']);
            $form .= html_writer::empty_tag('input', ['type' => 'hidden', 'name' => 'sesskey', 'value' => sesskey()]);
            $form .= html_writer::empty_tag('input', ['type' => 'hidden', 'name' => 'userid',
                'value' => $submission->userid]);
            $form .= html_writer::empty_tag('input', ['type' => 'number', 'name' => 'grade', 'step' => '0.01',
                'min' => '0', 'max' => (string) (float) $instance->grade, 'class' => 'lcx-gradeinput',
                'value' => $submission->grade === null ? '' : (string) (float) $submission->grade]);
            $form .= html_writer::empty_tag('input', ['type' => 'submit', 'class' => 'btn btn-secondary',
                'value' => get_string('savechanges')]);
            $form .= html_writer::end_tag('form');
            $row[] = $form . ' / ' . format_float((float) $instance->grade, 2);
        } else {
            $row[] = $submission->grade === null ? '-' : format_float((float) $submission->grade, 2);
        }
    }

    $table->data[] = $row;
}

echo html_writer::table($table);
echo $OUTPUT->single_button(new moodle_url('/mod/lasercutstudio/view.php', ['id' => $cm->id]),
    get_string('back'), 'get');
echo $OUTPUT->footer();
