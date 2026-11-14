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
 * Lists all LaserCut Studio activities of a course.
 *
 * @package    mod_lasercutstudio
 * @copyright  2026 LaserCut Studio
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

require_once('../../config.php');
require_once($CFG->dirroot . '/mod/lasercutstudio/lib.php');

$id = required_param('id', PARAM_INT);

$course = $DB->get_record('course', ['id' => $id], '*', MUST_EXIST);
require_course_login($course, true);

$strname = get_string('modulenameplural', 'mod_lasercutstudio');

$PAGE->set_url('/mod/lasercutstudio/index.php', ['id' => $course->id]);
$PAGE->set_title($strname);
$PAGE->set_heading(format_string($course->fullname));
$PAGE->navbar->add($strname);
$PAGE->requires->css('/mod/lasercutstudio/styles.css');

echo $OUTPUT->header();
echo $OUTPUT->heading($strname);

$instances = get_all_instances_in_course('lasercutstudio', $course);

if (!$instances) {
    notice(get_string('thereareno', 'moodle', $strname),
        new moodle_url('/course/view.php', ['id' => $course->id]));
}

$table = new html_table();
$table->head = [get_string('name')];
$table->attributes['class'] = 'generaltable lcx-table';

foreach ($instances as $instance) {
    $url = new moodle_url('/mod/lasercutstudio/view.php', ['id' => $instance->coursemodule]);
    $row = [];
    $row[] = html_writer::link($url, format_string($instance->name));
    $table->data[] = $row;
}

echo html_writer::table($table);
echo $OUTPUT->footer();
