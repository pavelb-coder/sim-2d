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
 * Main view of the LaserCut Studio activity.
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
$submitted = optional_param('submitted', 0, PARAM_INT);

$cm = get_coursemodule_from_id('lasercutstudio', $id, 0, false, MUST_EXIST);
$course = $DB->get_record('course', ['id' => $cm->course], '*', MUST_EXIST);
$instance = $DB->get_record('lasercutstudio', ['id' => $cm->instance], '*', MUST_EXIST);

require_login($course, true, $cm);
$context = context_module::instance($cm->id);
require_capability('mod/lasercutstudio:view', $context);

$PAGE->set_url('/mod/lasercutstudio/view.php', ['id' => $cm->id]);
$PAGE->set_title(format_string($instance->name));
$PAGE->set_heading(format_string($course->fullname));
$PAGE->requires->css('/mod/lasercutstudio/styles.css');
$PAGE->requires->js(new moodle_url('/mod/lasercutstudio/js/parent.js'));
$PAGE->add_body_class('path-mod-lasercutstudio');

$event = \mod_lasercutstudio\event\course_module_viewed::create([
    'objectid' => $instance->id,
    'context' => $context,
]);
$event->add_record_snapshot('course', $course);
$event->add_record_snapshot('course_modules', $cm);
$event->add_record_snapshot('lasercutstudio', $instance);
$event->trigger();

$completion = new completion_info($course);
$completion->set_module_viewed($cm);

$cansubmit = has_capability('mod/lasercutstudio:submit', $context);
$cangrade = has_capability('mod/lasercutstudio:grade', $context);
$canviewall = has_capability('mod/lasercutstudio:viewallsubmissions', $context);

$submission = \mod_lasercutstudio\submission::get($instance->id, $USER->id);
$projectfile = \mod_lasercutstudio\submission::get_project_file($context, $USER->id);

$form = null;
if ($cansubmit) {
    // Форма живёт на view.php, а обрабатывается в submit.php — задаём action явно,
    // иначе moodleform отправит данные на текущую страницу, где их никто не ждёт.
    $submiturl = new moodle_url('/mod/lasercutstudio/submit.php', ['id' => $cm->id]);
    $form = new \mod_lasercutstudio\form\submit_form($submiturl, ['instance' => $instance]);

    $draftitemid = file_get_submitted_draft_itemid('attachments');
    file_prepare_draft_area($draftitemid, $context->id, 'mod_lasercutstudio', \mod_lasercutstudio\submission::FILEAREA,
        $USER->id, ['subdirs' => 0, 'maxfiles' => \mod_lasercutstudio\submission::MAX_ATTACHMENTS]);

    $form->set_data([
        'id' => $cm->id,
        'attachments' => $draftitemid,
        'comment' => $submission ? $submission->comment : '',
    ]);
}

echo $OUTPUT->header();

echo $OUTPUT->heading(format_string($instance->name), 2);

if (trim((string) $instance->intro) !== '') {
    echo $OUTPUT->box(format_module_intro('lasercutstudio', $instance, $cm->id), 'generalbox mod_introbox', 'intro');
}

if ($submitted) {
    echo $OUTPUT->notification(get_string('submittedthanks', 'mod_lasercutstudio'), 'notifysuccess');
}

// Toolbar: full screen, teacher list, status.
echo html_writer::start_div('lcx-toolbar');

$editorurl = new moodle_url('/mod/lasercutstudio/editor.php', ['id' => $cm->id]);
echo html_writer::link($editorurl, get_string('fullscreen', 'mod_lasercutstudio'),
    ['class' => 'btn btn-secondary lcx-btn', 'target' => '_blank', 'rel' => 'noopener']);

if ($canviewall) {
    $listurl = new moodle_url('/mod/lasercutstudio/submissions.php', ['id' => $cm->id]);
    echo html_writer::link($listurl, get_string('teacherview', 'mod_lasercutstudio'),
        ['class' => 'btn btn-secondary lcx-btn']);
}

echo html_writer::tag('span', '', ['id' => 'lcx-status', 'class' => 'lcx-status',
    'data-idle' => get_string('editornotready', 'mod_lasercutstudio')]);

echo html_writer::end_div();

// The editor itself.
if (!empty($instance->openinnewtab)) {
    echo html_writer::start_div('lcx-openbox');
    echo html_writer::link($editorurl, get_string('submitwork', 'mod_lasercutstudio'),
        ['class' => 'btn btn-primary btn-lg', 'target' => '_blank', 'rel' => 'noopener']);
    echo html_writer::end_div();
} else {
    echo html_writer::start_div('lcx-editor-wrap');
    echo html_writer::tag('iframe', '', [
        'id' => 'lcx-frame',
        'class' => 'lcx-frame',
        'src' => $editorurl->out(false),
        'title' => get_string('pluginname', 'mod_lasercutstudio'),
        'style' => 'height: ' . max(320, (int) $instance->editorheight) . 'px;',
        'loading' => 'lazy',
        'allow' => 'fullscreen',
    ]);
    echo html_writer::end_div();
}

// Submission area.
echo $OUTPUT->heading(get_string('submissionstatus', 'mod_lasercutstudio'), 3, 'lcx-h3');

echo html_writer::start_div('lcx-submission');

if ($submission) {
    echo html_writer::start_tag('ul', ['class' => 'lcx-meta']);
    echo html_writer::tag('li', get_string('status', 'mod_lasercutstudio') . ': ' .
        \mod_lasercutstudio\submission::status_label($submission->status));
    echo html_writer::tag('li', get_string('submittedat', 'mod_lasercutstudio') . ': ' .
        userdate($submission->timecreated, get_string('strftimedatetimeshort', 'langconfig')));
    if ((int) $submission->objectcount > 0) {
        echo html_writer::tag('li', get_string('objectcount', 'mod_lasercutstudio') . ': ' . (int) $submission->objectcount);
    }
    if ($submission->grade !== null) {
        echo html_writer::tag('li', get_string('grades', 'mod_lasercutstudio') . ': ' .
            format_float((float) $submission->grade, 2) . ' / ' . format_float((float) $instance->grade, 2));
    }
    echo html_writer::end_tag('ul');

    if ($projectfile) {
        $fileurl = moodle_url::make_pluginfile_url($context->id, 'mod_lasercutstudio',
            \mod_lasercutstudio\submission::FILEAREA, $USER->id, $projectfile->get_filepath(),
            $projectfile->get_filename(), true);
        echo html_writer::link($fileurl, get_string('downloadproject', 'mod_lasercutstudio'),
            ['class' => 'btn btn-link lcx-download']);
    }
} else if ($cansubmit) {
    echo html_writer::tag('p', get_string('nosubmission', 'mod_lasercutstudio'), ['class' => 'lcx-muted']);
}

if ($cansubmit) {
    echo html_writer::tag('p', get_string('submitinstructions', 'mod_lasercutstudio'), ['class' => 'lcx-hint']);
    if ($form) {
        echo html_writer::start_div('lcx-form-wrap', ['id' => 'lcx-submit-wrap']);
        $form->display();
        echo html_writer::end_div();
    }
}

echo html_writer::end_div();

// Config for js/parent.js.
$config = [
    'maxbytes' => \mod_lasercutstudio\submission::MAX_PROJECT_BYTES,
    'strings' => [
        'received' => get_string('submissionreceived', 'mod_lasercutstudio', ['objects' => '##OBJECTS##', 'size' => '##SIZE##']),
        'toobig' => get_string('toobig', 'mod_lasercutstudio', '##SIZE##'),
        'ready' => get_string('submitwork', 'mod_lasercutstudio'),
        'idle' => get_string('editornotready', 'mod_lasercutstudio'),
        'empty' => get_string('projectempty', 'mod_lasercutstudio'),
    ],
];
echo html_writer::tag('script', json_encode($config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT),
    ['type' => 'application/json', 'id' => 'lcx-parent-config']);

echo $OUTPUT->footer();
