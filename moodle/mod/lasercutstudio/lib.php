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
 * Library functions for the LaserCut Studio activity module.
 *
 * @package    mod_lasercutstudio
 * @copyright  2026 LaserCut Studio
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

/**
 * Feature support of the module.
 *
 * @param string $feature FEATURE_xx constant
 * @return mixed True if supported, null otherwise
 */
function lasercutstudio_supports($feature) {
    switch ($feature) {
        case FEATURE_MOD_INTRO:
            return true;
        case FEATURE_BACKUP_MOODLE2:
            return true;
        case FEATURE_SHOW_DESCRIPTION:
            return true;
        case FEATURE_GRADE_HAS_GRADE:
            return true;
        case FEATURE_COMPLETION_TRACKS_VIEWS:
            return true;
        case FEATURE_MOD_PURPOSE:
            return MOD_PURPOSE_CONTENT;
        default:
            return null;
    }
}

/**
 * Normalise form data into a database record.
 *
 * @param stdClass $data
 * @return stdClass
 */
function lasercutstudio_normalise_instance($data) {
    $record = new stdClass();
    $record->name = isset($data->name) ? $data->name : '';
    $record->intro = isset($data->intro) ? $data->intro : '';
    $record->introformat = isset($data->introformat) ? (int) $data->introformat : FORMAT_HTML;
    $record->editorheight = isset($data->editorheight) ? max(320, (int) $data->editorheight) : 640;
    $record->openinnewtab = empty($data->openinnewtab) ? 0 : 1;
    $record->grade = isset($data->grade) ? (int) $data->grade : 0;
    return $record;
}

/**
 * Adds a new instance of the module.
 *
 * @param stdClass $data
 * @param stdClass|null $mform
 * @return int New instance id
 */
function lasercutstudio_add_instance($data, $mform = null) {
    global $DB;

    $record = lasercutstudio_normalise_instance($data);
    $record->course = (int) $data->course;
    $record->timecreated = time();
    $record->timemodified = time();

    $data->id = $DB->insert_record('lasercutstudio', $record);
    $data->instance = $data->id;

    $record->id = (int) $data->id;
    lasercutstudio_grade_item_update($record);
    return $data->id;
}

/**
 * Updates an existing instance.
 *
 * @param stdClass $data
 * @param stdClass|null $mform
 * @return bool
 */
function lasercutstudio_update_instance($data, $mform = null) {
    global $DB;

    $record = lasercutstudio_normalise_instance($data);
    $record->id = (int) $data->instance;
    $record->course = (int) $data->course;
    $record->timemodified = time();

    $DB->update_record('lasercutstudio', $record);
    lasercutstudio_grade_item_update($record);
    return true;
}

/**
 * Deletes an instance and all of its data.
 *
 * @param int $id
 * @return bool
 */
function lasercutstudio_delete_instance($id) {
    global $DB;

    if (!$instance = $DB->get_record('lasercutstudio', ['id' => $id])) {
        return false;
    }

    $cm = get_coursemodule_from_instance('lasercutstudio', $instance->id);
    if ($cm) {
        $context = context_module::instance($cm->id);
        $fs = get_file_storage();
        $fs->delete_area_files($context->id, 'mod_lasercutstudio');
    }

    $DB->delete_records('lasercutstudio_submissions', ['lasercutstudioid' => $instance->id]);
    $DB->delete_records('lasercutstudio', ['id' => $instance->id]);
    lasercutstudio_grade_item_delete($instance);

    return true;
}

/**
 * Creates or updates the grade item of the activity.
 *
 * @param stdClass $instance
 * @param array|stdClass|null $grades
 * @return int
 */
function lasercutstudio_grade_item_update($instance, $grades = null) {
    global $CFG;
    require_once($CFG->libdir . '/gradelib.php');

    $item = [
        'itemname' => $instance->name,
        'idnumber' => 'lasercutstudio' . $instance->id,
        'gradetype' => GRADE_TYPE_VALUE,
        'grademax' => isset($instance->grade) ? (float) $instance->grade : 0,
        'grademin' => 0,
    ];

    if (empty($instance->grade)) {
        $item['gradetype'] = GRADE_TYPE_NONE;
    }

    if ($grades === 'reset') {
        $item['reset'] = true;
        $grades = null;
    }

    return grade_update('mod/lasercutstudio', $instance->course, 'mod', 'lasercutstudio',
        $instance->id, 0, $grades, $item);
}

/**
 * Deletes the grade item of the activity.
 *
 * @param stdClass $instance
 * @return int
 */
function lasercutstudio_grade_item_delete($instance) {
    global $CFG;
    require_once($CFG->libdir . '/gradelib.php');

    return grade_update('mod/lasercutstudio', $instance->course, 'mod', 'lasercutstudio',
        $instance->id, 0, null, ['deleted' => 1]);
}

/**
 * Pushes stored grades of all submissions into the gradebook.
 *
 * @param stdClass $instance
 * @param int $userid 0 = all users
 * @return void
 */
function lasercutstudio_update_grades($instance, $userid = 0) {
    global $CFG, $DB;
    require_once($CFG->libdir . '/gradelib.php');

    if (empty($instance->grade)) {
        lasercutstudio_grade_item_update($instance);
        return;
    }

    $params = ['lasercutstudioid' => $instance->id, 'status' => \mod_lasercutstudio\submission::STATUS_GRADED];
    $sql = 'SELECT * FROM {lasercutstudio_submissions} WHERE lasercutstudioid = :lasercutstudioid AND status = :status';
    if ($userid) {
        $sql .= ' AND userid = :userid';
        $params['userid'] = $userid;
    }

    $grades = [];
    foreach ($DB->get_records_sql($sql, $params) as $submission) {
        if ($submission->grade === null) {
            continue;
        }
        $grade = new stdClass();
        $grade->userid = $submission->userid;
        $grade->rawgrade = (float) $submission->grade;
        $grade->dategraded = $submission->timemodified;
        $grades[$submission->userid] = $grade;
    }

    lasercutstudio_grade_item_update($instance, $grades);
}

/**
 * Serves files of the module: intro attachments and submitted layouts.
 *
 * @param stdClass $course
 * @param stdClass $cm
 * @param context $context
 * @param string $filearea
 * @param array $args
 * @param bool $forcedownload
 * @param array $options
 * @return bool false if the file cannot be served
 */
function mod_lasercutstudio_pluginfile($course, $cm, $context, $filearea, $args, $forcedownload, array $options = []) {
    global $USER;

    if ($context->contextlevel != CONTEXT_MODULE) {
        return false;
    }

    require_login($course, true, $cm);

    if (!in_array($filearea, ['intro', 'submission'], true)) {
        return false;
    }

    $itemid = (int) array_shift($args);
    $filename = array_pop($args);
    $filepath = $args ? '/' . implode('/', $args) . '/' : '/';

    if ($filearea === 'submission') {
        $own = ((int) $USER->id === $itemid);
        if (!$own && !has_capability('mod/lasercutstudio:viewallsubmissions', $context)) {
            send_file_not_found();
        }
        require_capability('mod/lasercutstudio:downloadsubmission', $context);
    } else {
        require_capability('mod/lasercutstudio:view', $context);
    }

    $fs = get_file_storage();
    $file = $fs->get_file($context->id, 'mod_lasercutstudio', $filearea, $itemid, $filepath, $filename);
    if (!$file || $file->is_directory()) {
        send_file_not_found();
    }

    send_stored_file($file, 0, 0, $forcedownload, $options);
}

/**
 * Removes user data when the course is reset.
 *
 * @param stdClass $data reset form data
 * @return array status messages
 */
function lasercutstudio_reset_userdata($data) {
    global $DB;

    $status = [];
    $instances = $DB->get_records('lasercutstudio', ['course' => $data->courseid]);
    foreach ($instances as $instance) {
        $cm = get_coursemodule_from_instance('lasercutstudio', $instance->id, $data->courseid);
        if ($cm) {
            $context = context_module::instance($cm->id);
            $fs = get_file_storage();
            $fs->delete_area_files($context->id, 'mod_lasercutstudio', 'submission');
        }
        $DB->delete_records('lasercutstudio_submissions', ['lasercutstudioid' => $instance->id]);
        lasercutstudio_grade_item_update($instance, 'reset');
    }

    $status[] = [
        'component' => get_string('modulename', 'mod_lasercutstudio'),
        'item' => get_string('submissions', 'mod_lasercutstudio'),
        'error' => false,
    ];

    return $status;
}
